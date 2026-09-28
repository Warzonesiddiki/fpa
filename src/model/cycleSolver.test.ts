/**
 * AUDIT-04 — SCC cycle relaxation solver (FORMULA-ENGINE-SPEC §5).
 *
 * Every expected value below is hand-computed (fixed points solved in exact rational arithmetic)
 * before the first run. The property test uses a fixed-seed PRNG — the solver itself is fully
 * deterministic (fixed sweep order, fixed seeds, IEEE-754 only).
 */
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  CYCLE_SOLVER_PROBE_SEED,
  CYCLE_SOLVER_TOLERANCE_MINOR,
  DEFAULT_CYCLE_SOLVER_CONFIG,
  findFormulaReferences,
  findSCCs,
  isCyclicScc,
  relaxationToleranceMajor,
  rewriteFormulaReferences,
  solveCyclicScc,
  type CycleSolveRuntime,
} from "./cycleSolver";

/* ── deterministic PRNG (fixed seed — property tests must be reproducible) ──────────── */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Affine-system runtime: node i evaluates f_i(x) = c_i + Σ_j w_ij · x_j. */
function affineRuntime(weights: number[][], constants: number[]): CycleSolveRuntime {
  const n = weights.length;
  const node = (j: number): string => `n${j}`;
  return {
    evaluate: (ref, current) => {
      const i = parseInt(ref.slice(1), 10);
      let value = constants[i] ?? 0;
      const row = weights[i];
      if (row === undefined) return null; // unreachable in tests: node names are n{0..n-1}
      for (let j = 0; j < n; j += 1) value += (row[j] ?? 0) * (current.get(node(j)) ?? 0);
      return value;
    },
    write: () => undefined,
  };
}

const NODES3 = ["n0", "n1", "n2"];

describe("relaxationToleranceMajor — the spec's 0.0001 minor units in major units", () => {
  it("is exact per currency scale (decimal, never binary drift)", () => {
    expect(relaxationToleranceMajor({ ...DEFAULT_CYCLE_SOLVER_CONFIG, scale: 2 })).toBe(0.000001);
    expect(relaxationToleranceMajor({ ...DEFAULT_CYCLE_SOLVER_CONFIG, scale: 0 })).toBe(0.0001);
    expect(relaxationToleranceMajor({ ...DEFAULT_CYCLE_SOLVER_CONFIG, scale: 3 })).toBe(0.0000001);
  });
});

