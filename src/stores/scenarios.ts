/**
 * S-050 Scenario Manager store (F-022 · M4-2 · SCENARIO-VERSION-SPEC §1–§3).
 *
 * Owns the scenario lifecycle read + transitions for the active Company's Models:
 *   * List    ← `model.list {company_id} → Model[]` (read side; Model shape decision in TASKBOARD §11).
 *   * Create  → `scenario.create` (Draft; kind inherited from the Base when `base_id` is given).
 *   * Copy    → `scenario.duplicate` (Draft copy with the source's scenario-scoped values).
 *   * Flow    → `scenario.submit` (Draft→Review) · `scenario.approve` (Review→Approved)
 *               · `scenario.lock` (Approved→Locked, auto-writes Version vN)
 *               · `scenario.reopen` (Review/Approved/Locked→Draft, written reason required)
 *               · `scenario.delete` (Draft only, and only without Versions).
 *   * Baseline→ `baseline.set` (Locked only; replacing one requires a written reason).
 *
 * Errors surface as `BridgeError` on the store (`SCENARIO_NAME_DUP` 409,
 * `SCENARIO_LOCK_CONFLICT` 409, `BASELINE_REPLACE_REASON_REQUIRED` 422 — SCREENS-SPEC S-050).
 * Every transition is audited by the core; the store never mutates state locally on failure.
 */
import { create } from "zustand";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";
import { useSessionStore } from "@/stores/session";
import { activeModelId } from "@/stores/model";
import type { ModelSummary, ScenarioRow } from "@/api/schema";
import type { ScreenState } from "@/components/ui/StatePanel";

interface ScenariosState {
  status: ScreenState;
  error: BridgeError | null;
  /** Models of the active Company with their scenarios + versions (`model.list`). */
  models: ModelSummary[];
  /** Flattened scenarios of the active Model (S-050 table source). */
  scenarios: ScenarioRow[];
  load: () => Promise<void>;
  retry: () => Promise<void>;
  create: (name?: string, baseId?: string) => Promise<string | null>;
  duplicate: (sourceId: string, name?: string) => Promise<string | null>;
  submit: (scenarioId: string) => Promise<boolean>;
  approve: (scenarioId: string) => Promise<boolean>;
  lock: (scenarioId: string) => Promise<string | null>;
  reopen: (scenarioId: string, reason: string) => Promise<boolean>;
  remove: (scenarioId: string) => Promise<boolean>;
  setBaseline: (scenarioId: string, reason?: string) => Promise<boolean>;
}

/** Refresh the in-memory list after a successful mutation (STATE-MANAGEMENT §2 scenario rows). */
async function refreshLists(
  set: (partial: Partial<ScenariosState>) => void,
): Promise<ModelSummary[] | null> {
  try {
    const companyId = useSessionStore.getState().companyId;
    const models = (await call("model.list", { company_id: companyId ?? "" })) as ModelSummary[];
    const activeModel = activeModelId();
    const scenarios = models.find((m) => m.id === activeModel)?.scenarios ?? [];
    // A mutation can move the list into/out of the empty state (first create, last delete), so
    // recompute the screen state here — the S-050 page renders its 5 states off `status`.
    set({
      models,
      scenarios,
      status: scenarios.length > 0 ? "populated" : "empty",
      error: null,
    });
    return models;
  } catch {
    return null;
  }
}

export const useScenarioStore = create<ScenariosState>((set, get) => ({
  status: "loading",
  error: null,
  models: [],
  scenarios: [],

  load: async () => {
    set({ status: "loading", error: null });
    const companyId = useSessionStore.getState().companyId;
    if (!companyId) {
      set({ status: "empty", error: null, models: [], scenarios: [] });
      return;
    }
    try {
      const models = (await call("model.list", { company_id: companyId })) as ModelSummary[];
      const activeModel = activeModelId();
      const scenarios = models.find((m) => m.id === activeModel)?.scenarios ?? [];
      set({
        status: scenarios.length > 0 ? "populated" : "empty",
        models,
        scenarios,
        error: null,
      });
    } catch (err) {
      set({ status: "error", error: err as BridgeError });
    }
  },

  retry: async () => {
    await get().load();
  },

  create: async (name, baseId) => {
    try {
      const out = (await call("scenario.create", {
        model_id: activeModelId(),
        name,
        base_id: baseId,
      })) as { scenario_id: string; version_id: string | null };
      await refreshLists(set);
      return out.scenario_id;
    } catch (err) {
      set({ error: err as BridgeError });
      return null;
    }
  },

  duplicate: async (sourceId, name) => {
    try {
      const out = (await call("scenario.duplicate", {
        model_id: activeModelId(),
        name,
        base_id: sourceId,
      })) as { scenario_id: string; version_id: string | null };
      await refreshLists(set);
      return out.scenario_id;
    } catch (err) {
      set({ error: err as BridgeError });
      return null;
    }
  },

  submit: async (scenarioId) => {
    try {
      await call("scenario.submit", { scenario_id: scenarioId });
      await refreshLists(set);
      return true;
    } catch (err) {
      set({ error: err as BridgeError });
      return false;
    }
  },

  approve: async (scenarioId) => {
    try {
      await call("scenario.approve", { scenario_id: scenarioId });
      await refreshLists(set);
      return true;
    } catch (err) {
      set({ error: err as BridgeError });
      return false;
    }
  },

  lock: async (scenarioId) => {
    try {
      const out = (await call("scenario.lock", { scenario_id: scenarioId })) as {
        scenario_id: string;
        version_id: string | null;
      };
      await refreshLists(set);
      return out.version_id;
    } catch (err) {
      set({ error: err as BridgeError });
      return null;
    }
  },

  reopen: async (scenarioId, reason) => {
    try {
      await call("scenario.reopen", { scenario_id: scenarioId, reason });
      await refreshLists(set);
      return true;
    } catch (err) {
      set({ error: err as BridgeError });
      return false;
    }
  },

  remove: async (scenarioId) => {
    try {
      await call("scenario.delete", { scenario_id: scenarioId });
      await refreshLists(set);
      return true;
    } catch (err) {
      set({ error: err as BridgeError });
      return false;
    }
  },

  setBaseline: async (scenarioId, reason) => {
    try {
      await call(
        "baseline.set",
        reason ? { scenario_id: scenarioId, reason } : { scenario_id: scenarioId },
      );
      await refreshLists(set);
      return true;
    } catch (err) {
      set({ error: err as BridgeError });
      return false;
    }
  },
}));
