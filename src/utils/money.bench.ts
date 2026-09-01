/**
 * Money display-path benchmark (CI stage 9, PERFORMANCE-REQUIREMENTS §1/§7).
 * Measures the hot display functions used by MoneyCell / KPI cards. This is the
 * JS-side baseline; the full engine bench suite (recalc/consolidation/export)
 * is M7-3. Deterministic inputs — no financial values cross as floats (I1):
 * `formatMinor` takes integer minor units, `formatDecimalString` an exact string.
 */
import { bench, describe } from "vitest";
import { formatDecimalString, formatMinor } from "./money";

describe("money display path", () => {
  const MINOR = 1_825_000; // 18,250.00 in 2-decimal minor units
  const DEC = "182500.00";

  bench("formatMinor (grid/KPI hot path)", () => {
    formatMinor(MINOR, "USD", { grouping: true });
  });

  bench("formatDecimalString (decimal-string IPC shape)", () => {
    formatDecimalString(DEC, "USD", { grouping: true });
  });
});
