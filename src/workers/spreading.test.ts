import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  largestRemainderAllocate,
  SpreadError,
  spreadTotal,
  toScaleText,
  validateWeights,
  WEIGHT_TOLERANCE,
} from "./spreading";

const P12 = Array.from({ length: 12 }, (_, i) => `fp-2027-p${String(i + 1).padStart(2, "0")}`);
const P13 = [...P12, "fp-2027-p13"];

function sumOf(values: { amount_text: string }[]): string {
  return values.reduce((acc, v) => acc.plus(v.amount_text), new Decimal(0)).toString();
}

/** SaaS Q4-heavy curve (fractions, 6 dp — MONEY-ROUNDING-SPEC §6) — sums to exactly 1.000000. */
const SAAS_Q4_HEAVY = [
  "0.060000",
  "0.060000",
  "0.070000",
  "0.070000",
  "0.070000",
  "0.080000",
  "0.080000",
  "0.080000",
  "0.090000",
  "0.100000",
  "0.110000",
  "0.130000",
];

describe("Period Spreading — MODELING-METHODS-SPEC §3 (M3-5 · F-015 · US-016)", () => {
  it("equal: 12M over 12 periods is exactly 1,000,000.00 each (§3.1)", () => {
    const r = spreadTotal({ total: "12000000.00", periodIds: P12, method: "equal", scale: 2 });
    expect(r.values).toHaveLength(12);
    expect(new Set(r.values.map((v) => v.amount_text))).toEqual(new Set(["1000000.00"]));
    expect(r.sum_text).toBe("12000000.00");
    expect(r.excluded).toEqual([]);
    expect(r.normalized).toBe(false);
  });

  it("equal: an indivisible total settles the residual on the LAST period, Σ == T (§3.1)", () => {
    // 100.00 / 12 = 8.3333… → 11 × 8.33 + 8.37 (residual 0.04 = 4 units of 0.01 via LRA).
    const r = spreadTotal({ total: "100.00", periodIds: P12, method: "equal", scale: 2 });
    expect(sumOf(r.values)).toBe("100");
    // Equal remainders everywhere → tie-break "last": the extra cents go to the tail periods.
    expect(r.values.slice(0, 8).every((v) => v.amount_text === "8.33")).toBe(true);
    expect(r.values.slice(8).every((v) => v.amount_text === "8.34")).toBe(true);
    expect(r.values[11].period_id).toBe("fp-2027-p12");
  });

  it("equal: 3-way split of 10 at scale 0 → 3/3/4 (residual to the last period)", () => {
    const r = spreadTotal({ total: "10", periodIds: P12.slice(0, 3), method: "equal", scale: 0 });
    expect(r.values.map((v) => v.amount_text)).toEqual(["3", "3", "4"]);
  });

  it("seasonal: US-016 ₹12M with the SaaS Q4-heavy curve sums exactly to ₹12M (§3.2)", () => {
    const r = spreadTotal({
      total: "12000000.00",
      periodIds: P12,
      method: "seasonal",
      weights: SAAS_Q4_HEAVY,
      scale: 2,
    });
    expect(r.values[11].amount_text).toBe("1560000.00"); // 13%
    expect(r.values[0].amount_text).toBe("720000.00"); // 6%
    expect(r.sum_text).toBe("12000000.00");
    expect(sumOf(r.values)).toBe("12000000");
  });

  it("seasonal: weights totalling ≠ 100% → HARD SPREAD_WEIGHTS_INVALID with the documented text", () => {
    const off = [...SAAS_Q4_HEAVY];
    off[11] = "0.150000"; // 102%
    let caught: unknown;
    try {
      spreadTotal({ total: "1000.00", periodIds: P12, method: "seasonal", weights: off, scale: 2 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SpreadError);
    const err = caught as SpreadError;
    expect(err.code).toBe("SPREAD_WEIGHTS_INVALID");
    expect(err.userMessage).toBe("Seasonality weights total 102% — normalize to 100% or fix.");
    expect(err.details).toMatchObject({ sum: "102", canNormalize: true });
    expect(err.message.startsWith("SPREAD_WEIGHTS_INVALID:")).toBe(true);
  });

  it("seasonal: never silently normalises — only the explicit choice rescales, and it is flagged", () => {
    const off = ["0.5", "0.5", "0.5"]; // 150%
    const ids = P12.slice(0, 3);
    expect(() =>
      spreadTotal({ total: "300.00", periodIds: ids, method: "seasonal", weights: off, scale: 2 }),
    ).toThrow(/SPREAD_WEIGHTS_INVALID/);
    const r = spreadTotal({
      total: "300.00",
      periodIds: ids,
      method: "seasonal",
      weights: off,
      normalize: true,
      scale: 2,
    });
    expect(r.normalized).toBe(true);
    expect(r.values.map((v) => v.amount_text)).toEqual(["100.00", "100.00", "100.00"]);
  });

  it("seasonal: all-zero weights cannot be normalised (canNormalize=false)", () => {
    let err: SpreadError | null = null;
    try {
      spreadTotal({
        total: "10.00",
        periodIds: P12.slice(0, 2),
        method: "seasonal",
        weights: ["0", "0"],
        normalize: true,
        scale: 2,
      });
    } catch (e) {
      err = e as SpreadError;
    }
    expect(err?.code).toBe("SPREAD_WEIGHTS_INVALID");
    expect(err?.details.canNormalize).toBe(false);
  });

  it("seasonal: weights within ±1e-6 of 1.00 are accepted verbatim; 4e-6 off is rejected (MONEY §6)", () => {
    // 11 × 0.0833333 + 0.0833332 = 0.9999995 → |Δ| = 5e-7 ≤ 1e-6: accepted, not normalised.
    const within = [...P12.slice(1).map(() => "0.0833333"), "0.0833332"];
    const r = spreadTotal({
      total: "1200.00",
      periodIds: P12,
      method: "seasonal",
      weights: within,
      scale: 2,
    });
    expect(r.normalized).toBe(false);
    expect(sumOf(r.values)).toBe("1200");
    expect(WEIGHT_TOLERANCE.toString()).toBe("0.000001");
    // 12 × 0.083333 = 0.999996 → |Δ| = 4e-6 > 1e-6: HARD (the 6-dp curve must be fixed or normalised).
    expect(() =>
      spreadTotal({
        total: "1200.00",
        periodIds: P12,
        method: "seasonal",
        weights: P12.map(() => "0.083333"),
        scale: 2,
      }),
    ).toThrow(/SPREAD_WEIGHTS_INVALID/);
  });

  it("seasonal + 13-period calendar: excluding P13 re-normalises the remaining weights and flags it (§3.5)", () => {
    const w13 = [...SAAS_Q4_HEAVY.map(() => "0.070000"), "0.160000"]; // 12×7% + 16% = 100%
    const r = spreadTotal({
      total: "8400.00",
      periodIds: P13,
      method: "seasonal",
      weights: w13,
      excludePeriodIds: ["fp-2027-p13"],
      scale: 2,
    });
    expect(r.excluded).toEqual(["fp-2027-p13"]);
    expect(r.values).toHaveLength(12);
    expect(r.values.every((v) => v.amount_text === "700.00")).toBe(true);
    expect(r.sum_text).toBe("8400.00");
  });

  it("custom: per-period amounts that sum to T pass through at scale (§3.3)", () => {
    const ids = P12.slice(0, 3);
    const r = spreadTotal({
      total: "100.00",
      periodIds: ids,
      method: "custom",
      amounts: ["10", "20.5", "69.5"],
      scale: 2,
    });
    expect(r.values.map((v) => v.amount_text)).toEqual(["10.00", "20.50", "69.50"]);
  });

  it("custom: Σ ≠ T is HARD with the residual in details; explicit normalise rescales exactly", () => {
    const ids = P12.slice(0, 2);
    let err: SpreadError | null = null;
    try {
      spreadTotal({
        total: "100.00",
        periodIds: ids,
        method: "custom",
        amounts: ["30", "30"],
        scale: 2,
      });
    } catch (e) {
      err = e as SpreadError;
    }
    expect(err?.code).toBe("SPREAD_WEIGHTS_INVALID");
    expect(err?.details).toMatchObject({
      mode: "custom",
      canNormalize: true,
      sumAmount: "60",
      total: "100",
      residual: "40",
    });
    expect(err?.userMessage).toBe("Seasonality weights total 60% — normalize to 100% or fix.");

    const r = spreadTotal({
      total: "100.00",
      periodIds: ids,
      method: "custom",
      amounts: ["30", "30"],
      normalize: true,
      scale: 2,
    });
    expect(r.normalized).toBe(true);
    expect(r.values.map((v) => v.amount_text)).toEqual(["50.00", "50.00"]);
  });

  it("lump: period → amount map fills the rest with 0 and Σ must equal T — no normalise offer (§3.4)", () => {
    const r = spreadTotal({
      total: "5000.00",
      periodIds: P12,
      method: "lump",
      lumps: { "fp-2027-p03": "2000.00", "fp-2027-p09": "3000.00" },
      scale: 2,
    });
    expect(r.values[2].amount_text).toBe("2000.00");
    expect(r.values[8].amount_text).toBe("3000.00");
    expect(r.values.filter((v) => v.amount_text === "0.00")).toHaveLength(10);

    let err: SpreadError | null = null;
    try {
      spreadTotal({
        total: "5000.00",
        periodIds: P12,
        method: "lump",
        lumps: { "fp-2027-p03": "2000.00" },
        normalize: true, // must be ignored for lumps
        scale: 2,
      });
    } catch (e) {
      err = e as SpreadError;
    }
    expect(err?.code).toBe("SPREAD_WEIGHTS_INVALID");
    expect(err?.details).toMatchObject({ mode: "lump", canNormalize: false, residual: "3000" });
  });

  it("lump: rejects periods outside the horizon or excluded from the plan (VALUE_INVALID)", () => {
    expect(() =>
      spreadTotal({
        total: "1",
        periodIds: P12,
        method: "lump",
        lumps: { "fp-2099-p01": "1" },
        scale: 0,
      }),
    ).toThrow(/VALUE_INVALID/);
    expect(() =>
      spreadTotal({
        total: "1",
        periodIds: P13,
        method: "lump",
        lumps: { "fp-2027-p13": "1" },
        excludePeriodIds: ["fp-2027-p13"],
        scale: 0,
      }),
    ).toThrow(/VALUE_INVALID/);
  });

  it("rejects non-decimal input, a total finer than the currency scale, empty horizons and bad scales (VALUE_INVALID)", () => {
    expect(() => spreadTotal({ total: "1e3", periodIds: P12, method: "equal", scale: 2 })).toThrow(
      /VALUE_INVALID/,
    );
    expect(() =>
      spreadTotal({ total: "10.005", periodIds: P12, method: "equal", scale: 2 }),
    ).toThrow(/VALUE_INVALID/);
    expect(() => spreadTotal({ total: "10", periodIds: [], method: "equal", scale: 2 })).toThrow(
      /VALUE_INVALID/,
    );
    expect(() =>
      spreadTotal({ total: "10", periodIds: ["a", "a"], method: "equal", scale: 2 }),
    ).toThrow(/VALUE_INVALID/);
    expect(() => spreadTotal({ total: "10", periodIds: P12, method: "equal", scale: 5 })).toThrow(
      /VALUE_INVALID/,
    );
    expect(() =>
      spreadTotal({
        total: "10",
        periodIds: P12,
        method: "equal",
        excludePeriodIds: P12,
        scale: 2,
      }),
    ).toThrow(/VALUE_INVALID/);
    expect(() =>
      spreadTotal({ total: "10", periodIds: P12, method: "seasonal", weights: ["1"], scale: 2 }),
    ).toThrow(/VALUE_INVALID/);
    expect(() =>
      spreadTotal({ total: "10", periodIds: P12, method: "custom", amounts: ["1"], scale: 2 }),
    ).toThrow(/VALUE_INVALID/);
    expect(() => validateWeights(["-0.5", "1.5"], 2)).toThrow(/VALUE_INVALID/);
  });

  it("negative totals (cost lines) spread exactly as well", () => {
    const r = spreadTotal({
      total: "-100.00",
      periodIds: P12.slice(0, 3),
      method: "equal",
      scale: 2,
    });
    expect(sumOf(r.values)).toBe("-100");
    expect(r.values.map((v) => v.amount_text)).toEqual(["-33.34", "-33.33", "-33.33"]);
  });

  it("JPY (scale 0) and KWD (scale 3) honour the Currency Scale", () => {
    const jpy = spreadTotal({
      total: "1000",
      periodIds: P12.slice(0, 3),
      method: "equal",
      scale: 0,
    });
    expect(jpy.values.map((v) => v.amount_text)).toEqual(["333", "333", "334"]);
    const kwd = spreadTotal({
      total: "1.000",
      periodIds: P12.slice(0, 3),
      method: "equal",
      scale: 3,
    });
    expect(kwd.values.map((v) => v.amount_text)).toEqual(["0.333", "0.333", "0.334"]);
  });

  it("property: Σ values == T exactly across a deterministic sweep of totals, horizons and curves", () => {
    // Deterministic LCG so the sweep is reproducible without a proptest dependency (B13 — no new deps).
    let seed = 20260903;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let iter = 0; iter < 400; iter += 1) {
      const scale = [0, 2, 3][next() % 3];
      const n = 1 + (next() % 13);
      const ids = Array.from({ length: n }, (_, i) => `fp-${i + 1}`);
      const minor = new Decimal(next() % 100000000).minus(50000000);
      const total = toScaleText(minor.div(new Decimal(10).pow(scale)), scale);
      const equal = spreadTotal({ total, periodIds: ids, method: "equal", scale });
      expect(sumOf(equal.values)).toBe(new Decimal(total).toString());
      const raw = ids.map(() => new Decimal(1 + (next() % 1000)));
      const rawSum = raw.reduce((a, b) => a.plus(b), new Decimal(0));
      const weights = raw.map((w) =>
        w.div(rawSum).toDecimalPlaces(8, Decimal.ROUND_DOWN).toString(),
      );
      const seasonal = spreadTotal({
        total,
        periodIds: ids,
        method: "seasonal",
        weights,
        normalize: true, // ROUND_DOWN makes the sum fall short by up to n×1e-8 — an explicit choice
        scale,
      });
      expect(sumOf(seasonal.values)).toBe(new Decimal(total).toString());
      for (const v of seasonal.values) {
        expect(new Decimal(v.amount_text).decimalPlaces()).toBeLessThanOrEqual(scale);
      }
    }
  });
});

describe("Largest-Remainder Allocation mirror (MONEY-ROUNDING-SPEC §4 / core/money.rs)", () => {
  const d = (s: string) => new Decimal(s);

  it("spec vector: 12.4 / 3.7 / 7.9 at unit 1 → 12 / 4 / 8 (largest remainder first), Σ 24", () => {
    const out = largestRemainderAllocate([d("12.4"), d("3.7"), d("7.9")], d("1"));
    expect(out.map(String)).toEqual(["12", "4", "8"]);
  });

  it("spec vector: 1234.44 / 2665.56 / 100.00 at 0.1 → Σ 4000.0 and the .56 line rounds up", () => {
    const out = largestRemainderAllocate([d("1234.44"), d("2665.56"), d("100.00")], d("0.1"));
    expect(out.reduce((a, b) => a.plus(b), d("0")).toString()).toBe("4000");
    expect(out[1].gt("2665.5")).toBe(true);
    expect(out.map(String)).toEqual(["1234.4", "2665.6", "100"]);
  });

  it("tie-break: 'first' prefers the lowest index (Rust parity), 'last' the highest (§3.1 equal spread)", () => {
    const thirds = [d("1").div(3), d("1").div(3), d("1").div(3)];
    expect(largestRemainderAllocate(thirds, d("0.01"), "first").map(String)).toEqual([
      "0.34",
      "0.33",
      "0.33",
    ]);
    expect(largestRemainderAllocate(thirds, d("0.01"), "last").map(String)).toEqual([
      "0.33",
      "0.33",
      "0.34",
    ]);
  });

  it("empty input → empty output; non-positive unit and off-grid targets are rejected", () => {
    expect(largestRemainderAllocate([], d("1"))).toEqual([]);
    expect(() => largestRemainderAllocate([d("1")], d("0"))).toThrow(/VALUE_INVALID/);
    expect(() => largestRemainderAllocate([d("1")], d("1"), "first", d("1.5"))).toThrow(
      /VALUE_INVALID/,
    );
  });

  it("negative residual (§4 step 4d) takes units back from the smallest remainders first", () => {
    // Values already on the grid sum to 6; forcing target 4 removes 2 units — deterministically
    // from the lowest remainders (all zero → index order) and the result still sums to target.
    const out = largestRemainderAllocate([d("2"), d("2"), d("2")], d("1"), "first", d("4"));
    expect(out.map(String)).toEqual(["1", "1", "2"]);
    const last = largestRemainderAllocate([d("2"), d("2"), d("2")], d("1"), "last", d("4"));
    expect(last.map(String)).toEqual(["2", "1", "1"]);
  });

  it("toScaleText renders exact fixed-scale strings without float or exponent forms", () => {
    expect(toScaleText(d("1000"), 2)).toBe("1000.00");
    expect(toScaleText(d("0"), 2)).toBe("0.00");
    expect(toScaleText(d("-0.5"), 2)).toBe("-0.50");
    expect(toScaleText(d("0.005"), 2)).toBe("0.01");
    expect(toScaleText(d("-0.005"), 2)).toBe("-0.01");
    expect(toScaleText(d("123456789012345"), 0)).toBe("123456789012345");
    expect(toScaleText(d("1.2345"), 3)).toBe("1.235");
    expect(toScaleText(d("-0.001"), 2)).toBe("0.00");
    expect(() => toScaleText(d("1e40"), 2)).toThrow(/VALUE_INVALID/);
  });
});
