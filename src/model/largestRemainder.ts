/**
 * Largest-remainder allocation — exact statement/report tie-out (MONEY-ROUNDING-SPEC §4, F-027).
 *
 * **Problem it solves.** A P&L (or BS / CF / segment) whose subtotals are rounded
 * independently can display children that do not sum to the parent: e.g. in 000s,
 * three lines whose exact totals are 11.4 / 3.4 / 7.4 round (HALF_UP) to 11 / 3 / 7 = 21,
 * while the rolled-up total 22.2 rounds to 22. The displayed children (21) no longer tie
 * to the displayed total (22). Largest-remainder allocation removes the drift by
 * distributing the rounding residual to the lines with the largest fractional remainders,
 * so the displayed children sum to the displayed total **exactly** (Δ = 0, integer equality).
 *
 * **This is the M6-1 statement tie-out oracle.** It is a pure, exact-decimal reference
 * (decimal.js — no float, no locale; `money:ast`-clean) that the native `rust_decimal`
 * engine in `statement.rs` must match. It pins the algorithm and the tie-out invariant in
 * one place so the native implementation and the TS preview cannot drift apart.
 *
 * **Exactness discipline (B3/B18-2):** every value is an exact decimal string. All arithmetic
 * runs through `decimal.js`; the only non-Decimal conversion is a **line count** (`k`), a small
 * non-money integer far below 2^53. The file stays clean under the `money:ast` gate: no float
 * parsing, no Math rounding, no numeric-coercion constructor, no locale formatting, and no
 * money-typed floor/ceil.
 */
import Decimal from "decimal.js";

/** The display rounding unit, `u` in MONEY-ROUNDING-SPEC §4 (e.g. "1000" for a 000s P&L). */
export type DisplayUnit = string;

export interface LargestRemainderResult {
  /**
   * Displayed line values (exact decimal strings), same order and length as the input.
   * Each is a multiple of `unit`; their sum equals `displayedTotal` exactly.
   */
  displayed: string[];
  /** The displayed total the lines tie to (exact decimal string, a multiple of `unit`). */
  displayedTotal: string;
}

/**
 * Round `total` to the nearest multiple of `unit`, HALF_UP (away from zero) — the compute
 * rounding rule of MONEY-ROUNDING-SPEC §3 applied at the statement-line boundary.
 */
export function roundToUnit(total: Decimal, unit: Decimal): Decimal {
  return total.dividedBy(unit).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(unit);
}

/**
 * Floor `x` to the greatest multiple of `unit` that is ≤ `x` (toward −∞). Guarantees the
 * remainder `x − floorToUnit(x, unit)` lies in `[0, unit)` for every sign of `x` (§4 step 2).
 */
function floorToUnit(x: Decimal, unit: Decimal): Decimal {
  return x.dividedBy(unit).floor().times(unit);
}

/**
 * Largest-remainder allocation (§4).
 *
 * @param exactLines  Exact (unrounded) line totals, as exact decimal strings, in the
 *                    statement's working units. Order is preserved in the result.
 * @param unit        Display rounding unit — a positive power of 10 as an exact decimal
 *                    string (e.g. `"1000"` for 000s, `"1"` for whole units, `"0.01"` for 2 dp).
 * @param exactTotal  Optional exact (unrounded) total. Defaults to `Σ exactLines`. The
 *                    displayed lines are made to sum exactly to `roundToUnit(exactTotal)`, so
 *                    a rolled-up parent that was computed independently can be tied to.
 * @returns           `{ displayed, displayedTotal }` where `Σ displayed === displayedTotal`
 *                    exactly (the tested tie-out invariant).
 * @throws            `ValueError`-style error (locked `VALUE_INVALID`-class message) when the
 *                    arguments are not exact decimals or `unit` is not a positive number.
 */
