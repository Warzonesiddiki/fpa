import { afterEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import {
  createPeriodBadgeElement,
  formatPeriodRange,
  formatRange,
  generatePeriodLabel,
  type HybridLabelResult,
  type PeriodStatus,
} from "./periodLabel";

describe("periodLabel — Contract Adherence & Types (MODELING-METHODS-SPEC section 5, GLOSSARY section 11b)", () => {
  it("returns the exact HybridLabelResult structure with typed status and string label", () => {
    const result: HybridLabelResult = generatePeriodLabel(
      [1, 2, 3, 4],
      [5, 6, 7, 8, 9, 10, 11, 12],
    );
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("label");
    const allowedStatuses: PeriodStatus[] = ["ACTUAL", "PLAN_ONLY", "FORECAST", "HYBRID"];
    expect(allowedStatuses).toContain(result.status);
    expect(typeof result.label).toBe("string");
  });

  it("does not mutate caller input arrays", () => {
    const actuals = [4, 2, 1, 3];
    const forecast = [12, 8, 6, 5];
    const actualsCopy = [...actuals];
    const forecastCopy = [...forecast];

    generatePeriodLabel(actuals, forecast);

    expect(actuals).toEqual(actualsCopy);
    expect(forecast).toEqual(forecastCopy);
  });

  it("produces deterministic and idempotent results across repeated executions", () => {
    const run1 = generatePeriodLabel([1, 2], [3, 4, 5, 6]);
    const run2 = generatePeriodLabel([1, 2], [3, 4, 5, 6]);
    expect(run1).toEqual(run2);
    expect(run1.label).toBe(run2.label);
    expect(run1.status).toBe(run2.status);
  });

  it("uses unicode en-dash (\\u2013) for range representation, never ASCII hyphen or em-dash", () => {
    const result = generatePeriodLabel([1, 2, 3, 4], [5, 6, 7, 8, 9, 10, 11, 12]);
    expect(result.label).toContain("\u2013");
    expect(result.label).not.toContain("P01-P04");
    expect(result.label).not.toContain("P05-P12");
    expect(result.label).not.toContain("\u2014"); // no em-dash in period ranges
  });

  it("exports formatRange as an alias to formatPeriodRange", () => {
    expect(formatRange).toBe(formatPeriodRange);
  });
});

describe("periodLabel — Full Actuals state (ACTUAL)", () => {
  it("formats full 12-period fiscal year actuals as ACTUAL", () => {
    const p12 = Array.from({ length: 12 }, (_, i) => i + 1);
    const result = generatePeriodLabel(p12, []);
    expect(result).toEqual({
      status: "ACTUAL",
      label: "ACTUAL",
    });
  });

  it("formats year-to-date actuals with no forecast as ACTUAL", () => {
    const result = generatePeriodLabel([1, 2, 3, 4, 5, 6], []);
    expect(result).toEqual({
      status: "ACTUAL",
      label: "ACTUAL",
    });
  });

  it("formats single-period actuals with no forecast as ACTUAL", () => {
    const result = generatePeriodLabel([1], []);
    expect(result).toEqual({
      status: "ACTUAL",
      label: "ACTUAL",
    });
  });

  it("handles unsorted actuals arrays gracefully", () => {
    const result = generatePeriodLabel([12, 1, 9, 4, 2], []);
    expect(result).toEqual({
      status: "ACTUAL",
      label: "ACTUAL",
    });
  });

  it("handles duplicate period numbers in actuals gracefully", () => {
    const result = generatePeriodLabel([1, 1, 2, 2, 3, 3], []);
    expect(result).toEqual({
      status: "ACTUAL",
      label: "ACTUAL",
    });
  });
});

describe("periodLabel — Full Forecast state (FORECAST)", () => {
  it("formats full 12-period fiscal year forecast as FORECAST", () => {
    const p12 = Array.from({ length: 12 }, (_, i) => i + 1);
    const result = generatePeriodLabel([], p12);
    expect(result).toEqual({
      status: "FORECAST",
      label: "FORECAST",
    });
  });

  it("formats partial-year forecast with no actuals as FORECAST", () => {
    const result = generatePeriodLabel([], [7, 8, 9, 10, 11, 12]);
    expect(result).toEqual({
      status: "FORECAST",
      label: "FORECAST",
    });
  });

  it("formats single-period forecast with no actuals as FORECAST", () => {
    const result = generatePeriodLabel([], [1]);
    expect(result).toEqual({
      status: "FORECAST",
      label: "FORECAST",
    });
  });

  it("handles unsorted forecast arrays gracefully", () => {
    const result = generatePeriodLabel([], [12, 5, 2, 8]);
    expect(result).toEqual({
      status: "FORECAST",
      label: "FORECAST",
    });
  });

  it("handles duplicate period numbers in forecast gracefully", () => {
    const result = generatePeriodLabel([], [5, 5, 6, 7, 7]);
    expect(result).toEqual({
      status: "FORECAST",
      label: "FORECAST",
    });
  });
});

describe("periodLabel — Plan-Only state (PLAN_ONLY)", () => {
  it("formats empty model with neither actuals nor forecast as PLAN_ONLY", () => {
    const result = generatePeriodLabel([], []);
    expect(result).toEqual({
      status: "PLAN_ONLY",
      label: "PLAN_ONLY",
    });
  });
});

describe("periodLabel — Continuous Hybrid Ranges (GLOSSARY section 11b canonicals)", () => {
  it("formats canonical 4+8 rolling forecast (P01-P04 actuals, P05-P12 forecast)", () => {
    const actuals = [1, 2, 3, 4];
    const forecast = [5, 6, 7, 8, 9, 10, 11, 12];
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P01\u2013P04, Forecast P05\u2013P12)",
    });
  });

  it("formats Q1 closed (3+9 rolling forecast: P01-P03 actuals, P04-P12 forecast)", () => {
    const actuals = [1, 2, 3];
    const forecast = [4, 5, 6, 7, 8, 9, 10, 11, 12];
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P01\u2013P03, Forecast P04\u2013P12)",
    });
  });

  it("formats H1 closed (6+6 rolling forecast: P01-P06 actuals, P07-P12 forecast)", () => {
    const actuals = [1, 2, 3, 4, 5, 6];
    const forecast = [7, 8, 9, 10, 11, 12];
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P01\u2013P06, Forecast P07\u2013P12)",
    });
  });

  it("formats Q3 closed (9+3 rolling forecast: P01-P09 actuals, P10-P12 forecast)", () => {
    const actuals = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const forecast = [10, 11, 12];
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P01\u2013P09, Forecast P10\u2013P12)",
    });
  });

  it("formats unsorted arrays correctly into continuous hybrid ranges", () => {
    const actuals = [3, 1, 4, 2];
    const forecast = [12, 6, 10, 5, 8, 7, 11, 9];
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P01\u2013P04, Forecast P05\u2013P12)",
    });
  });

  it("formats hybrid ranges with duplicate period numbers cleanly", () => {
    const actuals = [1, 1, 2, 3, 4, 4];
    const forecast = [5, 6, 6, 7, 8, 9, 10, 11, 12, 12];
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P01\u2013P04, Forecast P05\u2013P12)",
    });
  });
});

