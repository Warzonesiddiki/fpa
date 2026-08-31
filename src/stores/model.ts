/**
 * S-041 Model Grid store (F-012 · SCREENS-SPEC S-041).
 *
 * Owns the 5 screen states and the edit/recalc flow for the flagship grid:
 *   * Lines  ← `coa.list` (accounts become planning lines — `model_lines.account_id` per DB).
 *   * Periods ← `calendar.preview` (the working fiscal calendar; P01…P12/13 + YTD/FY).
 *   * Edits  → `model.cell.set.v1` (audited write) + the HyperFormula worker `setCell`
 *              (computed values/YTD/FY come from the real engine graph — FORMULA-ENGINE-SPEC §5).
 *   * Recalc → `model.recalc` (flat envelope) + worker `recalc`.
 *
 * Working-set ids: M3-1 has no scenario-select screen yet (S-050), so the store pins the
 * documented working scenario/model UUIDs (API-SPEC §2/§3 examples) until scenario picker lands.
 */
import { create } from "zustand";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";
import { useSessionStore } from "@/stores/session";
import type { ScreenState } from "@/components/ui/StatePanel";
import { createModelEngineClient } from "@/workers/modelEngineClient";
import type { ModelEngineClient } from "@/workers/modelEngineClient";
import type {
  CellInspectResult,
  EngineRecalcReport,
  GridCellView,
  ModelGridLine,
  ModelGridPeriod,
  SetCellInput,
} from "@/workers/modelEngine";

/** M3-1 working scenario (API-SPEC §3 example id). Scenario selection ships with S-050. */
export const WORKING_SCENARIO_ID = "3f9f2c9e-9f8b-4e2d-9a1c-400000000003";
/** M3-1 working model (API-SPEC §2 example id). */
export const WORKING_MODEL_ID = "3f9f2c9e-9f8b-4e2d-9a1c-400000000001";
/** Working fiscal calendar: 12-month year, April start, from today — the S-022 default. */
export const WORKING_CALENDAR = {
  preset: "12month",
  fy_start_month: 4,
} as const;
/** Working currency until the Company settings command exposes it (Rust DEFAULT_CURRENCY: USD). */
const WORKING_CURRENCY = "USD";

export type ModelCellKey = string;

function cellKey(line_id: string, period_id: string): string {
  return `${line_id}:${period_id}`;
}

/** `fp-{year}-p{period_no}` — documented fiscal-period id (DATABASE-SCHEMA §2). */
export function periodIdFromPreview(fyLabel: string, periodNo: number): string {
  const year = fyLabel.replace(/^FY/i, "");
  return `fp-${year}-p${String(periodNo).padStart(2, "0")}`;
}

interface ModelGridState {
  status: ScreenState;
  error: BridgeError | null;
  lines: ModelGridLine[];
  periods: ModelGridPeriod[];
  /** key `${line_id}:${period_id}` → rendered cell facts. */
  cells: Record<string, GridCellView>;
  /** line_id → YTD/FY derived display values. */
  derived: Record<string, { ytd: string | null; fy: string | null }>;
  recalc: EngineRecalcReport | null;
  auditId: number | null;
  currency: string;
  scale: number;
  scenarioId: string;
  client: ModelEngineClient | null;
  load: () => Promise<void>;
  setCell: (input: SetCellInput) => Promise<boolean>;
  inspectCell: (lineId: string, periodId: string) => Promise<CellInspectResult>;
  recalcAll: () => Promise<void>;
  retry: () => Promise<void>;
  reset: () => void;
}

let client: ModelEngineClient | null = null;

function getClient(): ModelEngineClient {
  if (!client) client = createModelEngineClient();
  return client;
}

