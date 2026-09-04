/**
 * periodLabel.ts
 *
 * Hybrid period label generator as per GLOSSARY.md section 11b and MODELING-METHODS-SPEC.md section 5.
 * Never silently mixes Actuals and Forecast periods.
 */

export type PeriodStatus = "ACTUAL" | "PLAN_ONLY" | "FORECAST" | "HYBRID";

export interface HybridLabelResult {
  status: PeriodStatus;
  label: string;
}

/**
 * Validates that period numbers are positive integers.
 */
function validatePeriods(periods: readonly number[]): void {
  for (const p of periods) {
    if (!Number.isInteger(p) || p <= 0) {
      throw new RangeError(
        `Invalid fiscal period number: ${p}. Fiscal periods must be positive integers (e.g. 1..12 or 1..13).`,
      );
    }
  }
}

const EN_DASH = "\u2013";

/**
 * Formats a sorted, deduplicated range of period numbers into standard notation.
 * Uses en-dash per GLOSSARY section 11b and MODELING-METHODS-SPEC section 5.
 * E.g. [1] -> "P01", [1, 2, 3, 4] -> "P01-P04", [13] -> "P13".
 */
export function formatPeriodRange(periods: readonly number[]): string {
  if (periods.length === 0) return "";
  validatePeriods(periods);

  const sorted = Array.from(new Set(periods)).sort((a, b) => a - b);
  if (sorted.length === 1) return `P${String(sorted[0]).padStart(2, "0")}`;

  return `P${String(sorted[0]).padStart(2, "0")}${EN_DASH}P${String(sorted[sorted.length - 1]).padStart(2, "0")}`;
}

export const formatRange = formatPeriodRange;

/**
 * Generates the human-readable label and status for a set of periods based on Actuals and Forecast presence.
 * Conforms to MODELING-METHODS-SPEC.md section 5 and GLOSSARY.md section 11b.
 *
 * - All actuals: { status: "ACTUAL", label: "ACTUAL" }
 * - All forecast: { status: "FORECAST", label: "FORECAST" }
 * - Neither (empty model): { status: "PLAN_ONLY", label: "PLAN_ONLY" }
 * - Mixed: { status: "HYBRID", label: "HYBRID (Actual P01-P04, Forecast P05-P12)" }
 */
export function generatePeriodLabel(
  actualPeriods: readonly number[],
  forecastPeriods: readonly number[],
): HybridLabelResult {
  validatePeriods(actualPeriods);
  validatePeriods(forecastPeriods);

  const hasActuals = actualPeriods.length > 0;
  const hasForecast = forecastPeriods.length > 0;

  if (hasActuals && !hasForecast) {
    return { status: "ACTUAL", label: "ACTUAL" };
  }

  if (!hasActuals && hasForecast) {
    return { status: "FORECAST", label: "FORECAST" };
  }

  if (!hasActuals && !hasForecast) {
    return { status: "PLAN_ONLY", label: "PLAN_ONLY" };
  }

  // Mixed case: HYBRID (never silent mixing)
  const actualRange = formatPeriodRange(actualPeriods);
  const forecastRange = formatPeriodRange(forecastPeriods);

  return {
    status: "HYBRID",
    label: `HYBRID (Actual ${actualRange}, Forecast ${forecastRange})`,
  };
}

/**
 * Creates an accessible DOM badge element for a period label.
 * Complies with ACCESSIBILITY.md section 3 (WCAG 2.2 AA) and provides appropriate ARIA attributes.
 */
export function createPeriodBadgeElement(result: HybridLabelResult): HTMLElement {
  const badge = document.createElement("span");
  badge.setAttribute("role", "status");
  badge.setAttribute("aria-label", `Period state: ${result.label}`);
  badge.setAttribute("data-period-status", result.status);
  badge.className = `period-badge period-badge-${result.status.toLowerCase()}`;
  badge.textContent = result.label;
  return badge;
}