describe("periodLabel — Single-Period Boundaries", () => {
  it("formats single-period actual boundary at P01 with multi-period forecast (P01 / P02-P12)", () => {
    const actuals = [1];
    const forecast = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P01, Forecast P02\u2013P12)",
    });
  });

  it("formats single-period forecast boundary at P12 with multi-period actuals (P01-P11 / P12)", () => {
    const actuals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const forecast = [12];
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P01\u2013P11, Forecast P12)",
    });
  });

  it("formats single-period actual and single-period forecast (P01 / P02)", () => {
    const actuals = [1];
    const forecast = [2];
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P01, Forecast P02)",
    });
  });

  it("formats year-end single period boundary (P11 / P12)", () => {
    const actuals = [11];
    const forecast = [12];
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P11, Forecast P12)",
    });
  });

  it("formats single-period actual with short multi-period forecast (P01 / P02-P03)", () => {
    const actuals = [1];
    const forecast = [2, 3];
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P01, Forecast P02\u2013P03)",
    });
  });

  it("formats short multi-period actuals with single-period forecast (P01-P02 / P03)", () => {
    const actuals = [1, 2];
    const forecast = [3];
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P01\u2013P02, Forecast P03)",
    });
  });
});

describe("periodLabel — 13-Period Calendars (NRF 3-3-3-4 Preset)", () => {
  it("formats full 13-period actuals as ACTUAL", () => {
    const p13 = Array.from({ length: 13 }, (_, i) => i + 1);
    const result = generatePeriodLabel(p13, []);
    expect(result).toEqual({
      status: "ACTUAL",
      label: "ACTUAL",
    });
  });

  it("formats full 13-period forecast as FORECAST", () => {
    const p13 = Array.from({ length: 13 }, (_, i) => i + 1);
    const result = generatePeriodLabel([], p13);
    expect(result).toEqual({
      status: "FORECAST",
      label: "FORECAST",
    });
  });

  it("formats 13-period Q1 boundary (P01-P03 actuals, P04-P13 forecast)", () => {
    const actuals = [1, 2, 3];
    const forecast = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P01\u2013P03, Forecast P04\u2013P13)",
    });
  });

  it("formats 13-period 4-period boundary (P01-P04 actuals, P05-P13 forecast)", () => {
    const actuals = [1, 2, 3, 4];
    const forecast = [5, 6, 7, 8, 9, 10, 11, 12, 13];
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P01\u2013P04, Forecast P05\u2013P13)",
    });
  });

  it("formats 13-period mid-year boundary (P01-P06 actuals, P07-P13 forecast)", () => {
    const actuals = [1, 2, 3, 4, 5, 6];
    const forecast = [7, 8, 9, 10, 11, 12, 13];
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P01\u2013P06, Forecast P07\u2013P13)",
    });
  });

  it("formats 13-period single period boundary at start (P01 / P02-P13)", () => {
    const actuals = [1];
    const forecast = Array.from({ length: 12 }, (_, i) => i + 2);
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P01, Forecast P02\u2013P13)",
    });
  });

  it("formats 13-period single period boundary at end (P01-P12 / P13)", () => {
    const actuals = Array.from({ length: 12 }, (_, i) => i + 1);
    const forecast = [13];
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P01\u2013P12, Forecast P13)",
    });
  });

  it("formats 13-period end-of-year single boundary (P12 / P13)", () => {
    const actuals = [12];
    const forecast = [13];
    const result = generatePeriodLabel(actuals, forecast);
    expect(result).toEqual({
      status: "HYBRID",
      label: "HYBRID (Actual P12, Forecast P13)",
    });
  });
});