describe("findSCCs — Tarjan strongly connected components", () => {
  const edges = (pairs: [string, string][]): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const [from, to] of pairs) {
      const list = map.get(from) ?? [];
      list.push(to);
      map.set(from, list);
    }
    return map;
  };

  // Tarjan emits SCCs (and their members) in DFS-completion order — the engine never depends on
  // that, so multi-member expectations compare member SETS, not sequences.
  const hasScc = (sccs: string[][], want: string[]): boolean =>
    sccs.some((scc) => [...scc].sort().join("|") === [...want].sort().join("|"));

  it("returns all singletons for a DAG (no cyclic SCCs)", () => {
    // Tarjan emits SCCs in completion (reverse-topological) order — compare order-independently.
    const sccs = findSCCs(
      ["a", "b", "c"],
      edges([
        ["a", "b"],
        ["b", "c"],
      ]),
    );
    expect(sccs.length).toBe(3);
    expect(sccs.every((scc) => scc.length === 1)).toBe(true);
    expect([...sccs.flat()].sort()).toEqual(["a", "b", "c"]);
    for (const scc of sccs)
      expect(
        isCyclicScc(
          scc,
          edges([
            ["a", "b"],
            ["b", "c"],
          ]),
        ),
      ).toBe(false);
  });

  it("detects a 2-cycle with a tail node outside it", () => {
    const g = edges([
      ["a", "b"],
      ["b", "a"],
      ["a", "c"],
    ]);
    const sccs = findSCCs(["a", "b", "c"], g);
    expect(hasScc(sccs, ["a", "b"])).toBe(true);
    expect(hasScc(sccs, ["c"])).toBe(true);
    expect(sccs.find((scc) => scc.includes("a") && scc.includes("b"))?.length).toBe(2);
  });

  it("detects a 3-cycle, a self-loop, and an acyclic node together", () => {
    const g = edges([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
      ["d", "d"],
      ["e", "a"],
    ]);
    const sccs = findSCCs(["a", "b", "c", "d", "e"], g);
    expect(hasScc(sccs, ["a", "b", "c"])).toBe(true);
    expect(hasScc(sccs, ["d"])).toBe(true);
    expect(hasScc(sccs, ["e"])).toBe(true);
    const self = sccs.find((scc) => scc.length === 1 && scc[0] === "d");
    expect(isCyclicScc(self as string[], g)).toBe(true);
    const acyclic = sccs.find((scc) => scc.length === 1 && scc[0] === "e");
    expect(isCyclicScc(acyclic as string[], g)).toBe(false);
  });

  it("merges overlapping cycles sharing a node into one SCC", () => {
    // a→b→a and b→c→b share b → one 3-node SCC {a, b, c}.
    const g = edges([
      ["a", "b"],
      ["b", "a"],
      ["b", "c"],
      ["c", "b"],
    ]);
    const sccs = findSCCs(["a", "b", "c"], g);
    expect(sccs.length).toBe(1);
    expect([...sccs[0]].sort()).toEqual(["a", "b", "c"]);
    expect(isCyclicScc(sccs[0], g)).toBe(true);
  });

  it("handles disconnected components and isolated nodes", () => {
    const g = edges([
      ["a", "b"],
      ["b", "a"],
      ["x", "y"],
      ["y", "z"],
      ["z", "x"],
    ]);
    const sccs = findSCCs(["a", "b", "w", "x", "y", "z"], g);
    expect(hasScc(sccs, ["a", "b"])).toBe(true);
    expect(hasScc(sccs, ["x", "y", "z"])).toBe(true);
    expect(hasScc(sccs, ["w"])).toBe(true);
  });

  it("is deterministic: same input order → identical output, run after run", () => {
    const g = edges([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
      ["d", "a"],
    ]);
    const first = findSCCs(["a", "b", "c", "d"], g);
    const second = findSCCs(["a", "b", "c", "d"], g);
    expect(second).toEqual(first);
  });

  it("stays correct on a deep chain without stack overflow", () => {
    const n = 5000;
    const nodes = Array.from({ length: n }, (_, i) => `v${i}`);
    const g = edges(nodes.slice(0, -1).map((node, i) => [node, nodes[i + 1]] as [string, string]));
    const sccs = findSCCs(nodes, g);
    expect(sccs.length).toBe(n);
    expect(sccs.every((scc) => scc.length === 1)).toBe(true);
  });
});