export const useModelGridStore = create<ModelGridState>((set, get) => ({
  status: "loading",
  error: null,
  lines: [],
  periods: [],
  cells: {},
  derived: {},
  recalc: null,
  auditId: null,
  currency: WORKING_CURRENCY,
  scale: 2,
  scenarioId: WORKING_SCENARIO_ID,
  client: null,

  load: async () => {
    set({ status: "loading", error: null });
    const companyId = useSessionStore.getState().companyId;
    if (!companyId) {
      set({ status: "empty", error: null, lines: [], periods: [] });
      return;
    }
    try {
      const accounts = (await call("coa.list", { company_id: companyId })) as {
        id: string;
        code: string;
        name: string;
      }[];
      const calendar = (await call("calendar.preview", {
        preset: WORKING_CALENDAR.preset,
        fy_start_month: WORKING_CALENDAR.fy_start_month,
        week_start_day: 0,
        anchor_rule: null,
        year_end_rule: null,
        from: new Date().toISOString().slice(0, 10),
        year_count: 1,
      })) as {
        fiscal_years: {
          fy_label: string;
          periods: {
            period_no: number;
            code: string;
          }[];
        }[];
      };
      const firstYear = calendar.fiscal_years[0];
      const lines: ModelGridLine[] = accounts.map((a) => ({
        id: a.id,
        label: `${a.code} · ${a.name}`,
        method: "manual",
      }));
      const periods: ModelGridPeriod[] = (firstYear?.periods ?? []).map((p) => ({
        id: periodIdFromPreview(firstYear.fy_label, p.period_no),
        code: p.code,
      }));

      if (lines.length === 0) {
        set({ status: "empty", lines, periods, error: null });
        return;
      }

      const engine = getClient();
      await engine.loadGrid({ lines, periods });
      const grid = await engine.getGrid();
      const cells: Record<string, GridCellView> = {};
      for (const c of grid) cells[cellKey(c.line_id, c.period_id)] = c;
      const derived: Record<string, { ytd: string | null; fy: string | null }> = {};
      for (const line of lines) derived[line.id] = await engine.getDerived(line.id);

      set({ status: "success", lines, periods, cells, derived, error: null, client: engine });
    } catch (err) {
      set({ status: "error", error: err as BridgeError });
    }
  },

  setCell: async (input: SetCellInput) => {
    const s = get();
    if (!s.client) return false;
    // Audited persistence + whitelist/money validation gate (B7/B18-2), then the real graph.
    try {
      const written = (await call("model.cell.set.v1", {
        line_id: input.line_id,
        scenario_id: s.scenarioId,
        period_id: input.period_id,
        value: input.value ?? null,
        formula: input.formula ?? null,
        manual_override: input.manual_override ?? false,
      })) as { recalc: EngineRecalcReport; audit_id: number };
      await s.client.setCell(input);
      const grid = await s.client.getGrid();
      const cells: Record<string, GridCellView> = { ...s.cells };
      for (const c of grid) cells[cellKey(c.line_id, c.period_id)] = c;
      const derived = { ...s.derived };
      derived[input.line_id] = await s.client.getDerived(input.line_id);
      set({
        status: "populated",
        cells,
        derived,
        recalc: written.recalc,
        error: null,
        auditId: written.audit_id,
      });
      return true;
    } catch (err) {
      set({ status: "error", error: err as BridgeError });
      return false;
    }
  },

  inspectCell: async (lineId: string, periodId: string): Promise<CellInspectResult> => {
    const s = get();
    if (!s.client) throw new Error("MODEL_GRID_NOT_LOADED: load the grid first");
    // Read-only — no audit event (AUTH-SPEC §3: inspect is session-unlocked only).
    return s.client.inspectCell(lineId, periodId);
  },

  recalcAll: async () => {
    const s = get();
    if (!s.client) return;
    try {
      await call("model.recalc", {
        model_id: WORKING_MODEL_ID,
        scenario_id: s.scenarioId,
      });
      const report = await s.client.recalc();
      const cells: Record<string, GridCellView> = {};
      for (const c of await s.client.getGrid()) cells[cellKey(c.line_id, c.period_id)] = c;
      const derived: Record<string, { ytd: string | null; fy: string | null }> = {};
      for (const line of s.lines) derived[line.id] = await s.client.getDerived(line.id);
      set({ status: "populated", cells, derived, recalc: report, error: null });
    } catch (err) {
      set({ status: "error", error: err as BridgeError });
    }
  },

  retry: async () => {
    await get().load();
  },

  reset: () => {
    client?.destroy();
    client = null;
    set({
      status: "loading",
      error: null,
      lines: [],
      periods: [],
      cells: {},
      derived: {},
      recalc: null,
      auditId: null,
      client: null,
    });
  },
}));