describe("formatPeriodRange — Range Formatter Invariants", () => {
  it("returns empty string for empty input", () => {
    expect(formatPeriodRange([])).toBe("");
  });

  it("formats single periods with two-digit zero-padding", () => {
    expect(formatPeriodRange([1])).toBe("P01");
    expect(formatPeriodRange([5])).toBe("P05");
    expect(formatPeriodRange([9])).toBe("P09");
    expect(formatPeriodRange([10])).toBe("P10");
    expect(formatPeriodRange([12])).toBe("P12");
    expect(formatPeriodRange([13])).toBe("P13");
  });

  it("formats continuous ranges with en-dash delimiter", () => {
    expect(formatPeriodRange([1, 2])).toBe("P01\u2013P02");
    expect(formatPeriodRange([1, 2, 3, 4])).toBe("P01\u2013P04");
    expect(formatPeriodRange([5, 6, 7, 8, 9, 10, 11, 12])).toBe("P05\u2013P12");
    expect(formatPeriodRange([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])).toBe("P01\u2013P13");
  });

  it("sorts unsorted period numbers", () => {
    expect(formatPeriodRange([4, 1, 3, 2])).toBe("P01\u2013P04");
    expect(formatPeriodRange([13, 1, 7])).toBe("P01\u2013P13");
  });

  it("deduplicates identical period numbers", () => {
    expect(formatPeriodRange([1, 1, 1])).toBe("P01");
    expect(formatPeriodRange([2, 2, 3, 3, 4, 4])).toBe("P02\u2013P04");
  });

  it("rejects non-integer period numbers (zero float financial invariant)", () => {
    expect(() => formatPeriodRange([1.5])).toThrow(RangeError);
    expect(() => formatPeriodRange([0.1, 2])).toThrow(RangeError);
  });

  it("rejects zero or negative period numbers", () => {
    expect(() => formatPeriodRange([0])).toThrow(RangeError);
    expect(() => formatPeriodRange([-1])).toThrow(RangeError);
    expect(() => formatPeriodRange([1, 2, -3])).toThrow(RangeError);
  });

  it("rejects non-finite period numbers", () => {
    expect(() => formatPeriodRange([NaN])).toThrow(RangeError);
    expect(() => formatPeriodRange([Infinity])).toThrow(RangeError);
  });
});

