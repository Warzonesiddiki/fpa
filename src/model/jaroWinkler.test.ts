import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIMILARITY_THRESHOLD,
  DEFAULT_SUGGESTION_LIMIT,
  JW_DEFAULT_PREFIX_SCALE,
  jaro,
  jaroWinkler,
  suggestAccounts,
} from "./jaroWinkler";

/**
 * Every expected value below was cross-checked against an independent
 * O(n²) reference implementation (matched subsequences compared in each
 * string's own order) before being pinned — this is the AUDIT-07 oracle.
 */
describe("jaro — Jaro similarity (AUDIT-07 mapping suggestions)", () => {
  it("returns 1 for identical strings (incl. empty/empty) and 0 for disjoint ones", () => {
    expect(jaro("abc", "abc")).toBe(1);
    expect(jaro("", "")).toBe(1);
    expect(jaro("a", "")).toBe(0);
    expect(jaro("", "a")).toBe(0);
    expect(jaro("a", "b")).toBe(0);
    // No character within the match window.
    expect(jaro("ab", "ba")).toBe(0);
    expect(jaro("xy", "yx")).toBe(0);
  });

  it("matches the classic test vectors", () => {
    // 17/18: 6 matches, one transposition pair.
    expect(jaro("MARTHA", "MARHTA")).toBeCloseTo(17 / 18, 12);
    // 37/45: 4 matches, no transpositions, unequal lengths.
    expect(jaro("DWAYNE", "DUANE")).toBeCloseTo(37 / 45, 12);
    // 5/6.
    expect(jaro("LONG", "LION")).toBeCloseTo(5 / 6, 12);
  });

  it("scores near-duplicates of GL account labels and codes high", () => {
    expect(jaro("INTEREST EXPENSE", "INTEREST EXPENSES")).toBeCloseTo(0.9803921569, 10);
    expect(jaro("REVENUE", "REVENUE (NET)")).toBeCloseTo(0.8461538462, 10);
    expect(jaro("1234A", "1234")).toBeCloseTo(0.9333333333, 10);
    expect(jaro("1000", "10001")).toBeCloseTo(0.9333333333, 10);
    expect(jaro("4400-OLD", "4400")).toBeCloseTo(0.8333333333, 10);
  });

  it("is case-sensitive (callers normalize case, the algorithm does not)", () => {
    expect(jaro("cash", "CASH")).toBe(0);
    expect(jaro("cash", "cash")).toBe(1);
  });

  it("is symmetric", () => {
    for (const [a, b] of [
      ["DWAYNE", "DUANE"],
      ["REVENUE", "REVENUE (NET)"],
      ["4400-OLD", "4400"],
    ]) {
      expect(jaro(a, b)).toBe(jaro(b, a));
    }
  });
});

describe("jaroWinkler — prefix-boosted similarity", () => {
  it("boosts by the common prefix (capped at 4) with p = 0.1", () => {
    // MARTHA/MARHTA: prefix 3 (M,A,R), jaro 17/18 → 173/180.
    expect(jaroWinkler("MARTHA", "MARHTA")).toBeCloseTo(173 / 180, 12);
    // DWAYNE/DUANE: prefix 1, jaro 37/45 → 0.84 exactly.
    expect(jaroWinkler("DWAYNE", "DUANE")).toBeCloseTo(0.84, 12);
    // 1234A/1234: prefix 4 (capped), jaro 14/15 → 0.96 exactly.
    expect(jaroWinkler("1234A", "1234")).toBeCloseTo(0.96, 12);
  });

  it("caps the prefix at 4 characters even for longer common prefixes", () => {
    // "ACCOUNTS RECEIVABLE" vs "ACCOUNTS RECEIVABLE " shares 19 chars; the boost
    // still counts only 4.
    const base = jaro("ACCOUNTS RECEIVABLE", "ACCOUNTS RECEIVABLE ");
    const boosted = jaroWinkler("ACCOUNTS RECEIVABLE", "ACCOUNTS RECEIVABLE ");
    expect(boosted).toBeCloseTo(base + 4 * JW_DEFAULT_PREFIX_SCALE * (1 - base), 12);
  });

  it("respects a custom prefix scale and is a no-op for 0 and 1", () => {
    expect(jaroWinkler("MARTHA", "MARHTA", 0)).toBe(jaro("MARTHA", "MARHTA"));
    expect(jaroWinkler("abc", "abc", 0.5)).toBe(1);
    expect(jaroWinkler("a", "b", 0.5)).toBe(0);
  });
});

