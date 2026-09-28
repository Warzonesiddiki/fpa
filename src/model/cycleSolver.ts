/**
 * Cycle relaxation solver — Iterative Calculation Mode (FORMULA-ENGINE-SPEC §5, AUDIT-04).
 *
 * **Problem it solves.** Intentional circular references — the classic 3-statement debt loop
 * (average debt ↔ interest expense ↔ net income ↔ cash ↔ revolver draw) — must resolve to valid
 * financial values instead of a hard `#CYCLE!`. HyperFormula has no iterative mode, so the
 * solver lives beside the engine: it takes a cyclic strongly connected component (SCC) of the
 * dependency graph and relaxes it to a fixed point. The HyperFormula workbook stays the single
 * owner of formula evaluation (B14) — this module owns only the SCC/relaxation MATH and the
 * pure formula-reference rewriting; the engine supplies the per-node evaluator.
 *
 * **Spec (FORMULA-ENGINE-SPEC §5, locked):**
 *  * SCCs are detected with Tarjan's algorithm.
 *  * Cyclic subgraphs are solved with damped Gauss–Seidel, dampening α = 0.5, ≤ 100 iterations.
 *  * Convergence: max absolute change between iterations ≤ 0.0001 minor units.
 *  * Non-converging or divergent loops (e.g. `=A1*2`) terminate at max iterations and emit
 *    `#CYCLE!` (the engine maps a non-converged SCC back to `FORMULA_CYCLE`).
 *  * Iterative Calculation is opt-in (default off — `#CYCLE!` as before).
 *
 * **Dual-probe validation (why two seeds).** The damped Gauss–Seidel map of a pure multiplicative
 * loop (`x = 2x`) has the trivial fixed point 0: from a zero seed it "converges" instantly to a
 * meaningless all-zero result, which is exactly the outcome the spec forbids (the spec names
 * `=A1*2` as a divergent loop that must emit `#CYCLE!`). The solver therefore runs the relaxation
 * from two deterministic seeds — the zero seed and the unit seed — and accepts a solution only
 * when BOTH converge and agree at COMMITTED CURRENCY PRECISION: the two probe endpoints must
 * round (decimal HALF_UP) to the same value at the model's currency scale. Agreement is judged
 * there — not at the raw convergence tolerance — because the per-sweep-change stopping rule can
 * let the two probes finish a sweep or two apart, and at coarse tolerances (scale 0, JPY) that
 * gap can exceed the tolerance while the committed value is still identical. Any disagreement
 * the user could see (0.00 vs 0.01, 0 vs 1) means the fixed point is not unique → `#CYCLE!`.
 * A unique, stable fixed point (a real debt loop) satisfies both; a multiplicative loop, a
 * non-unique family (`a = b`, `b = a`), and a genuinely divergent loop all fail validation.
 * Deterministic by construction: fixed sweep order (node order), fixed seeds, IEEE-754
 * arithmetic — no randomness anywhere in this module.
 *
 * **Exactness discipline (B3/B18-2):** the relaxed values live in the engine's float evaluation
 * space (Excel parity — the engine commits through Currency Scale rounding, never through this
 * module). The only non-float conversion is the spec's minor-unit tolerance, computed exactly
 * with `decimal.js` (`0.0001 × 10^(−scale)`). No float parsing, no `Math.round`, no `.toFixed`.
 */
import Decimal from "decimal.js";

/** Dampening factor α (FORMULA-ENGINE-SPEC §5). */
export const CYCLE_SOLVER_ALPHA = 0.5;
/** Maximum relaxation sweeps per probe (FORMULA-ENGINE-SPEC §5). */
export const CYCLE_SOLVER_MAX_ITERATIONS = 100;
/** Convergence threshold in MINOR units: max absolute change between iterations (spec §5). */
export const CYCLE_SOLVER_TOLERANCE_MINOR = 0.0001;
/** Verification probe seed (the zero seed is the primary run). */
export const CYCLE_SOLVER_PROBE_SEED = 1;

export interface CycleSolverConfig {
  /** Dampening factor α (0, 1]. */
  alpha: number;
  /** Maximum relaxation sweeps per probe. */
  maxIterations: number;
  /** Convergence threshold in minor units (spec: 0.0001). */
  toleranceMinor: number;
  /** Currency scale of the relaxed values (1 minor unit = 10^(−scale) major units). */
  scale: number;
}

export const DEFAULT_CYCLE_SOLVER_CONFIG: CycleSolverConfig = {
  alpha: CYCLE_SOLVER_ALPHA,
  maxIterations: CYCLE_SOLVER_MAX_ITERATIONS,
  toleranceMinor: CYCLE_SOLVER_TOLERANCE_MINOR,
  scale: 2,
};

