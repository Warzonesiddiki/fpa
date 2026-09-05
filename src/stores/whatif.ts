/**
 * S-052 What-If & Sensitivity store (F-022 · M4-4 · SCREENS-SPEC S-052 · SCENARIO-VERSION-SPEC §5).
 *
 * Owns the What-If sandbox state:
 *   * Scenario Overlay & Waterfall <- `plan.whatif_overlay` (2–3 scenarios by period, baseline->scenario waterfall)
 *   * Sensitivity Tornado          <- `plan.sensitivity` (driver variation over ±bounds, ranked tornado bars)
 *   * Goal Seek Bisection          <- `plan.goal_seek` (bounded bisection solver over one driver, <=100 iterations)
 *
 * 5 screen states (empty, loading, error, success, populated) drive StatePanel and UI containers.
 * Errors surface as typed `BridgeError` (`COMPARE_INCOMPATIBLE`, `SENSITIVITY_OUT_OF_BOUNDS`,
 * `GOAL_SEEK_NO_CONVERGE`).
 *
 * Money / exact decimals: All financial figures cross IPC as exact decimal strings or minor units (B3 / B18-2).
 * Model mutation: What-If calculations are non-mutating previews; only explicit scenario creation writes.
 */
import { create } from "zustand";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";
import type { ScreenState } from "@/components/ui/StatePanel";
import type {
  PlanGoalSeekArgs,
  PlanGoalSeekData,
  PlanSensitivityArgs,
  PlanSensitivityData,
  PlanWhatifOverlayArgs,
  PlanWhatifOverlayData,
  SensitivityValueStep,
  TornadoBar,
  WaterfallStep,
  WhatifSeries,
  WhatifSeriesPoint,
} from "@/api/schema";

export type WhatIfTab = "overlay" | "sensitivity" | "goalseek";

export interface WhatIfStoreState {
  /* ── 5 Screen states & error (Q1 · Q2 · SCREENS-SPEC S-052) ────── */
  status: ScreenState;
  error: BridgeError | null;
  lastAction: WhatIfTab | null;
  activeTab: WhatIfTab;

  /* ── Scenario comparison & overlay inputs (SPEC §5) ───────────── */
  /** Active scenario IDs to compare (min 1, max 3). */
  scenarioIds: string[];
  /** Period horizon scope (e.g. "FY2027", "fp-2027-p01..fp-2027-p12"). */
  periodScope: string;
  /** Selected KPI line IDs to evaluate. */
  selectedKpis: string[];

  /* ── Sensitivity analysis inputs (SPEC §5) ────────────────────── */
  /** Driver to vary in sensitivity analysis. */
  sensitivityDriverId: string | null;
  /** Target line IDs to measure impact against. */
  sensitivityTargetLines: string[];
  /** Lower bound (exact decimal string, e.g. "-0.20"). */
  sensitivityLo: string;
  /** Upper bound (exact decimal string, e.g. "0.20"). */
  sensitivityHi: string;
  /** Step count between bounds (min 2, max 100). */
  sensitivitySteps: number;

  /* ── Goal Seek inputs (SPEC §5) ───────────────────────────────── */
  /** Target cell to achieve (e.g. "ln-rev:fp-2027-p12"). */
  goalSeekTargetCell: string;
  /** Exact desired target value (decimal string, e.g. "300000000.00"). */
  goalSeekTargetValue: string;
  /** Driver to adjust to reach the target. */
  goalSeekDriverId: string | null;
  /** Search bounds tuple [lo, hi] (exact decimal strings). */
  goalSeekBounds: [string, string];

  /* ── Results cache ────────────────────────────────────────────── */
  overlayData: PlanWhatifOverlayData | null;
  sensitivityData: PlanSensitivityData | null;
  goalSeekData: PlanGoalSeekData | null;

  /* ── Input setters ────────────────────────────────────────────── */
  setActiveTab: (tab: WhatIfTab) => void;
  setScenarioIds: (ids: string[]) => void;
  addScenarioId: (id: string) => void;
  removeScenarioId: (id: string) => void;
  setPeriodScope: (scope: string) => void;
  setSelectedKpis: (kpis: string[]) => void;
  toggleKpi: (kpiId: string) => void;

