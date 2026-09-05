import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWhatIfStore } from "./whatif";
import type { PlanGoalSeekData, PlanSensitivityData, PlanWhatifOverlayData } from "@/api/schema";
import type { BridgeError } from "@/api/bridge";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const SC_A = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";
const SC_B = "3f9f2c9e-9f8b-4e2d-9a1c-000000000002";
const SC_C = "3f9f2c9e-9f8b-4e2d-9a1c-000000000003";
const SC_D = "3f9f2c9e-9f8b-4e2d-9a1c-000000000004";

function makeOverlayData(): PlanWhatifOverlayData {
  return {
    series: [
      {
        scenario_id: SC_A,
        scenario_name: "Base Plan",
        version_label: "v1",
        color: "#2563eb",
        points: [
          {
            period_id: "fp-2027-p01",
            period_label: "Jan 2027",
            value: "100000.00",
            value_minor: 10000000,
          },
          {
            period_id: "fp-2027-p02",
            period_label: "Feb 2027",
            value: "105000.00",
            value_minor: 10500000,
          },
        ],
      },
      {
        scenario_id: SC_B,
        scenario_name: "Stretch",
        version_label: null,
        color: "#16a34a",
        points: [
          {
            period_id: "fp-2027-p01",
            period_label: "Jan 2027",
            value: "110000.00",
            value_minor: 11000000,
          },
          {
            period_id: "fp-2027-p02",
            period_label: "Feb 2027",
            value: "118000.00",
            value_minor: 11800000,
          },
        ],
      },
    ],
    waterfall: [
      {
        step_id: "step-1",
        label: "Baseline",
        delta_text: "100000.00",
        delta_minor: 10000000,
        cumulative_text: "100000.00",
        cumulative_minor: 10000000,
        kind: "baseline",
        driver_id: null,
      },
      {
        step_id: "step-2",
        label: "Price Increase",
        delta_text: "10000.00",
        delta_minor: 1000000,
        cumulative_text: "110000.00",
        cumulative_minor: 11000000,
        kind: "driver",
        driver_id: "dr-price",
      },
      {
        step_id: "step-3",
        label: "Stretch Total",
        delta_text: "0.00",
        delta_minor: 0,
        cumulative_text: "110000.00",
        cumulative_minor: 11000000,
        kind: "total",
        driver_id: null,
      },
    ],
  };
}

function makeSensitivityData(): PlanSensitivityData {
  return {
    tornado: [
      {
        target_line_id: "ln-rev",
        target_line_name: "Revenue",
        base_value: "100000.00",
        base_minor: 10000000,
        low_value: "80000.00",
        low_minor: 8000000,
        high_value: "120000.00",
        high_minor: 12000000,
        swing_minor: 4000000,
        swing_text: "40000.00",
      },
    ],
    values: [
      {
        driver_value: "-0.20",
        step_index: 0,
        target_impacts: { "ln-rev": "80000.00" },
      },
      {
        driver_value: "0.00",
        step_index: 1,
        target_impacts: { "ln-rev": "100000.00" },
      },
      {
        driver_value: "0.20",
        step_index: 2,
        target_impacts: { "ln-rev": "120000.00" },
      },
    ],
  };
}

function makeGoalSeekData(converged = true): PlanGoalSeekData {
  return {
    driver_value: "42.50",
    iterations: 14,
    converged,
    last_target_value: "300000000.00",
  };
}