describe("suggestAccounts — candidate ranking for a missing COA account", () => {
  const COA = [
    { code: "4000", name: "Revenue" },
    { code: "4010", name: "Revenue (Net)" },
    { code: "6300", name: "Interest Expense" },
    { code: "6310", name: "Interest Expense (Foreign)" },
    { code: "6500", name: "Rent Expense" },
    { code: "7000", name: "Wages Payable" },
  ];

  it("ranks the near-duplicate first and keeps only candidates at/above the threshold", () => {
    const result = suggestAccounts({ code: "6300 ", name: "INTEREST EXPENSES" }, COA);
    // Exact code 6300 wins (similarity 1) even though the name has a plural typo.
    expect(result[0].code).toBe("6300");
    expect(result[0].similarity).toBe(1);
    // Every returned candidate clears the default threshold.
    for (const entry of result) {
      expect(entry.similarity).toBeGreaterThanOrEqual(DEFAULT_SIMILARITY_THRESHOLD);
    }
  });

  it("ranks on the name when the code is unknown, case-insensitively", () => {
    const result = suggestAccounts({ code: "99999", name: "rent expense" }, COA);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].code).toBe("6500");
    // "Rent Expense" vs "rent expense": case-insensitive name match = 1.
    expect(result[0].similarity).toBe(1);
    // The unknown code itself must not surface a fake candidate.
    expect(result.some((entry) => entry.code === "99999")).toBe(false);
  });

  it("drops candidates below the threshold (and honours a custom one)", () => {
    // "6310X" vs "6310" scores 0.96 (above threshold); vs "6300" it scores
    // 0.8267 (below the default 0.85, at/above a relaxed 0.8). The junk name
    // keeps every name similarity at 0 so the code signal is tested alone.
    const strict = suggestAccounts({ code: "6310X", name: "zzz" }, COA);
    expect(strict.map((entry) => entry.code)).toEqual(["6310"]);
    expect(strict[0].similarity).toBeCloseTo(0.96, 12);
    const relaxed = suggestAccounts({ code: "6310X", name: "zzz" }, COA, { threshold: 0.8 });
    expect(relaxed.map((entry) => entry.code)).toEqual(["6310", "6300"]);
  });

  it("returns at most `limit` candidates (default 3), deterministic on ties", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      code: String(8000 + i),
      name: "Storage Expense",
    }));
    const result = suggestAccounts({ code: "8xxx", name: "STORAGE EXPENSE" }, many);
    expect(result.length).toBe(DEFAULT_SUGGESTION_LIMIT);
    // All candidates tie at similarity 1 → code-ascending order.
    expect(result.map((entry) => entry.code)).toEqual(["8000", "8001", "8002"]);
    const five = suggestAccounts({ code: "8xxx", name: "STORAGE EXPENSE" }, many, { limit: 5 });
    expect(five.map((entry) => entry.code)).toEqual(["8000", "8001", "8002", "8003", "8004"]);
  });

  it("trims surrounding whitespace from the source code and account fields", () => {
    const result = suggestAccounts({ code: "  6300  ", name: "  Interest Expense  " }, COA);
    expect(result[0].code).toBe("6300");
    expect(result[0].similarity).toBe(1);
  });

  it("ranks a code-only source on the code alone", () => {
    const result = suggestAccounts({ code: "6500" }, COA);
    expect(result[0].code).toBe("6500");
    expect(result[0].similarity).toBe(1);
  });
});