export interface CycleSolveResult {
  /**
   * True only when both probes converged AND their endpoints agree at committed currency
   * precision (identical decimal HALF_UP value at the model's scale) — a unique, stable fixed
   * point. False otherwise (divergent, non-convergent, evaluation error, or non-unique fixed
   * point): the engine keeps the SCC flagged `FORMULA_CYCLE`.
   */
  converged: boolean;
  /** Solved value per node in `nodes` order — the primary (zero-seed) trajectory's endpoint. */
  values: [string, number][];
  /** Total relaxation sweeps executed across both probes. */
  iterations: number;
  /**
   * Max absolute change of the decisive final sweep, in minor units (the spec's convergence
   * metric). ≤ `toleranceMinor` when `converged`; `Infinity` when the run aborted on an
   * evaluation error or a non-finite value.
   */
  finalChangeMinor: number;
}

/**
 * Per-node evaluation + write-back pair supplied by the engine.
 * `evaluate(node, current)` returns the node's formula value given the CURRENT relaxation values
 * of all nodes (already-written nodes of the ongoing sweep are visible — strict Gauss–Seidel);
 * it returns `null` when the evaluation produced a formula error (the SCC cannot be solved).
 * `write(node, value)` persists the node's latest relaxed value so later nodes see it.
 */
export interface CycleSolveRuntime {
  evaluate(node: string, current: ReadonlyMap<string, number>): number | null;
  write(node: string, value: number): void;
}

interface ProbeResult {
  converged: boolean;
  values: [string, number][];
  iterations: number;
  finalChangeMinor: number;
}

/** The spec's minor-unit threshold expressed in major units — exact decimal, never binary. */
export function relaxationToleranceMajor(config: CycleSolverConfig): number {
  return new Decimal(config.toleranceMinor).times(Decimal.pow(10, -config.scale)).toNumber();
}

/**
 * One deterministic relaxation run from a constant seed. Strict Gauss–Seidel: nodes are
 * relaxed in the given (engine-provided, deterministic) order; each node's evaluation sees the
 * already-updated values of the earlier nodes of the same sweep.
 */
function solveFromSeed(
  nodes: readonly string[],
  runtime: CycleSolveRuntime,
  config: CycleSolverConfig,
  seed: number,
  toleranceMajor: number,
): ProbeResult {
  const current = new Map<string, number>();
  for (const node of nodes) {
    current.set(node, seed);
    // The engine's scratch inputs must reflect the probe seed before the first evaluation.
    runtime.write(node, seed);
  }

  const snapshot = (): [string, number][] =>
    nodes.map((node) => [node, current.get(node) as number]);
  let iterations = 0;
  let finalChangeMinor = Infinity;

  for (let sweep = 1; sweep <= config.maxIterations; sweep += 1) {
    iterations = sweep;
    let maxChangeMajor = 0;
    for (const node of nodes) {
      const evaluated = runtime.evaluate(node, current);
      if (evaluated === null) {
        // A formula error inside the SCC (e.g. #DIV/0!) — the loop has no numeric solution.
        return { converged: false, values: snapshot(), iterations, finalChangeMinor: Infinity };
      }
      const previous = current.get(node) as number;
      const relaxed = previous + config.alpha * (evaluated - previous);
      if (!Number.isFinite(relaxed)) {
        // Divergence guard: an unbounded trajectory stops the probe immediately.
        return { converged: false, values: snapshot(), iterations, finalChangeMinor: Infinity };
      }
      const change = Math.abs(relaxed - previous);
      if (change > maxChangeMajor) maxChangeMajor = change;
      current.set(node, relaxed);
      runtime.write(node, relaxed);
    }
    finalChangeMinor = maxChangeMajor * Math.pow(10, config.scale);
    if (maxChangeMajor <= toleranceMajor) {
      return { converged: true, values: snapshot(), iterations, finalChangeMinor };
    }
  }
  // Exhausted the iteration budget without meeting the spec's convergence threshold.
  return { converged: false, values: snapshot(), iterations, finalChangeMinor };
}

/**
 * Solve one cyclic SCC to its fixed point (FORMULA-ENGINE-SPEC §5).
 *
 * @param nodes   The SCC members in the engine's deterministic order (the sweep order).
 * @param runtime The engine's per-node evaluator / value writer (HyperFormula scratch cells).
 * @param config  Spec constants; defaults are the locked values (α=0.5, ≤100 sweeps,
 *                0.0001 minor units, scale 2).
 * @returns       The dual-probe-validated solution (see module header for the validation rule).
 */