export function largestRemainderAllocate(
  exactLines: readonly string[],
  unit: DisplayUnit,
  exactTotal?: string,
): LargestRemainderResult {
  const unitDec = parseExact(unit, "unit");
  if (unitDec.lessThanOrEqualTo(0)) {
    throw new Error(`VALUE_INVALID: display unit '${unit}' must be a positive number`);
  }

  const lines = exactLines.map((raw, index) => parseExact(raw, `exactLines[${index}]`));
  const n = lines.length;
  if (n === 0) return { displayed: [], displayedTotal: "0" };

  const total =
    exactTotal === undefined
      ? lines.reduce((sum, line) => sum.plus(line), new Decimal(0))
      : parseExact(exactTotal, "exactTotal");

  // Step 1–2: floor every line to the display unit; the remainder is in [0, unit).
  const floors = lines.map((line) => floorToUnit(line, unitDec));
  const remainders = lines.map((line, i) => line.minus(floors[i]));
  const sumFloors = floors.reduce((sum, f) => sum.plus(f), new Decimal(0));

  // The displayed total the children must tie to.
  const displayedTotal = roundToUnit(total, unitDec);
  // Residual in whole units — an exact integer (can be negative only when `exactTotal`
  // overrides Σ lines and sits below Σ floors; §4 step 4d).
  const kDec = displayedTotal.minus(sumFloors).dividedBy(unitDec);
  if (!kDec.isInteger()) {
    throw new Error("INTERNAL: largest-remainder residual is not an integer unit count");
  }
  // `k` is a line count (not a money value) — a small exact integer, safe as a number.
  const k = kDec.toNumber();

  const displayed = floors.slice();
  if (k > 0) {
    // §4 step 4a–c: add one unit to the k lines with the largest remainders.
    // Tie-break: stable by original index (deterministic; exact-equal remainders are indistinct).
    const order = indicesByRemainder(remainders, "desc");
    for (let j = 0; j < Math.min(k, n); j += 1) {
      const i = order[j];
      displayed[i] = displayed[i].plus(unitDec);
    }
  } else if (k < 0) {
    // §4 step 4d: subtract one unit from the |k| lines with the smallest remainders.
    const order = indicesByRemainder(remainders, "asc");
    for (let j = 0; j < Math.min(-k, n); j += 1) {
      const i = order[j];
      displayed[i] = displayed[i].minus(unitDec);
    }
  }

  return {
    displayed: displayed.map((d) => d.toString()),
    displayedTotal: displayedTotal.toString(),
  };
}

/**
 * Indexes of `remainders` sorted by remainder magnitude; `dir === "desc"` for largest-first
 * (residual distribution), `"asc"` for smallest-first (residual subtraction). Equal remainders
 * keep original index order (stable, deterministic).
 */
function indicesByRemainder(remainders: Decimal[], dir: "desc" | "asc"): number[] {
  // Comparator convention: return <0 to place `a` before `b`. Descending (largest-first)
  // means a larger remainder sorts earlier, so negate the comparison for "desc".
  const sign = dir === "desc" ? -1 : 1;
  return remainders
    .map((rem, index) => ({ rem, index }))
    .sort((a, b) => {
      const cmp = a.rem.comparedTo(b.rem);
      if (cmp === 0) return a.index - b.index; // stable tie-break
      return sign * cmp;
    })
    .map((entry) => entry.index);
}

/** Parse a value to an exact Decimal, throwing a locked-code-class error on non-decimal input. */
function parseExact(raw: string, label: string): Decimal {
  const trimmed = raw.trim();
  // Exact decimal literal (optionally signed, optional fraction) — the same grammar the
  // engine boundary accepts. A regex pre-check keeps the error message honest for junk.
  if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`VALUE_INVALID: ${label} '${raw}' is not an exact decimal`);
  }
  const d = new Decimal(trimmed);
  if (!d.isFinite()) {
    throw new Error(`VALUE_INVALID: ${label} '${raw}' is not a finite decimal`);
  }
  return d;
}