describe("solveCyclicScc — damped Gauss-Seidel (α=0.5, ≤100 sweeps, 0.0001 minor units)", () => {
  it("converges the trivial fixed point x = 0.5x + 1 to exactly 2", () => {
    const result = solveCyclicScc(["n0"], affineRuntime([[0.5]], [1]));
    expect(result.converged).toBe(true);
    expect(result.values[0][1]).toBeCloseTo(2, 5);
    expect(result.finalChangeMinor).toBeLessThanOrEqual(CYCLE_SOLVER_TOLERANCE_MINOR);
  });

  it("converges a 3-node debt loop to the hand-computed fixed point", () => {
    // a = 0.2b + 10;  b = 0.2c + 5;  c = 0.2a
    // → a = 11/0.992 = 11.088709677419355 · b = 0.04a + 5 = 5.443548387096774 · c = 0.2a = 2.217741935483871
    const result = solveCyclicScc(
      NODES3,
      affineRuntime(
        [
          [0, 0.2, 0],
          [0, 0, 0.2],
          [0.2, 0, 0],
        ],
        [10, 5, 0],
      ),
    );
    expect(result.converged).toBe(true);
    // a = 10·110887/10000 → 11.088709677419355, b = 5.443548387096774, c = 2.217741935483871
    expect(result.values[0][1]).toBeCloseTo(11.08871, 5);
    expect(result.values[1][1]).toBeCloseTo(5.44355, 5);
    expect(result.values[2][1]).toBeCloseTo(2.21774, 5);
    expect(result.finalChangeMinor).toBeLessThanOrEqual(CYCLE_SOLVER_TOLERANCE_MINOR);
    // A tight contraction needs far fewer than the 100-sweep budget (two probes included).
    expect(result.iterations).toBeLessThan(100);
  });

  it("scales the convergence tolerance with currency scale (scale-0 JPY vs scale-2 USD)", () => {
    // x = 0.8x + 1 → x* = 5. The per-sweep change shrinks ×0.9/sweep (α=0.5 damped on a 0.8
    // gain): at scale 0 (tolerance 0.0001 MAJOR = 1e-4) both probes stop well inside the 100
    // sweep budget (82 + 80 sweeps); at scale 2 (tolerance 1e-6) the SAME loop exhausts the
    // budget — the tolerance really is minor-unit-scaled, not a fixed major-unit constant.
    const jpy = solveCyclicScc(["n0"], affineRuntime([[0.8]], [1]), { scale: 0 });
    expect(jpy.converged).toBe(true);
    expect(jpy.iterations).toBe(162);
    expect(jpy.finalChangeMinor).toBeLessThanOrEqual(CYCLE_SOLVER_TOLERANCE_MINOR);
    // At the model's scale the solved value commits to the fixed point's committed value.
    expect(new Decimal(jpy.values[0][1]).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString()).toBe(
      "5",
    );
    const usd = solveCyclicScc(["n0"], affineRuntime([[0.8]], [1]), { scale: 2 });
    expect(usd.converged).toBe(false);
    expect(usd.iterations).toBe(100);
    expect(usd.finalChangeMinor).toBeGreaterThan(CYCLE_SOLVER_TOLERANCE_MINOR);
  });

  it("runs both probes and reports the combined sweep count", () => {
    const result = solveCyclicScc(["n0"], affineRuntime([[0.5]], [1]));
    // Both probes converge; the reported iterations span probe A + probe B.
    expect(result.iterations).toBeGreaterThanOrEqual(2);
    expect(result.values).toHaveLength(1);
  });

  it("is deterministic: identical inputs produce identical solutions", () => {
    const runtime = affineRuntime(
      [
        [0, 0.2, 0],
        [0, 0, 0.2],
        [0.2, 0, 0],
      ],
      [10, 5, 0],
    );
    const first = solveCyclicScc(NODES3, runtime);
    const second = solveCyclicScc(NODES3, runtime);
    expect(second.values).toEqual(first.values);
    expect(second.iterations).toBe(first.iterations);
    expect(second.finalChangeMinor).toBe(first.finalChangeMinor);
  });

  it("re-seeds the runtime to each probe seed before its first evaluation", () => {
    const writes: number[] = [];
    const runtime: CycleSolveRuntime = {
      evaluate: (ref, current) => 0.5 * (current.get(ref) ?? 0) + 1,
      write: (_ref, value) => writes.push(value),
    };
    solveCyclicScc(["x"], runtime);
    // Probe A seeds 0, probe B seeds the unit probe — both visible before any evaluation.
    expect(writes[0]).toBe(0);
    expect(writes).toContain(CYCLE_SOLVER_PROBE_SEED);
  });
});

