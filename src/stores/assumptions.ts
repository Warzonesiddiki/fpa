import { create } from "zustand";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";
import type { AssumptionDef } from "@/api/schema";
import { WORKING_MODEL_ID } from "@/stores/model";
import type { ScreenState } from "@/components/ui/StatePanel";
interface State {
  status: ScreenState;
  error: BridgeError | null;
  assumptions: AssumptionDef[];
  load: () => Promise<void>;
  upsert: (a: AssumptionDef) => Promise<boolean>;
  findUsages: (id: string) => Promise<{ line_id: string; period_id: string; formula: string }[]>;
}
export const useAssumptionStore = create<State>((set, get) => ({
  status: "loading",
  error: null,
  assumptions: [],
  load: async () => {
    set({ status: "loading", error: null });
    set({ status: get().assumptions.length ? "populated" : "empty" });
  },
  upsert: async (a) => {
    try {
      const r = (await call("assumption.upsert", {
        model_id: WORKING_MODEL_ID,
        assumption: a,
      })) as { assumption_id: string };
      const next = { ...a, id: r.assumption_id };
      set((s) => ({
        assumptions: [...s.assumptions.filter((x) => x.id !== next.id), next],
        status: "populated",
        error: null,
      }));
      return true;
    } catch (e) {
      set({ status: "error", error: e as BridgeError });
      return false;
    }
  },
  findUsages: async (id) => {
    try {
      return (
        (await call("assumption.find_usages", { assumption_id: id })) as {
          cells: { line_id: string; period_id: string; formula: string }[];
        }
      ).cells;
    } catch (e) {
      set({ status: "error", error: e as BridgeError });
      return [];
    }
  },
}));