  setSensitivityDriverId: (driverId: string | null) => void;
  setSensitivityTargetLines: (lines: string[]) => void;
  setSensitivityBounds: (lo: string, hi: string) => void;
  setSensitivitySteps: (steps: number) => void;

  setGoalSeekTargetCell: (cell: string) => void;
  setGoalSeekTargetValue: (value: string) => void;
  setGoalSeekDriverId: (driverId: string | null) => void;
  setGoalSeekBounds: (bounds: [string, string]) => void;

  /* ── Actions ──────────────────────────────────────────────────── */
  runOverlay: (params?: Partial<PlanWhatifOverlayArgs>) => Promise<void>;
  runSensitivity: (params?: Partial<PlanSensitivityArgs>) => Promise<void>;
  runGoalSeek: (params?: Partial<PlanGoalSeekArgs>) => Promise<void>;
  retry: () => Promise<void>;
  reset: () => void;
  clearError: () => void;
}

const DEFAULT_STATE = {
  status: "empty" as ScreenState,
  error: null as BridgeError | null,
  lastAction: null as WhatIfTab | null,
  activeTab: "overlay" as WhatIfTab,

  scenarioIds: [] as string[],
  periodScope: "FY2027",
  selectedKpis: [] as string[],

  sensitivityDriverId: null as string | null,
  sensitivityTargetLines: [] as string[],
  sensitivityLo: "-0.20",
  sensitivityHi: "0.20",
  sensitivitySteps: 5,

  goalSeekTargetCell: "",
  goalSeekTargetValue: "",
  goalSeekDriverId: null as string | null,
  goalSeekBounds: ["0", "100"] as [string, string],

  overlayData: null as PlanWhatifOverlayData | null,
  sensitivityData: null as PlanSensitivityData | null,
  goalSeekData: null as PlanGoalSeekData | null,
};