describe("periodLabel — Input Validation & Error Handling", () => {
  it("rejects float periods in actualPeriods", () => {
    expect(() => generatePeriodLabel([1.2, 2], [3, 4])).toThrow(RangeError);
  });

  it("rejects float periods in forecastPeriods", () => {
    expect(() => generatePeriodLabel([1, 2], [3.5, 4])).toThrow(RangeError);
  });

  it("rejects negative period numbers in actualPeriods", () => {
    expect(() => generatePeriodLabel([-1], [2, 3])).toThrow(RangeError);
  });

  it("rejects zero as a period number in forecastPeriods", () => {
    expect(() => generatePeriodLabel([1], [0])).toThrow(RangeError);
  });
});

describe("periodLabel — Accessibility & Axe-Clean Verification (ACCESSIBILITY.md section 3, WCAG 2.2 AA)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the createPeriodBadgeElement axe-clean across all period states", async () => {
    const states: HybridLabelResult[] = [
      generatePeriodLabel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], []), // ACTUAL
      generatePeriodLabel([], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), // FORECAST
      generatePeriodLabel([], []), // PLAN_ONLY
      generatePeriodLabel([1, 2, 3, 4], [5, 6, 7, 8, 9, 10, 11, 12]), // HYBRID continuous
      generatePeriodLabel([1], [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), // HYBRID single-boundary
      generatePeriodLabel([1, 2, 3, 4], [5, 6, 7, 8, 9, 10, 11, 12, 13]), // HYBRID 13-period
    ];

    const main = document.createElement("main");
    const heading = document.createElement("h1");
    heading.textContent = "Period State Badge Verification";
    main.appendChild(heading);

    for (let index = 0; index < states.length; index++) {
      const state = states[index];
      const section = document.createElement("section");
      section.setAttribute("aria-label", `Period State ${index + 1}: ${state.label}`);
      const badge = createPeriodBadgeElement(state);
      section.appendChild(badge);
      main.appendChild(section);
    }

    document.body.appendChild(main);

    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });

  it("is axe-clean when rendered within a table column header (S-041 model grid pattern)", async () => {
    const hybrid = generatePeriodLabel([1, 2, 3, 4], [5, 6, 7, 8, 9, 10, 11, 12]);

    const main = document.createElement("main");
    const h1 = document.createElement("h1");
    h1.textContent = "Financial Statement Grid";
    main.appendChild(h1);

    const table = document.createElement("table");
    const caption = document.createElement("caption");
    caption.textContent = `Model Period Breakdown - ${hybrid.label}`;
    table.appendChild(caption);

    const thead = document.createElement("thead");
    const tr = document.createElement("tr");

    const thAccount = document.createElement("th");
    thAccount.setAttribute("scope", "col");
    thAccount.textContent = "Account";
    tr.appendChild(thAccount);

    const thPeriod = document.createElement("th");
    thPeriod.setAttribute("scope", "col");
    const badge = createPeriodBadgeElement(hybrid);
    thPeriod.appendChild(badge);
    tr.appendChild(thPeriod);

    thead.appendChild(tr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const bodyRow = document.createElement("tr");
    const tdAccount = document.createElement("td");
    tdAccount.textContent = "4000 \u00b7 Revenue";
    const tdValue = document.createElement("td");
    tdValue.textContent = "USD 1,000,000.00";
    bodyRow.appendChild(tdAccount);
    bodyRow.appendChild(tdValue);
    tbody.appendChild(bodyRow);
    table.appendChild(tbody);

    main.appendChild(table);
    document.body.appendChild(main);

    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });

  it("is axe-clean when rendered in an accessible status banner (report header pattern)", async () => {
    const states = [
      generatePeriodLabel([1, 2, 3, 4], [5, 6, 7, 8, 9, 10, 11, 12]),
      generatePeriodLabel([1], [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
      generatePeriodLabel([1, 2, 3, 4], [5, 6, 7, 8, 9, 10, 11, 12, 13]),
    ];

    const banner = document.createElement("header");
    banner.setAttribute("role", "banner");
    const statusRegion = document.createElement("div");
    statusRegion.setAttribute("role", "status");
    statusRegion.setAttribute("aria-live", "polite");

    for (const state of states) {
      const span = document.createElement("span");
      span.textContent = state.label;
      statusRegion.appendChild(span);
    }
    banner.appendChild(statusRegion);

    const main = document.createElement("main");
    const h1 = document.createElement("h1");
    h1.textContent = "Executive Board Report";
    main.appendChild(h1);

    document.body.appendChild(banner);
    document.body.appendChild(main);

    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });
});