describe("useWhatIfStore (F-022 · M4-4 · S-052 · SCENARIO-VERSION-SPEC §5)", () => {
  beforeEach(() => {
    useWhatIfStore.getState().reset();
    callMock.mockReset();
  });

  /* ── 1. Initial State ────────────────────────────────────────────── */
  it("initializes with empty status and default input bounds", () => {
    const s = useWhatIfStore.getState();
    expect(s.status).toBe("empty");
    expect(s.error).toBeNull();
    expect(s.activeTab).toBe("overlay");
    expect(s.lastAction).toBeNull();

    expect(s.scenarioIds).toEqual([]);
    expect(s.periodScope).toBe("FY2027");
    expect(s.selectedKpis).toEqual([]);

    expect(s.sensitivityDriverId).toBeNull();
    expect(s.sensitivityTargetLines).toEqual([]);
    expect(s.sensitivityLo).toBe("-0.20");
    expect(s.sensitivityHi).toBe("0.20");
    expect(s.sensitivitySteps).toBe(5);

    expect(s.goalSeekTargetCell).toBe("");
    expect(s.goalSeekTargetValue).toBe("");
    expect(s.goalSeekDriverId).toBeNull();
    expect(s.goalSeekBounds).toEqual(["0", "100"]);

    expect(s.overlayData).toBeNull();
    expect(s.sensitivityData).toBeNull();
    expect(s.goalSeekData).toBeNull();
  });

  /* ── 2. Scenario Comparison & KPI Management ────────────────────── */
  it("manages scenario comparisons and enforces the 3-scenario ceiling", () => {
    const store = useWhatIfStore.getState();
    store.addScenarioId(SC_A);
    store.addScenarioId(SC_B);
    expect(useWhatIfStore.getState().scenarioIds).toEqual([SC_A, SC_B]);

    // Disallows duplicate addition
    store.addScenarioId(SC_B);
    expect(useWhatIfStore.getState().scenarioIds).toEqual([SC_A, SC_B]);

    // Adds third scenario
    store.addScenarioId(SC_C);
    expect(useWhatIfStore.getState().scenarioIds).toEqual([SC_A, SC_B, SC_C]);

    // Rejects fourth scenario (SPEC §5 2–3 scenarios ceiling)
    store.addScenarioId(SC_D);
    expect(useWhatIfStore.getState().scenarioIds).toEqual([SC_A, SC_B, SC_C]);

    // Removes a scenario
    store.removeScenarioId(SC_B);
    expect(useWhatIfStore.getState().scenarioIds).toEqual([SC_A, SC_C]);

    // setScenarioIds truncates to 3
    store.setScenarioIds([SC_A, SC_B, SC_C, SC_D]);
    expect(useWhatIfStore.getState().scenarioIds).toEqual([SC_A, SC_B, SC_C]);
  });

  it("toggles KPI selections and updates period scope", () => {
    const store = useWhatIfStore.getState();
    store.setPeriodScope("FY2028");
    expect(useWhatIfStore.getState().periodScope).toBe("FY2028");

    store.toggleKpi("ln-rev");
    expect(useWhatIfStore.getState().selectedKpis).toEqual(["ln-rev"]);

    store.toggleKpi("ln-ebitda");
    expect(useWhatIfStore.getState().selectedKpis).toEqual(["ln-rev", "ln-ebitda"]);

    store.toggleKpi("ln-rev");
    expect(useWhatIfStore.getState().selectedKpis).toEqual(["ln-ebitda"]);

    store.setSelectedKpis(["ln-fcf", "ln-cash"]);
    expect(useWhatIfStore.getState().selectedKpis).toEqual(["ln-fcf", "ln-cash"]);
  });

  /* ── 3. Sensitivity & Goal Seek Parameter Setters ───────────────── */
  it("updates sensitivity and goal seek parameters correctly", () => {
    const store = useWhatIfStore.getState();

    store.setSensitivityDriverId("dr-churn");
    store.setSensitivityTargetLines(["ln-rev", "ln-arr"]);
    store.setSensitivityBounds("-0.15", "0.15");
    store.setSensitivitySteps(9);

    const sens = useWhatIfStore.getState();
    expect(sens.sensitivityDriverId).toBe("dr-churn");
    expect(sens.sensitivityTargetLines).toEqual(["ln-rev", "ln-arr"]);
    expect(sens.sensitivityLo).toBe("-0.15");
    expect(sens.sensitivityHi).toBe("0.15");
    expect(sens.sensitivitySteps).toBe(9);

    store.setGoalSeekTargetCell("ln-rev:fp-2027-p12");
    store.setGoalSeekTargetValue("300000000.00");
    store.setGoalSeekDriverId("dr-reps");
    store.setGoalSeekBounds(["50", "200"]);

    const gs = useWhatIfStore.getState();
    expect(gs.goalSeekTargetCell).toBe("ln-rev:fp-2027-p12");
    expect(gs.goalSeekTargetValue).toBe("300000000.00");
    expect(gs.goalSeekDriverId).toBe("dr-reps");
    expect(gs.goalSeekBounds).toEqual(["50", "200"]);

    store.setActiveTab("sensitivity");
    expect(useWhatIfStore.getState().activeTab).toBe("sensitivity");
  });

  /* ── 4. runOverlay Actions & States ──────────────────────────────── */
  it("runOverlay sets empty status if no scenarios are provided", async () => {
    await useWhatIfStore.getState().runOverlay();
    expect(useWhatIfStore.getState().status).toBe("empty");
    expect(callMock).not.toHaveBeenCalled();
  });

  it("runOverlay transitions to populated on successful calculation with data", async () => {
    const data = makeOverlayData();
    callMock.mockResolvedValueOnce(data);

    useWhatIfStore.getState().setScenarioIds([SC_A, SC_B]);
    await useWhatIfStore.getState().runOverlay();

    const s = useWhatIfStore.getState();
    expect(s.status).toBe("populated");
    expect(s.error).toBeNull();
    expect(s.overlayData).toEqual(data);
    expect(s.lastAction).toBe("overlay");
    expect(callMock).toHaveBeenCalledWith("plan.whatif_overlay", {
      scenario_ids: [SC_A, SC_B],
      period_scope: "FY2027",
      kpis: [],
    });
  });

  it("runOverlay transitions to success if calculation returns empty series", async () => {
    callMock.mockResolvedValueOnce({ series: [], waterfall: [] });

    await useWhatIfStore.getState().runOverlay({ scenario_ids: [SC_A] });

    const s = useWhatIfStore.getState();
    expect(s.status).toBe("success");
    expect(s.overlayData?.series).toHaveLength(0);
  });

  it("runOverlay transitions to error on COMPARE_INCOMPATIBLE rejection", async () => {
    const error: BridgeError = {
      code: "COMPARE_INCOMPATIBLE",
      userMessage: "Cannot compare: Models/COAs differ. Select two Scenarios of the same Model.",
      httpStatus: 422,
      retryable: false,
      retryAfterMs: null,
      details: {},
    };
    callMock.mockRejectedValueOnce(error);

    await useWhatIfStore.getState().runOverlay({ scenario_ids: [SC_A, SC_B] });

    const s = useWhatIfStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toEqual(error);
    expect(s.overlayData).toBeNull();
  });

  /* ── 5. runSensitivity Actions & States ──────────────────────────── */
  it("runSensitivity stays empty when driver is not selected", async () => {
    await useWhatIfStore.getState().runSensitivity();
    expect(useWhatIfStore.getState().status).toBe("empty");
    expect(callMock).not.toHaveBeenCalled();
  });

  it("runSensitivity transitions to populated on tornado results", async () => {
    const sensData = makeSensitivityData();
    callMock.mockResolvedValueOnce(sensData);

    useWhatIfStore.getState().setSensitivityDriverId("dr-price");
    useWhatIfStore.getState().setSensitivityTargetLines(["ln-rev"]);
    await useWhatIfStore.getState().runSensitivity();

    const s = useWhatIfStore.getState();
    expect(s.status).toBe("populated");
    expect(s.error).toBeNull();
    expect(s.sensitivityData).toEqual(sensData);
    expect(s.lastAction).toBe("sensitivity");
    expect(callMock).toHaveBeenCalledWith("plan.sensitivity", {
      driver_id: "dr-price",
      lo: "-0.20",
      hi: "0.20",
      steps: 5,
      target_lines: ["ln-rev"],
    });
  });

  it("runSensitivity transitions to error on SENSITIVITY_OUT_OF_BOUNDS", async () => {
    const error: BridgeError = {
      code: "SENSITIVITY_OUT_OF_BOUNDS",
      userMessage: "Sensitivity range exceeds the Assumption bounds. Adjust bounds or range.",
      httpStatus: 422,
      retryable: false,
      retryAfterMs: null,
      details: {},
    };
    callMock.mockRejectedValueOnce(error);

    useWhatIfStore.getState().setSensitivityDriverId("dr-price");
    await useWhatIfStore.getState().runSensitivity({ lo: "-0.99", hi: "0.99" });

    const s = useWhatIfStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toEqual(error);
    expect(s.sensitivityData).toBeNull();
  });

  /* ── 6. runGoalSeek Actions & States ─────────────────────────────── */
  it("runGoalSeek stays empty if required target or driver is missing", async () => {
    await useWhatIfStore.getState().runGoalSeek();
    expect(useWhatIfStore.getState().status).toBe("empty");
    expect(callMock).not.toHaveBeenCalled();
  });

  it("runGoalSeek transitions to populated when converged", async () => {
    const gsData = makeGoalSeekData(true);
    callMock.mockResolvedValueOnce(gsData);

    await useWhatIfStore.getState().runGoalSeek({
      target_cell: "ln-rev:fp-2027-p12",
      target_value: "300000000.00",
      driver_id: "dr-reps",
      bounds: ["50", "200"],
    });

    const s = useWhatIfStore.getState();
    expect(s.status).toBe("populated");
    expect(s.goalSeekData).toEqual(gsData);
    expect(s.lastAction).toBe("goalseek");
    expect(callMock).toHaveBeenCalledWith("plan.goal_seek", {
      target_cell: "ln-rev:fp-2027-p12",
      target_value: "300000000.00",
      driver_id: "dr-reps",
      bounds: ["50", "200"],
    });
  });

  it("runGoalSeek transitions to success if converged is false but no error thrown", async () => {
    const gsData = makeGoalSeekData(false);
    callMock.mockResolvedValueOnce(gsData);

    await useWhatIfStore.getState().runGoalSeek({
      target_cell: "ln-rev:fp-2027-p12",
      target_value: "300000000.00",
      driver_id: "dr-reps",
    });

    expect(useWhatIfStore.getState().status).toBe("success");
  });

  it("runGoalSeek transitions to error on GOAL_SEEK_NO_CONVERGE", async () => {
    const error: BridgeError = {
      code: "GOAL_SEEK_NO_CONVERGE",
      userMessage:
        "Goal Seek did not converge in 100 iterations. Last value 285.4, target 300.0. Adjust bounds.",
      httpStatus: 422,
      retryable: false,
      retryAfterMs: null,
      details: { last_value: "285.4", target: "300.0" },
    };
    callMock.mockRejectedValueOnce(error);

    await useWhatIfStore.getState().runGoalSeek({
      target_cell: "ln-rev:fp-2027-p12",
      target_value: "300000000.00",
      driver_id: "dr-reps",
    });

    const s = useWhatIfStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toEqual(error);
    expect(s.goalSeekData).toBeNull();
  });

  /* ── 7. Retry & Recovery ─────────────────────────────────────────── */
  it("retries the last failed action", async () => {
    const error: BridgeError = {
      code: "INTERNAL",
      userMessage: "An unexpected error occurred.",
      httpStatus: 500,
      retryable: true,
      retryAfterMs: null,
      details: {},
    };
    callMock.mockRejectedValueOnce(error);

    useWhatIfStore.getState().setScenarioIds([SC_A, SC_B]);
    await useWhatIfStore.getState().runOverlay();
    expect(useWhatIfStore.getState().status).toBe("error");

    const okData = makeOverlayData();
    callMock.mockResolvedValueOnce(okData);
    await useWhatIfStore.getState().retry();

    const s = useWhatIfStore.getState();
    expect(s.status).toBe("populated");
    expect(s.overlayData).toEqual(okData);
  });

  /* ── 8. Reset and Clear Error ────────────────────────────────────── */
  it("clears error without altering cached results", async () => {
    useWhatIfStore.setState({
      status: "error",
      error: {
        code: "TEST_ERR",
        userMessage: "err",
        httpStatus: 400,
        retryable: false,
        retryAfterMs: null,
        details: {},
      },
    });
    useWhatIfStore.getState().clearError();
    expect(useWhatIfStore.getState().error).toBeNull();
  });

  it("resets back to initial state cleanly", async () => {
    const data = makeOverlayData();
    callMock.mockResolvedValueOnce(data);

    useWhatIfStore.getState().setScenarioIds([SC_A, SC_B]);
    await useWhatIfStore.getState().runOverlay();
    expect(useWhatIfStore.getState().status).toBe("populated");

    useWhatIfStore.getState().reset();
    const s = useWhatIfStore.getState();
    expect(s.status).toBe("empty");
    expect(s.scenarioIds).toEqual([]);
    expect(s.overlayData).toBeNull();
    expect(s.error).toBeNull();
  });
});
