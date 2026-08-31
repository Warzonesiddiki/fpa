/**
 * S-044 Assumption Register store (F-014 · SCREENS-SPEC S-044).
 *
 * Assumptions are exact decimal inputs with required ownership/source metadata. The store keeps a
 * session cache for the current model, sends every write through `assumption.upsert` (the Rust
 * command is the persisted/audited owner), and keeps usage lookup read-only. There is intentionally
 * no local calculation or bound coercion here: the UI must never silently change a financial input.
 *
 * The IPC catalog includes an explicit `assumption.list` read command so a reload reads SQLite;
 * an empty persisted response is therefore a real Empty state rather than an inference from a
 * client cache. The cache remains useful for immediate updates and keeps the UI responsive after a
 * successful audited write.
 */
import { create } from "zustand";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";
import { AssumptionListData, type AssumptionDef, type AssumptionListRow } from "@/api/schema";
import { useSessionStore } from "@/stores/session";
import { WORKING_MODEL_ID } from "@/stores/model";
import type { ScreenState } from "@/components/ui/StatePanel";

export interface AssumptionUsage {
  line_id: string;
  period_id: string;
  formula: string;
}

export interface AssumptionHistoryEntry {
  version: number;
  changed_at: string;
  assumption: AssumptionDef;
}

export type AssumptionRecord = AssumptionListRow;

interface AssumptionStoreState {
  status: ScreenState;
  error: BridgeError | null;
  usageError: BridgeError | null;
  assumptions: AssumptionRecord[];
  usages: Record<string, AssumptionUsage[]>;
  history: Record<string, AssumptionHistoryEntry[]>;
  loadedCompanyId: string | null;
  loadedModelId: string | null;
  load: () => Promise<void>;
  upsert: (assumption: AssumptionDef) => Promise<boolean>;
  findUsages: (assumptionId: string) => Promise<AssumptionUsage[]>;
  retry: () => Promise<void>;
  reset: () => void;
}

function orderAssumptions(assumptions: AssumptionRecord[]): AssumptionRecord[] {
  return [...assumptions].sort((a, b) => a.name.localeCompare(b.name));
}

function clearCompanyCache(
  set: (patch: Partial<AssumptionStoreState>) => void,
  companyId: string,
  modelId: string,
) {
  set({
    assumptions: [],
    usages: {},
    history: {},
    loadedCompanyId: companyId,
    loadedModelId: modelId,
    usageError: null,
  });
}

function activeModelId(): string {
  return useSessionStore.getState().modelId ?? WORKING_MODEL_ID;
}

export const useAssumptionStore = create<AssumptionStoreState>((set, get) => ({
  status: "loading",
  error: null,
  usageError: null,
  assumptions: [],
  usages: {},
  history: {},
  loadedCompanyId: null,
  loadedModelId: null,

  /** Read persisted definitions and exact period values for the active Company/Model. */
  load: async () => {
    set({ status: "loading", error: null, usageError: null });
    const companyId = useSessionStore.getState().companyId;
    const modelId = activeModelId();
    if (!companyId) {
      set({
        status: "empty",
        assumptions: [],
        usages: {},
        history: {},
        loadedCompanyId: null,
        loadedModelId: null,
        error: null,
      });
      return;
    }

    if (get().loadedCompanyId !== companyId || get().loadedModelId !== modelId) {
      clearCompanyCache(set, companyId, modelId);
    }
    try {
      const assumptions = AssumptionListData.parse(
        await call("assumption.list", { model_id: modelId }),
      );
      set({
        status: assumptions.length > 0 ? "populated" : "empty",
        assumptions: orderAssumptions(assumptions),
        loadedCompanyId: companyId,
        loadedModelId: modelId,
        error: null,
      });
    } catch (err) {
      set({ status: "error", error: err as BridgeError });
    }
  },

  /** Persist one register row, then update the session cache only after the command succeeds. */
  upsert: async (assumption: AssumptionDef) => {
    try {
      const modelId = activeModelId();
      const written = (await call("assumption.upsert", {
        model_id: modelId,
        assumption,
      })) as { assumption_id: string };
      const id = written.assumption_id;
      const previous = get().assumptions.find((item) => item.id === id);
      const previousHistory = get().history[id] ?? [];
      const changedAt = new Date().toISOString();
      const version =
        Math.max(previous?.version ?? 0, ...previousHistory.map((item) => item.version)) + 1;
      const next: AssumptionRecord = {
        ...assumption,
        id,
        values: { ...assumption.values },
        version,
        last_changed_at: changedAt,
      };
      const historyEntry: AssumptionHistoryEntry = {
        version,
        changed_at: changedAt,
        assumption: next,
      };
      const usages = { ...get().usages };
      // A name change can alter the formula reference, so usage results must be requested again.
      delete usages[id];
      set({
        status: "populated",
        assumptions: orderAssumptions([
          ...get().assumptions.filter((item) => item.id !== id && item.name !== next.name),
          next,
        ]),
        usages,
        history: {
          ...get().history,
          [id]: [...previousHistory, historyEntry],
        },
        error: null,
        usageError: null,
        loadedModelId: modelId,
      });
      return true;
    } catch (err) {
      set({ status: "error", error: err as BridgeError });
      return false;
    }
  },

  /** Read-only usage lookup; a failed lookup does not hide the register table. */
  findUsages: async (assumptionId: string) => {
    try {
      const result = (await call("assumption.find_usages", {
        assumption_id: assumptionId,
      })) as { cells: AssumptionUsage[] };
      const cells = result.cells;
      set({ usages: { ...get().usages, [assumptionId]: cells }, usageError: null });
      return cells;
    } catch (err) {
      set({ usageError: err as BridgeError });
      return [];
    }
  },

  retry: async () => {
    await get().load();
  },

  reset: () => {
    set({
      status: "loading",
      error: null,
      usageError: null,
      assumptions: [],
      usages: {},
      history: {},
      loadedCompanyId: null,
      loadedModelId: null,
    });
  },
}));