export function solveCyclicScc(
  nodes: readonly string[],
  runtime: CycleSolveRuntime,
  config: Partial<CycleSolverConfig> = {},
): CycleSolveResult {
  const cfg: CycleSolverConfig = { ...DEFAULT_CYCLE_SOLVER_CONFIG, ...config };
  if (nodes.length === 0) {
    return { converged: true, values: [], iterations: 0, finalChangeMinor: 0 };
  }
  const toleranceMajor = relaxationToleranceMajor(cfg);

  const primary = solveFromSeed(nodes, runtime, cfg, 0, toleranceMajor);
  if (!primary.converged) return primary;

  const verification = solveFromSeed(nodes, runtime, cfg, CYCLE_SOLVER_PROBE_SEED, toleranceMajor);
  if (!verification.converged) {
    return {
      converged: false,
      values: primary.values,
      iterations: primary.iterations + verification.iterations,
      finalChangeMinor: verification.finalChangeMinor,
    };
  }
  for (let i = 0; i < nodes.length; i += 1) {
    // Agreement at committed currency precision (the engine's own commit rule — decimal HALF_UP
    // at the model scale): the per-sweep-change stop rule can leave the two probe endpoints a
    // sweep or two apart (gap up to ~4× tolerance), which at coarse scales (JPY) can exceed the
    // raw tolerance. If the committed values still match, the loop is solvable; if the user
    // could see a difference (0.00 vs 0.01, 0 vs 1), the fixed point is not unique
    // (e.g. `a = b`, `b = a`) — iterative calculation cannot choose. Keep `#CYCLE!`.
    const committedA = new Decimal(primary.values[i][1]).toDecimalPlaces(
      cfg.scale,
      Decimal.ROUND_HALF_UP,
    );
    const committedB = new Decimal(verification.values[i][1]).toDecimalPlaces(
      cfg.scale,
      Decimal.ROUND_HALF_UP,
    );
    if (!committedA.equals(committedB)) {
      return {
        converged: false,
        values: primary.values,
        iterations: primary.iterations + verification.iterations,
        finalChangeMinor: verification.finalChangeMinor,
      };
    }
  }
  return {
    converged: true,
    values: primary.values,
    iterations: primary.iterations + verification.iterations,
    finalChangeMinor: primary.finalChangeMinor,
  };
}

/* ── SCC detection (Tarjan) ─────────────────────────────────────────────────────────────
 * Iterative (explicit stack) so a deep dependency graph cannot overflow the call stack.
 * Deterministic for a given (nodes, edges) ordering: nodes are visited in the given order and
 * edges in the given order. */

const EMPTY_NEIGHBORS: readonly string[] = [];

/** All strongly connected components of the directed graph (nodes not in `edges` are isolated). */
export function findSCCs(
  nodes: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
): string[][] {
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let nextIndex = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    index.set(root, nextIndex);
    lowLink.set(root, nextIndex);
    nextIndex += 1;
    stack.push(root);
    onStack.add(root);

    const frames: { node: string; cursor: number }[] = [{ node: root, cursor: 0 }];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const neighbors = edges.get(frame.node) ?? EMPTY_NEIGHBORS;
      if (frame.cursor < neighbors.length) {
        const neighbor = neighbors[frame.cursor] as string;
        frame.cursor += 1;
        if (!index.has(neighbor)) {
          index.set(neighbor, nextIndex);
          lowLink.set(neighbor, nextIndex);
          nextIndex += 1;
          stack.push(neighbor);
          onStack.add(neighbor);
          frames.push({ node: neighbor, cursor: 0 });
        } else if (onStack.has(neighbor)) {
          const neighborIndex = index.get(neighbor) as number;
          const frameLow = lowLink.get(frame.node) as number;
          if (neighborIndex < frameLow) lowLink.set(frame.node, neighborIndex);
        }
      } else {
        frames.pop();
        const frameLow = lowLink.get(frame.node) as number;
        if (frames.length > 0) {
          const parent = frames[frames.length - 1].node;
          const parentLow = lowLink.get(parent) as number;
          if (frameLow < parentLow) lowLink.set(parent, frameLow);
        }
        if (frameLow === (index.get(frame.node) as number)) {
          const scc: string[] = [];
          for (;;) {
            const member = stack.pop() as string;
            onStack.delete(member);
            scc.push(member);
            if (member === frame.node) break;
          }
          sccs.push(scc);
        }
      }
    }
  }
  return sccs;
}

