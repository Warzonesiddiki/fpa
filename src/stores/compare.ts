/**
 * S-051 Model Compare store (F-022 · M4-3 · SCENARIO-VERSION-SPEC §4).
 *
 * Owns the two-way cell diff between Scenarios/Versions:
 *   * loadDiff(scenarioA, versionA?, scenarioB, versionB?) → `model.diff` IPC
 *   * filterOnlyChanged toggle (default true per SPEC §4)
 *   * getFilteredRows() selector
 *
 * 5 screen states driven by `status`; errors surface as `BridgeError`.
 * The store does NOT own scenario selection — the S-051 page passes the
 * selected scenario/version ids to `loadDiff`.
 */
import { create } from "zustand";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";
import type { ScreenState } from "@/components/ui/StatePanel";
import type { ModelDiffRow } from "@/api/schema";

interface CompareState {
  status: ScreenState;
  error: BridgeError | null;
  /** Scenario A selection. */
  scenarioA: string | null;
  versionA: string | null;
  /** Scenario B selection. */
  scenarioB: string | null;
  versionB: string | null;
  /** Filter toggle: show only changed rows (default true per SPEC §4). */
  filterOnlyChanged: boolean;
  /** Raw diff rows from the backend. */
  diffRows: ModelDiffRow[];
  /** Load the diff for two scenarios/versions. */
  loadDiff: (
    scenarioA: string,
    versionA: string | null,
    scenarioB: string,
    versionB: string | null,
  ) => Promise<void>;
  /** Retry after an error. */
  retry: () => Promise<void>;
  /** Toggle the "only changed" filter. */
  setFilterOnlyChanged: (value: boolean) => void;
  /** Get rows after applying the filter. */
  getFilteredRows: () => ModelDiffRow[];
  /** Reset the store to empty state. */
  reset: () => void;
}

export const useCompareStore = create<CompareState>((set, get) => ({
  status: "empty",
  error: null,
  scenarioA: null,
  versionA: null,
  scenarioB: null,
  versionB: null,
  filterOnlyChanged: true,
  diffRows: [],

  loadDiff: async (scenarioA, versionA, scenarioB, versionB) => {
    set({
      status: "loading",
      error: null,
      scenarioA,
      versionA,
      scenarioB,
      versionB,
    });
    try {
      const result = (await call("model.diff", {
        scenario_a: scenarioA,
        version_a: versionA,
        scenario_b: scenarioB,
        version_b: versionB,
      })) as { diff_rows: ModelDiffRow[] };
      const diffRows = result.diff_rows ?? [];
      set({
        status: diffRows.length > 0 ? "populated" : "success",
        diffRows,
        error: null,
      });
    } catch (err) {
      set({ status: "error", error: err as BridgeError, diffRows: [] });
    }
  },

  retry: async () => {
    const { scenarioA, versionA, scenarioB, versionB } = get();
    if (scenarioA && scenarioB) {
      await get().loadDiff(scenarioA, versionA, scenarioB, versionB);
    }
  },

  setFilterOnlyChanged: (value) => set({ filterOnlyChanged: value }),

  getFilteredRows: () => {
    const { diffRows, filterOnlyChanged } = get();
    if (!filterOnlyChanged) return diffRows;
    return diffRows.filter((r) => r.is_changed);
  },

  reset: () =>
    set({
      status: "empty",
      error: null,
      scenarioA: null,
      versionA: null,
      scenarioB: null,
      versionB: null,
      filterOnlyChanged: true,
      diffRows: [],
    }),
}));