export const useWhatIfStore = create<WhatIfStoreState>((set, get) => ({
  ...DEFAULT_STATE,

  setActiveTab: (tab) => set({ activeTab: tab }),

  setScenarioIds: (ids) => set({ scenarioIds: ids.slice(0, 3) }),

  addScenarioId: (id) => {
    const { scenarioIds } = get();
    if (scenarioIds.includes(id) || scenarioIds.length >= 3) return;
    set({ scenarioIds: [...scenarioIds, id] });
  },

  removeScenarioId: (id) => {
    const { scenarioIds } = get();
    set({ scenarioIds: scenarioIds.filter((s) => s !== id) });
  },

  setPeriodScope: (scope) => set({ periodScope: scope }),

  setSelectedKpis: (kpis) => set({ selectedKpis: kpis }),

  toggleKpi: (kpiId) => {
    const { selectedKpis } = get();
    if (selectedKpis.includes(kpiId)) {
      set({ selectedKpis: selectedKpis.filter((k) => k !== kpiId) });
    } else {
      set({ selectedKpis: [...selectedKpis, kpiId] });
    }
  },

  setSensitivityDriverId: (driverId) => set({ sensitivityDriverId: driverId }),
  setSensitivityTargetLines: (lines) => set({ sensitivityTargetLines: lines }),
  setSensitivityBounds: (lo, hi) => set({ sensitivityLo: lo, sensitivityHi: hi }),
  setSensitivitySteps: (steps) => set({ sensitivitySteps: steps }),

  setGoalSeekTargetCell: (cell) => set({ goalSeekTargetCell: cell }),
  setGoalSeekTargetValue: (value) => set({ goalSeekTargetValue: value }),
  setGoalSeekDriverId: (driverId) => set({ goalSeekDriverId: driverId }),
  setGoalSeekBounds: (bounds) => set({ goalSeekBounds: bounds }),

  runOverlay: async (params) => {
    const scenarioIds = params?.scenario_ids ?? get().scenarioIds;
    const periodScope = params?.period_scope ?? get().periodScope;
    const kpis = params?.kpis ?? get().selectedKpis;

    if (scenarioIds.length === 0) {
      set({ status: "empty", error: null });
      return;
    }

    set({
      status: "loading",
      error: null,
      lastAction: "overlay",
      ...(params?.scenario_ids ? { scenarioIds: params.scenario_ids.slice(0, 3) } : {}),
      ...(params?.period_scope ? { periodScope: params.period_scope } : {}),
      ...(params?.kpis ? { selectedKpis: params.kpis } : {}),
    });

    try {
      const result = (await call("plan.whatif_overlay", {
        scenario_ids: scenarioIds.slice(0, 3),
        period_scope: periodScope,
        kpis,
      })) as PlanWhatifOverlayData;

      const hasData = (result.series?.length ?? 0) > 0 || (result.waterfall?.length ?? 0) > 0;
      set({
        status: hasData ? "populated" : "success",
        overlayData: result,
        error: null,
      });
    } catch (err) {
      set({
        status: "error",
        error: err as BridgeError,
        overlayData: null,
      });
    }
  },

  runSensitivity: async (params) => {
    const driverId = params?.driver_id ?? get().sensitivityDriverId;
    const lo = params?.lo ?? get().sensitivityLo;
    const hi = params?.hi ?? get().sensitivityHi;
    const steps = params?.steps ?? get().sensitivitySteps;
    const targetLines = params?.target_lines ?? get().sensitivityTargetLines;

    if (!driverId) {
      set({ status: "empty", error: null });
      return;
    }

    set({
      status: "loading",
      error: null,
      lastAction: "sensitivity",
      ...(params?.driver_id !== undefined ? { sensitivityDriverId: params.driver_id } : {}),
      ...(params?.lo !== undefined ? { sensitivityLo: params.lo } : {}),
      ...(params?.hi !== undefined ? { sensitivityHi: params.hi } : {}),
      ...(params?.steps !== undefined ? { sensitivitySteps: params.steps } : {}),
      ...(params?.target_lines !== undefined ? { sensitivityTargetLines: params.target_lines } : {}),
    });

    try {
      const result = (await call("plan.sensitivity", {
        driver_id: driverId,
        lo,
        hi,
        steps,
        target_lines: targetLines,
      })) as PlanSensitivityData;

      const hasData = (result.tornado?.length ?? 0) > 0 || (result.values?.length ?? 0) > 0;
      set({
        status: hasData ? "populated" : "success",
        sensitivityData: result,
        error: null,
      });
    } catch (err) {
      set({
        status: "error",
        error: err as BridgeError,
        sensitivityData: null,
      });
    }
  },

  runGoalSeek: async (params) => {
    const targetCell = params?.target_cell ?? get().goalSeekTargetCell;
    const targetValue = params?.target_value ?? get().goalSeekTargetValue;
    const driverId = params?.driver_id ?? get().goalSeekDriverId;
    const bounds = params?.bounds ?? get().goalSeekBounds;

    if (!targetCell || !targetValue || !driverId) {
      set({ status: "empty", error: null });
      return;
    }

    set({
      status: "loading",
      error: null,
      lastAction: "goalseek",
      ...(params?.target_cell !== undefined ? { goalSeekTargetCell: params.target_cell } : {}),
      ...(params?.target_value !== undefined ? { goalSeekTargetValue: params.target_value } : {}),
      ...(params?.driver_id !== undefined ? { goalSeekDriverId: params.driver_id } : {}),
      ...(params?.bounds !== undefined ? { goalSeekBounds: params.bounds } : {}),
    });

    try {
      const result = (await call("plan.goal_seek", {
        target_cell: targetCell,
        target_value: targetValue,
        driver_id: driverId,
        bounds,
      })) as PlanGoalSeekData;

      set({
        status: result.converged ? "populated" : "success",
        goalSeekData: result,
        error: null,
      });
    } catch (err) {
      set({
        status: "error",
        error: err as BridgeError,
        goalSeekData: null,
      });
    }
  },

  retry: async () => {
    const { lastAction } = get();
    if (lastAction === "overlay") {
      await get().runOverlay();
    } else if (lastAction === "sensitivity") {
      await get().runSensitivity();
    } else if (lastAction === "goalseek") {
      await get().runGoalSeek();
    }
  },

  reset: () => set({ ...DEFAULT_STATE }),

  clearError: () => set({ error: null }),
}));

export const useWhatifStore = useWhatIfStore;

export type {
  PlanGoalSeekArgs,
  PlanGoalSeekData,
  PlanSensitivityArgs,
  PlanSensitivityData,
  PlanWhatifOverlayArgs,
  PlanWhatifOverlayData,
  SensitivityValueStep,
  TornadoBar,
  WaterfallStep,
  WhatifSeries,
  WhatifSeriesPoint,
};
