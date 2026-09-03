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
import { getModelEngineClient, WORKING_MODEL_ID, WORKING_SCENARIO_ID } from "@/stores/model";
import type { ScreenState } from "@/components/ui/StatePanel";
import {
  convertHardcodedFormula,
  type HardcodedFinding,
  type HardcodedLiteral,
} from "@/workers/modelEngine";

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

/** A recorded waiver for one hardcoded literal (session-scoped; the audited event is Rust-owned). */
export interface HardcodeWaiver {
  reason: string;
  waived_at: string;
}

interface AssumptionStoreState {
  status: ScreenState;
  error: BridgeError | null;
  usageError: BridgeError | null;
  assumptions: AssumptionRecord[];
  usages: Record<string, AssumptionUsage[]>;
  history: Record<string, AssumptionHistoryEntry[]>;
  loadedCompanyId: string | null;
  loadedModelId: string | null;
  /** M3-4 hardcoded-assumption detection lifecycle (F-014 · US-015). */
  hardcodeStatus: ScreenState;
  hardcodeError: BridgeError | null;
  findings: HardcodedFinding[];
  waived: Record<string, HardcodeWaiver>;
  load: () => Promise<void>;
  upsert: (assumption: AssumptionDef) => Promise<boolean>;
  findUsages: (assumptionId: string) => Promise<AssumptionUsage[]>;
  scanHardcoded: () => Promise<HardcodedFinding[]>;
  convertHardcoded: (
    finding: HardcodedFinding,
    literal: HardcodedLiteral,
    assumptionName: string,
  ) => Promise<boolean>;
  waiveHardcoded: (finding: HardcodedFinding, literal: HardcodedLiteral, reason: string) => boolean;
  unwaiveHardcoded: (key: string) => void;
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
    hardcodeStatus: "empty",
    hardcodeError: null,
    findings: [],
    waived: {},
  });
}

function activeModelId(): string {
  return useSessionStore.getState().modelId ?? WORKING_MODEL_ID;
}

/** Stable key for one hardcoded literal (line × period × literal span). */
export function hardcodeFindingKey(
  finding: Pick<HardcodedFinding, "line_id" | "period_id">,
  literal: HardcodedLiteral,
): string {
  return `${finding.line_id}:${finding.period_id}:${literal.start}:${literal.end}`;
}

/** Compare two `fp-YYYY-pNN` fiscal-period ids chronologically without any float op (B3): the
 *  year and zero-padded period components are compared as fixed-width strings. Non-canonical ids
 *  fall back to lexicographic order. */
function comparePeriodIds(a: string, b: string): number {
  const left = a.match(/^fp-(\d+)-p(\d+)$/);
  const right = b.match(/^fp-(\d+)-p(\d+)$/);
  if (!left || !right) return a.localeCompare(b);
  const yearA = left[1].padStart(6, "0");
  const yearB = right[1].padStart(6, "0");
  if (yearA !== yearB) return yearA < yearB ? -1 : 1;
  const periodA = left[2].padStart(3, "0");
  const periodB = right[2].padStart(3, "0");
  if (periodA !== periodB) return periodA < periodB ? -1 : 1;
  return 0;
}

/** Whether a fiscal period falls inside the assumption's effective window (F-014 effective periods). */
export function assumptionEffectiveForPeriod(
  assumption: Pick<AssumptionDef, "effective_from" | "effective_to">,
  periodId: string,
): boolean {
  if (assumption.effective_from && comparePeriodIds(periodId, assumption.effective_from) < 0) {
    return false;
  }
  if (assumption.effective_to && comparePeriodIds(periodId, assumption.effective_to) > 0) {
    return false;
  }
  return true;
}

/** The exact value an assumption contributes for a period, or null when absent/out of window. */
export function assumptionValueForPeriod(
  assumption: Pick<AssumptionDef, "effective_from" | "effective_to" | "values">,
  periodId: string,
): string | null {
  if (!assumptionEffectiveForPeriod(assumption, periodId)) return null;
  return assumption.values[periodId] ?? null;
}