describe("solveCyclicScc — spec divergence & non-unique cases (must stay #CYCLE!)", () => {
  it("rejects the spec's `=A1*2` self-loop (trivial zero fixed point is not a solution)", () => {
    const result = solveCyclicScc(["n0"], affineRuntime([[2]], [0]));
    expect(result.converged).toBe(false);
  });

  it("rejects a multiplicative 2-cycle a = 2b, b = a (divergent probe)", () => {
    const result = solveCyclicScc(
      ["n0", "n1"],
      affineRuntime(
        [
          [0, 2],
          [1, 0],
        ],
        [0, 0],
      ),
    );
    expect(result.converged).toBe(false);
  });

  it("rejects a non-unique fixed-point family a = b, b = a (probes disagree)", () => {
    const result = solveCyclicScc(
      ["n0", "n1"],
      affineRuntime(
        [
          [0, 1],
          [1, 0],
        ],
        [0, 0],
      ),
    );
    expect(result.converged).toBe(false);
  });

  it("reports non-convergence when the 100-sweep budget is exhausted", () => {
    // x = 0.9999x + 10000: fixed point 1e8, contraction 0.9995/sweep — after 100 sweeps the
    // per-sweep change (~4.9e3) is still ~4.9e6× above the 1e-6 major tolerance.
    const result = solveCyclicScc(["n0"], affineRuntime([[0.9999]], [10000]));
    expect(result.converged).toBe(false);
    expect(result.iterations).toBe(100);
    expect(result.finalChangeMinor).toBeGreaterThan(CYCLE_SOLVER_TOLERANCE_MINOR);
  });

  it("aborts fast on an evaluation error (null) and reports Infinity change", () => {
    const runtime: CycleSolveRuntime = {
      evaluate: (ref, current) => (ref === "n1" ? null : 0.5 * (current.get("n0") ?? 0)),
      write: () => undefined,
    };
    const result = solveCyclicScc(["n0", "n1"], runtime);
    expect(result.converged).toBe(false);
    expect(result.finalChangeMinor).toBe(Infinity);
    expect(result.iterations).toBeLessThan(100);
  });

  it("solves an empty SCC trivially", () => {
    const result = solveCyclicScc([], { evaluate: () => 0, write: () => undefined });
    expect(result).toEqual({ converged: true, values: [], iterations: 0, finalChangeMinor: 0 });
  });
});

