/**
 * Jaro / Jaro-Winkler string similarity (AUDIT-07 — mapping suggestions).
 *
 * Pure string-similarity arithmetic: no money, no storage, no engine. S-031 uses
 * it to present *candidate* COA accounts when a source account code is missing
 * from the Company's COA (the `ACCOUNT_MISSING` detail of a hard
 * `MAP_ACCOUNT_AMBIGUOUS` finding, GL-TEMPLATE-SPEC §6). Suggestions are advisory:
 * they are computed client-side from the catalogued `coa.list` data, never
 * auto-apply a mapping, and never change validation behaviour.
 *
 * Contract (classic definitions, e.g. Wikipedia "Jaro-Winkler similarity"):
 * - `jaro(a, b)` ∈ [0, 1]; `jaro(a, a) = 1`, empty vs empty = 1, empty vs non-empty = 0.
 * - `jaroWinkler(a, b, p)` = `jaro + m·p·(1 − jaro)` where `m` = common-prefix length
 *   (capped at 4); default `p = 0.1`.
 */

/** Classic Jaro-Winkler common-prefix cap. */
export const JW_MAX_PREFIX = 4;

/** Classic Jaro-Winkler prefix scaling factor. */
export const JW_DEFAULT_PREFIX_SCALE = 0.1;

/** "Probably identical" band — candidates below this are never suggested. */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

/** How many candidates a single missing account surfaces. */
export const DEFAULT_SUGGESTION_LIMIT = 3;

/**
 * Jaro similarity of two strings.
 *
 * A character of `a` matches a character of `b` when the characters are equal and
 * the positions differ by at most `floor(max(|a|, |b|) / 2) − 1`. With `m` matches
 * and `t` matched pairs out of order:
 * `jaro = (m/|a| + m/|b| + (m − t/2)/m) / 3`.
 */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;

  const matchWindow = Math.floor(Math.max(la, lb) / 2) - 1;
  const aMatched = new Array<boolean>(la).fill(false);
  const bMatched = new Array<boolean>(lb).fill(false);
  let matches = 0;

  for (let i = 0; i < la; i += 1) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(lb - 1, i + matchWindow);
    for (let j = start; j <= end; j += 1) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;

  // Transpositions: walk the matched subsequences in order; every position where
  // the matched characters differ counts as one transposition pair (halfed below).
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < la; i += 1) {
    if (!aMatched[i]) continue;
    while (k < lb && !bMatched[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }

  return (matches / la + matches / lb + (matches - transpositions / 2) / matches) / 3;
}

/**
 * Jaro-Winkler similarity: Jaro boosted by the common prefix (length capped at
 * {@link JW_MAX_PREFIX}) with scaling factor `prefixScale`.
 */
export function jaroWinkler(a: string, b: string, prefixScale = JW_DEFAULT_PREFIX_SCALE): number {
  const base = jaro(a, b);
  if (base === 0 || base === 1) return base;
  const maxPrefix = Math.min(JW_MAX_PREFIX, a.length, b.length);
  let prefix = 0;
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix += 1;
  return base + prefix * prefixScale * (1 - base);
}

export interface AccountSuggestionSource {
  /** The source (ERP) account code as parsed. */
  code: string;
  /** The source account name, when the dump carries one. */
  name?: string | null;
}

export interface AccountSuggestion {
  code: string;
  name: string;
  /** Best (code vs name) Jaro-Winkler similarity, in [0, 1]. */
  similarity: number;
}

/**
 * Rank COA accounts as candidates for an unmatched source account.
 *
 * Score per candidate = `max(code similarity, name similarity)` — the stronger
 * signal wins, and a source row carrying only a code is ranked on the code
 * alone. Candidates scoring below `threshold` (default
 * {@link DEFAULT_SIMILARITY_THRESHOLD}) are dropped; at most `limit` (default
 * {@link DEFAULT_SUGGESTION_LIMIT}) are returned. Ordering is deterministic:
 * similarity descending, then code ascending.
 */
export function suggestAccounts(
  source: AccountSuggestionSource,
  accounts: Pick<AccountSuggestion, "code" | "name">[],
  options?: { threshold?: number; limit?: number },
): AccountSuggestion[] {
  const threshold = options?.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const limit = options?.limit ?? DEFAULT_SUGGESTION_LIMIT;
  const sourceCode = source.code.trim();
  const sourceName = source.name?.trim() ?? "";

  const scored = accounts.map((account) => {
    const codeSimilarity = jaroWinkler(sourceCode, account.code.trim());
    const nameSimilarity =
      sourceName.length > 0
        ? jaroWinkler(sourceName.toLowerCase(), account.name.trim().toLowerCase())
        : 0;
    return {
      code: account.code,
      name: account.name,
      similarity: Math.max(codeSimilarity, nameSimilarity),
    };
  });

  return scored
    .filter((entry) => entry.similarity >= threshold)
    .sort(
      (left, right) => right.similarity - left.similarity || left.code.localeCompare(right.code),
    )
    .slice(0, limit);
}