/** An SCC is cyclic when it holds ≥ 2 nodes or its single node references itself. */
export function isCyclicScc(
  scc: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
): boolean {
  if (scc.length > 1) return true;
  const [only] = scc;
  if (only === undefined) return false;
  return (edges.get(only) ?? EMPTY_NEIGHBORS).includes(only);
}

/* ── Formula reference scanning / rewriting ────────────────────────────────────────────
 * Pure text-level helpers for the engine's scratch-sheet build: find every cell reference in a
 * formula (string literals excluded) and rewrite it (SCC members → scratch input cells; the
 * Model sheet → qualified refs so the scratch sheet's own addresses do not shadow it). Returns
 * `null` whenever the reference shape cannot be rewritten safely — the SCC then stays flagged
 * `#CYCLE!` (honest refusal, never a guessed rewrite). */

/** A cell reference token in a formula (offsets index the original formula text). */
export interface FormulaReference {
  start: number;
  end: number;
  /** Sheet name when the reference is sheet-qualified; `null` = the formula's own sheet. */
  sheet: string | null;
  /** HF 0-based coordinates of the reference (end equals start for a single cell). */
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/** Sheet-range refs (`Sheet1:Sheet3!A1`) — not used by the product; treated as unsupported. */
const SHEET_RANGE_RE = /:[A-Za-z_][A-Za-z0-9_]*!/;
const STRING_LITERAL_RE = /"[^"]*"/g;
const REFERENCE_RE =
  // The `(?![\d(])` lookahead keeps digit-suffixed function names (`log10`) from being read as cell refs — it also blocks the partial-backtrack match (`log1` before a trailing digit).
  /(?<![A-Za-z0-9_.])(?:('[^']*'|[A-Za-z_][A-Za-z0-9_]*)!)?(\$?[A-Za-z]{1,4}\$?\d+)(?![\d(])(?::(\$?[A-Za-z]{1,4}\$?\d+))?/g;

/** Excel column letters (1-based, case-insensitive) → HF 0-based column index. */
function lettersToCol0(letters: string): number {
  let col = 0;
  for (let i = 0; i < letters.length; i += 1) {
    const code = letters.charCodeAt(i);
    const upper = code >= 97 && code <= 122 ? code - 32 : code; // 'a'..'z' → 'A'..'Z'
    col = col * 26 + (upper - 64);
  }
  return col - 1;
}

function parseCellRef(text: string): { row: number; col: number } | null {
  const match = /^\$?([A-Za-z]{1,4})\$?(\d+)$/.exec(text);
  if (match === null) return null;
  return { col: lettersToCol0(match[1]), row: parseInt(match[2], 10) - 1 };
}

/**
 * Every cell reference in `formula`, in text order. String-literal contents are never scanned;
 * sheet-range refs make the formula unsplittable (returns `[]` so callers refuse to rewrite).
 */
export function findFormulaReferences(formula: string): FormulaReference[] {
  if (formula.length === 0) return [];
  if (SHEET_RANGE_RE.test(formula)) return [];
  const masked = formula.replace(STRING_LITERAL_RE, (m) => "\u0000".repeat(m.length));
  const refs: FormulaReference[] = [];
  REFERENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REFERENCE_RE.exec(masked)) !== null) {
    const rawStart = match[2];
    const rawEnd = match[3] ?? rawStart;
    const start = parseCellRef(rawStart);
    const end = parseCellRef(rawEnd);
    if (start === null || end === null) continue;
    const sheet = match[1] !== undefined ? match[1].replace(/^'/, "").replace(/'$/, "") : null;
    refs.push({
      start: match.index,
      end: match.index + match[0].length,
      sheet,
      startRow: start.row,
      startCol: start.col,
      endRow: end.row,
      endCol: end.col,
    });
  }
  return refs;
}

/**
 * Rewrite every reference of `formula` via `rewrite(ref)` (the original span text is
 * `formula.slice(ref.start, ref.end)`). Returns `null` when any reference refuses the rewrite
 * (`rewrite` returns `null`) — the caller keeps the SCC unsolved. Spans never overlap (the
 * scanner consumes range endpoints), so the replacement is a plain left-to-right splice.
 */
export function rewriteFormulaReferences(
  formula: string,
  rewrite: (ref: FormulaReference) => string | null,
): string | null {
  const refs = findFormulaReferences(formula);
  let out = "";
  let cursor = 0;
  for (const ref of refs) {
    const replacement = rewrite(ref);
    if (replacement === null) return null;
    out += formula.slice(cursor, ref.start) + replacement;
    cursor = ref.end;
  }
  return out + formula.slice(cursor);
}