/** Period-level before → after diff for an assumption edit (change diff before apply, F-014). */
export function diffAssumptionValues(
  before: Record<string, string>,
  after: Record<string, string>,
): { period_id: string; before: string | null; after: string | null }[] {
  const periods = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...periods]
    .sort(comparePeriodIds)
    .map((periodId) => ({
      period_id: periodId,
      before: before[periodId] ?? null,
      after: after[periodId] ?? null,
    }))
    .filter((row) => row.before !== row.after);
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
  hardcodeStatus: "empty",
  hardcodeError: null,
  findings: [],
  waived: {},

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

  /**
   * Scan the shared engine's loaded Model grid for hardcoded numeric literals (F-014 · US-015).
   * Read-only: the scan never mutates the graph. Requires the Model grid to be loaded in the
   * shared engine; an unloaded grid simply yields the empty state.
   */
  scanHardcoded: async () => {
    set({ hardcodeStatus: "loading", hardcodeError: null });
    try {
      const engine = getModelEngineClient();
      const findings = await engine.scanHardcoded();
      set({
        hardcodeStatus: findings.length > 0 ? "populated" : "empty",
        findings,
        hardcodeError: null,
      });
      return findings;
    } catch (err) {
      set({ hardcodeStatus: "error", hardcodeError: err as BridgeError, findings: [] });
      return [];
    }
  },

  /**
   * Convert one hardcoded literal to an Assumption Register reference. The rewritten formula is
   * persisted through the audited `model.cell.set.v1` write first, then applied to the shared
   * engine graph, then the findings are re-scanned (F-014 "convert hardcode → register reference").
   */
  convertHardcoded: async (finding, literal, assumptionName) => {
    try {
      const converted = convertHardcodedFormula(finding.formula, literal, assumptionName);
      await call("model.cell.set.v1", {
        line_id: finding.line_id,
        scenario_id: WORKING_SCENARIO_ID,
        period_id: finding.period_id,
        value: null,
        formula: converted,
        manual_override: false,
      });
      const engine = getModelEngineClient();
      await engine.convertHardcoded(finding.line_id, finding.period_id, literal, assumptionName);
      const key = hardcodeFindingKey(finding, literal);
      const waived = { ...get().waived };
      delete waived[key];
      const findings = await engine.scanHardcoded();
      set({
        hardcodeStatus: findings.length > 0 ? "populated" : "empty",
        findings,
        waived,
        hardcodeError: null,
        error: null,
      });
      return true;
    } catch (err) {
      set({ hardcodeError: err as BridgeError });
      return false;
    }
  },

  /**
   * Waive one hardcoded literal with a required reason. Session-scoped: the audited waiver event
   * is owned by the Rust audit chain and is a follow-on under the native-toolchain policy
   * (never fabricated here — the reason is required and retained verbatim for that hand-off).
   */
  waiveHardcoded: (finding, literal, reason) => {
    const trimmed = reason.trim();
    if (!trimmed) {
      set({
        hardcodeError: {
          code: "VALUE_INVALID",
          userMessage: "A waiver reason is required.",
          httpStatus: 422,
          retryable: false,
          retryAfterMs: null,
          details: {},
        },
      });
      return false;
    }
    set({
      hardcodeError: null,
      waived: {
        ...get().waived,
        [hardcodeFindingKey(finding, literal)]: {
          reason: trimmed,
          waived_at: new Date().toISOString(),
        },
      },
    });
    return true;
  },

  /** Remove a session waiver for a hardcoded literal (the finding reappears in the scan list). */
  unwaiveHardcoded: (key: string) => {
    const waived = { ...get().waived };
    delete waived[key];
    set({ waived });
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
      hardcodeStatus: "empty",
      hardcodeError: null,
      findings: [],
      waived: {},
    });
  },
}));