describe("solveCyclicScc — AUDIT-04 property evidence: 100 random cyclic graphs converge", () => {
  it("converges every random cyclic contraction (fixed seed 20260923)", () => {
    const rand = mulberry32(20260923);
    for (let trial = 0; trial < 100; trial += 1) {
      const n = 2 + Math.floor(rand() * 7); // 2..8 nodes
      const nodes = Array.from({ length: n }, (_, i) => `n${i}`);
      // Ring topology (guaranteed cycle) + random extra edges; per-node weight sum ≤ 0.5
      // (a strict contraction — realistic debt-loop gains are far lower).
      const weights: number[][] = Array.from({ length: n }, () =>
        Array.from({ length: n }, () => 0),
      );
      for (let i = 0; i < n; i += 1) {
        weights[i][(i + 1) % n] += 0.5 / Math.max(1, n - 1);
        for (let j = 0; j < n; j += 1) {
          if (j === i) continue;
          if (rand() < 0.25) weights[i][j] += rand() * (0.5 / Math.max(1, n - 1));
        }
      }
      const constants = Array.from({ length: n }, () => (rand() * 2 - 1) * 1000);
      const runtime: CycleSolveRuntime = {
        evaluate: (ref, current) => {
          const i = parseInt(ref.slice(1), 10);
          let value = constants[i];
          for (let j = 0; j < n; j += 1) value += weights[i][j] * (current.get(`n${j}`) ?? 0);
          return value;
        },
        write: () => undefined,
      };
      const result = solveCyclicScc(nodes, runtime);
      expect(result.converged, `trial ${trial}: n=${n} diverged`).toBe(true);
      // Fixed-point residual check: at the solution, f_i(x*) ≈ x*_i (the loop is closed).
      for (let i = 0; i < n; i += 1) {
        let value = constants[i];
        for (let j = 0; j < n; j += 1) value += weights[i][j] * result.values[j][1];
        expect(
          Math.abs(value - result.values[i][1]),
          `trial ${trial} node ${i}: residual`,
        ).toBeLessThan(1e-4);
      }
      for (const [, value] of result.values) expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe("findFormulaReferences — cell reference scanning", () => {
  it("finds a bare single-cell reference (0-based HF coordinates)", () => {
    expect(findFormulaReferences("=B2")).toEqual([
      { start: 1, end: 3, sheet: null, startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
    ]);
  });

  it("finds absolute references at the same coordinates", () => {
    expect(findFormulaReferences("=$B$2")).toEqual([
      { start: 1, end: 5, sheet: null, startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
    ]);
  });

  it("finds a same-sheet range once (endpoints, 0-based)", () => {
    expect(findFormulaReferences("=SUM(B2:B5)")).toEqual([
      { start: 5, end: 10, sheet: null, startRow: 1, startCol: 1, endRow: 4, endCol: 1 },
    ]);
  });

  it("resolves sheet-qualified references, quoted and bare", () => {
    const quoted = findFormulaReferences("='Opex Detail'!C10");
    expect(quoted).toHaveLength(1);
    expect(quoted[0].sheet).toBe("Opex Detail");
    expect(quoted[0].startCol).toBe(2);
    expect(quoted[0].startRow).toBe(9);

    const bare = findFormulaReferences("=Model!B2");
    expect(bare).toHaveLength(1);
    expect(bare[0].sheet).toBe("Model");
  });

  it("keeps other-sheet references qualified and finds multiple refs", () => {
    const refs = findFormulaReferences("=Drivers!B2*B3");
    expect(refs).toHaveLength(2);
    expect(refs[0].sheet).toBe("Drivers");
    expect(refs[1].sheet).toBe(null);
    // `B3` — column B is 0-based index 1, row 3 is 0-based index 2.
    expect(refs[1].startCol).toBe(1);
    expect(refs[1].startRow).toBe(2);
  });

  it("never scans inside string literals", () => {
    expect(findFormulaReferences('="B2"')).toEqual([]);
    expect(findFormulaReferences('"A1" & B2')).toEqual([
      { start: 7, end: 9, sheet: null, startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
    ]);
  });

  it("does not misread identifiers or numbers as references", () => {
    expect(findFormulaReferences("=wage_inflation * 2")).toEqual([]);
    // `log10` is a function name, not a cell reference — the `(?![\d(])` lookahead excludes it,
    // including the partial backtracked match (`log1` before the trailing digit).
    expect(findFormulaReferences("=log10(B2)")).toEqual([
      { start: 7, end: 9, sheet: null, startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
    ]);
    expect(findFormulaReferences("=123+B2")).toEqual([
      { start: 5, end: 7, sheet: null, startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
    ]);
  });

  it("returns [] for sheet-range refs (unsupported shape — caller refuses)", () => {
    expect(findFormulaReferences("=Sheet1:Sheet3!A1")).toEqual([]);
  });

  it("handles multi-column ranges and repeated references", () => {
    const multi = findFormulaReferences("=SUM($A$1:$D$5)");
    expect(multi).toHaveLength(1);
    expect(multi[0]).toMatchObject({ startRow: 0, startCol: 0, endRow: 4, endCol: 3 });

    const repeated = findFormulaReferences("=B2+C3-B2");
    expect(repeated).toHaveLength(3);
    expect(repeated.map((r) => [r.startRow, r.startCol])).toEqual([
      [1, 1],
      [2, 2],
      [1, 1],
    ]);
  });
});

describe("rewriteFormulaReferences — span replacement for the solver scratch sheet", () => {
  it("rewrites each reference and preserves the rest of the formula", () => {
    const out = rewriteFormulaReferences("=SUM(B2:B5)*Drivers!C9 + 1", (ref) => {
      if (ref.sheet === "Drivers") return ref.sheet; // keep other sheets as-is (marker)
      return `CycleSolver!B${ref.startRow + 1}`;
    });
    expect(out).toBe("=SUM(CycleSolver!B2)*Drivers + 1");
  });

  it("returns the formula unchanged when it has no references", () => {
    expect(rewriteFormulaReferences("=wage_inflation * 100", () => "x")).toBe(
      "=wage_inflation * 100",
    );
  });

  it("propagates a refusal (null) without partial rewrites", () => {
    const out = rewriteFormulaReferences("=B2+C3", (ref) => (ref.startCol === 1 ? "X" : null));
    expect(out).toBeNull();
  });

  it("returns [] rewrites for an unsupported formula shape (sheet range)", () => {
    // findFormulaReferences returns [] for sheet ranges → the formula passes through untouched;
    // the ENGINE refuses to solve such SCCs upstream (documented in modelEngine refresh).
    expect(rewriteFormulaReferences("=Sheet1:Sheet3!A1", () => "X")).toBe("=Sheet1:Sheet3!A1");
  });
});
