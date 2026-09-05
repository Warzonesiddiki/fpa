/**
 * S-052 What-If store — edge-state tests (M4-4 completion slice).
 *
 * Complements whatif.test.ts with the store rules the screen depends on:
 *  - the 3-scenario compare cap (add/dedupe/set truncation)
 *  - guard paths: no scenarios / no driver / incomplete goal-seek never hit the bridge
 *  - params passed to a run are persisted for the retry dispatch (overlay→sensitivity→goalseek)
 *  - hasData=false answers land on `success`, converged=false lands on `success`
 *  - bridge rejections land on `error` and clear the stale payload of the run that failed
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWhatIfStore } from "./whatif";
import type { PlanWhatifOverlayData, PlanSensitivityData, PlanGoalSeekData } from "@/api/schema";

const callMock = vi.fn();
vi.mock("@/api/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/bridge")>();
  return {
    ...actual,
    call: (...args: unknown[]) => callMock(...args),
  };
});

const OVERLAY: PlanWhatifOverlayData = {
  series: [
    {
      scenario_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      scenario_name: "Budget",
      version_label: null,
      points: [{ period_id: "fp-1", period_label: "P01", value: "100", value_minor: 10000 }],
    },
  ],
  waterfall: [],
};

const OVERLAY_EMPTY: PlanWhatifOverlayData = { series: [], waterfall: [] };

const TORNADO: PlanSensitivityData = { tornado: [], values: [] };

const TORNADO_ROW: PlanSensitivityData = {
  tornado: [
    {
      target_line_id: "ln-a",
      target_line_name: "Revenue",
      base_value: "100",
      base_minor: 10000,
      low_value: "90",
      low_minor: 9000,
      high_value: "110",
      high_minor: 11000,
      swing_minor: 2000,
      swing_text: "20.00",
    },
  ],
  values: [],
};

const SEEK_CONVERGED: PlanGoalSeekData = {
  driver_value: "42.5",
  iterations: 7,
  converged: true,
  last_target_value: "1000",
};

const SEEK_UNCONVERGED: PlanGoalSeekData = {
  driver_value: "39.1",
  iterations: 100,
  converged: false,
};

describe("S-052 What-If store edges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWhatIfStore.getState().reset();
  });

  it("addScenarioId dedupes and caps the comparison at three scenarios", () => {
    const st = useWhatIfStore.getState();
    st.addScenarioId("sc-a");
    st.addScenarioId("sc-a");
    st.addScenarioId("sc-b");
    st.addScenarioId("sc-c");
    st.addScenarioId("sc-d"); // rejected: cap
    expect(useWhatIfStore.getState().scenarioIds).toEqual(["sc-a", "sc-b", "sc-c"]);

    st.removeScenarioId("sc-b");
    expect(useWhatIfStore.getState().scenarioIds).toEqual(["sc-a", "sc-c"]);
    st.removeScenarioId("sc-nope");
    expect(useWhatIfStore.getState().scenarioIds).toEqual(["sc-a", "sc-c"]);
  });

  it("setScenarioIds truncates a longer selection to the cap", () => {
    useWhatIfStore.getState().setScenarioIds(["a", "b", "c", "d"]);
    expect(useWhatIfStore.getState().scenarioIds).toEqual(["a", "b", "c"]);
  });

  it("toggleKpi adds and removes KPI selections", () => {
    const st = useWhatIfStore.getState();
    st.toggleKpi("revenue");
    expect(useWhatIfStore.getState().selectedKpis).toContain("revenue");
    st.toggleKpi("revenue");
    expect(useWhatIfStore.getState().selectedKpis).not.toContain("revenue");
  });

  it("runOverlay without scenarios short-circuits to empty without a bridge call", async () => {
    await useWhatIfStore.getState().runOverlay();
    expect(useWhatIfStore.getState().status).toBe("empty");
    expect(callMock).not.toHaveBeenCalled();
  });

  it("runOverlay persists explicit params, then empty answers land on success", async () => {
    callMock.mockResolvedValueOnce(OVERLAY_EMPTY);
    await useWhatIfStore.getState().runOverlay({
      scenario_ids: ["s1", "s2", "s3", "s4"],
      period_scope: "FY2027",
      kpis: ["revenue"],
    });

    expect(callMock).toHaveBeenCalledWith("plan.whatif_overlay", {
      scenario_ids: ["s1", "s2", "s3"],
      period_scope: "FY2027",
      kpis: ["revenue"],
    });
    const s = useWhatIfStore.getState();
    expect(s.status).toBe("success");
    expect(s.overlayData).toEqual(OVERLAY_EMPTY);
    // The explicit params persisted for the next un-param'd run (retry contract).
    expect(s.scenarioIds).toEqual(["s1", "s2", "s3"]);
    expect(s.periodScope).toBe("FY2027");
  });

  it("runOverlay with data lands populated and a rejection clears the stale payload", async () => {
    callMock.mockResolvedValueOnce(OVERLAY);
    await useWhatIfStore
      .getState()
      .runOverlay({ scenario_ids: ["s1"], period_scope: "FY2027", kpis: [] });
    expect(useWhatIfStore.getState().status).toBe("populated");

    callMock.mockRejectedValueOnce({ code: "SESSION_LOCKED", httpStatus: 401, retryable: false });
    await useWhatIfStore.getState().runOverlay();
    const s = useWhatIfStore.getState();
    expect(s.status).toBe("error");
    expect(s.overlayData).toBeNull();
    expect(s.error?.code).toBe("SESSION_LOCKED");
  });

  it("runSensitivity without a driver stays empty; params persist and drive the call", async () => {
    await useWhatIfStore.getState().runSensitivity();
    expect(useWhatIfStore.getState().status).toBe("empty");
    expect(callMock).not.toHaveBeenCalled();

    callMock.mockResolvedValueOnce(TORNADO);
    await useWhatIfStore.getState().runSensitivity({
      driver_id: "dr-price",
      lo: "0.5",
      hi: "2",
      steps: 5,
      target_lines: ["ln-a"],
    });
    expect(callMock).toHaveBeenCalledWith("plan.sensitivity", {
      driver_id: "dr-price",
      lo: "0.5",
      hi: "2",
      steps: 5,
      target_lines: ["ln-a"],
    });
    expect(useWhatIfStore.getState().status).toBe("success");

    // No params now: the persisted driver answers the empty guard's other side.
    callMock.mockResolvedValueOnce(TORNADO_ROW);
    await useWhatIfStore.getState().runSensitivity();
    expect(useWhatIfStore.getState().status).toBe("populated");
  });

  it("runSensitivity rejections surface the typed error", async () => {
    useWhatIfStore.getState().setSensitivityDriverId("dr-1");
    callMock.mockRejectedValueOnce({
      code: "SENSITIVITY_OUT_OF_BOUNDS",
      httpStatus: 422,
      retryable: false,
      userMessage: "Driver variation exceeds the configured bounds.",
    });
    await useWhatIfStore.getState().runSensitivity();
    const s = useWhatIfStore.getState();
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("SENSITIVITY_OUT_OF_BOUNDS");
    expect(s.sensitivityData).toBeNull();
  });

  it("runGoalSeek requires cell, value and driver before calling the solver", async () => {
    await useWhatIfStore.getState().runGoalSeek();
    expect(callMock).not.toHaveBeenCalled();

    // Incomplete: cell + value, no driver.
    await useWhatIfStore
      .getState()
      .runGoalSeek({ target_cell: "revenue", target_value: "1000" } as never);
    expect(callMock).not.toHaveBeenCalled();
    expect(useWhatIfStore.getState().status).toBe("empty");
  });

  it("runGoalSeek converged answers land populated, unconverged on success", async () => {
    callMock.mockResolvedValueOnce(SEEK_CONVERGED);
    await useWhatIfStore.getState().runGoalSeek({
      target_cell: "revenue",
      target_value: "1000",
      driver_id: "dr-price",
      bounds: ["0", "100"],
    });
    expect(callMock).toHaveBeenCalledWith("plan.goal_seek", {
      target_cell: "revenue",
      target_value: "1000",
      driver_id: "dr-price",
      bounds: ["0", "100"],
    });
    expect(useWhatIfStore.getState().status).toBe("populated");

    callMock.mockResolvedValueOnce(SEEK_UNCONVERGED);
    await useWhatIfStore.getState().runGoalSeek();
    const s = useWhatIfStore.getState();
    expect(s.status).toBe("success");
    expect(s.goalSeekData?.converged).toBe(false);
  });

  it("retry dispatches to the last executed action", async () => {
    // No prior action: retry is inert.
    await useWhatIfStore.getState().retry();
    expect(callMock).not.toHaveBeenCalled();

    useWhatIfStore.getState().setSensitivityDriverId("dr-x");
    callMock.mockRejectedValueOnce({ code: "INTERNAL", httpStatus: 500, retryable: true });
    await useWhatIfStore.getState().runSensitivity();
    expect(useWhatIfStore.getState().lastAction).toBe("sensitivity");

    callMock.mockResolvedValueOnce(TORNADO);
    await useWhatIfStore.getState().retry();
    expect(callMock).toHaveBeenLastCalledWith("plan.sensitivity", {
      driver_id: "dr-x",
      lo: useWhatIfStore.getState().sensitivityLo,
      hi: useWhatIfStore.getState().sensitivityHi,
      steps: useWhatIfStore.getState().sensitivitySteps,
      target_lines: useWhatIfStore.getState().sensitivityTargetLines,
    });
  });

  it("retry after a failed overlay re-runs the overlay with the persisted scope", async () => {
    callMock.mockRejectedValueOnce({ code: "INTERNAL", httpStatus: 500, retryable: true });
    await useWhatIfStore
      .getState()
      .runOverlay({ scenario_ids: ["s1"], period_scope: "FY2027", kpis: ["net_income"] });
    expect(useWhatIfStore.getState().lastAction).toBe("overlay");

    callMock.mockResolvedValueOnce(OVERLAY);
    await useWhatIfStore.getState().retry();
    expect(callMock).toHaveBeenLastCalledWith("plan.whatif_overlay", {
      scenario_ids: ["s1"],
      period_scope: "FY2027",
      kpis: ["net_income"],
    });
    expect(useWhatIfStore.getState().status).toBe("populated");
  });
});
