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
import {
  History,
  buildFillEdits,
  buildPasteEdits,
  serializeSelection,
  snapshotFromView,
  snapshotToInput,
  type SelectionRect,
} from "@/stores/modelHistory";

/** M3-1 working scenario (API-SPEC §3 example id). Scenario selection ships with S-050. */
export const WORKING_SCENARIO_ID = "3f9f2c9e-9f8b-4e2d-9a1c-400000000003";
/**
 * API-SPEC §2 example model id — the dev/test fallback ONLY. The native core mints a fresh model
 * UUID per Company (`company.create` → `create_default_model`) and every model-scoped command
 * checks `model_belongs_to_company`, so this id is never valid against a real `.fpa` file.
 * Product code must resolve the model through `activeModelId()`.
 */
export const WORKING_MODEL_ID = "3f9f2c9e-9f8b-4e2d-9a1c-400000000001";

/**
 * The active Model for model-scoped commands (`driver.upsert`, `model.recalc`, `assumption.*`):
 * the id the core returned from `session.unlock` / `company.open` / `session.status`
 * (STATE-MANAGEMENT §2 "active model id from Company lifecycle"). Falls back to the documented
 * example id only when no session model is known (browser preview before unlock, unit tests).
 */
export function activeModelId(): string {
  return useSessionStore.getState().modelId ?? WORKING_MODEL_ID;
}
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
  /** Active (selected) cell — drives the formula bar and paste anchoring. */
  active: { lineId: string; periodId: string } | null;
  /** Current selection rectangle (anchor × focus); `null` when nothing is selected. */
  selection: SelectionRect | null;
  /** In-memory edit history (M3-9 undo/redo). */
  history: History;
  canUndo: boolean;
  canRedo: boolean;
  load: () => Promise<void>;
  setCell: (input: SetCellInput) => Promise<boolean>;
  /** Internal core write (validate+audit via `model.cell.set.v1`, then graph) — no history. */
  applyEdit: (input: SetCellInput) => Promise<boolean>;
  inspectCell: (lineId: string, periodId: string) => Promise<CellInspectResult>;
  recalcAll: () => Promise<void>;
  retry: () => Promise<void>;
  reset: () => void;
  /** Select a single cell (collapse any range selection to it). */
  setActiveCell: (lineId: string, periodId: string) => void;
  /** Shift+click / extend: grow the selection to include `lineId:periodId`. */
  extendSelection: (lineId: string, periodId: string) => void;
  /** Arrow-key navigation: move the active cell by a (line, period) delta, collapse selection. */
  moveActive: (dLine: number, dPeriod: number) => void;
  /** Shift+arrow: extend the focus corner of the selection by a (line, period) delta. */
  selectTo: (dLine: number, dPeriod: number) => void;
  clearSelection: () => void;
  /** Undo the last edit (replays the stored before-snapshot through the audited path). */
  undo: () => Promise<void>;
  /** Redo the last undone edit. */
  redo: () => Promise<void>;
  /** Fill the selection down or right from its source edge (relative refs adjusted). */
  fillSelection: (direction: "down" | "right") => Promise<void>;
  /** Paste a TSV/CSV clipboard block anchored at the active cell (VALUE_INVALID on bad input). */
  pasteBlock: (text: string) => Promise<boolean>;
  /** Serialize the current selection to TSV (formula text or exact decimal per cell). */
  copySelection: () => string;
}

let client: ModelEngineClient | null = null;

function getClient(): ModelEngineClient {
  if (!client) client = createModelEngineClient();
  return client;
}

/**
 * Shared engine client — the Driver store (M3-3) uses the SAME HyperFormula graph so driver values
 * feed the Model grid's formulas. Creating a second client would give a second, isolated workbook.
 */
export function getModelEngineClient(): ModelEngineClient {
  return getClient();
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
  active: null,
  selection: null,
  history: new History(),
  canUndo: false,
  canRedo: false,

  load: async () => {
    set({ status: "loading", error: null });
    const companyId = useSessionStore.getState().companyId;
    if (!companyId) {
      set({
        status: "empty",
        error: null,
        lines: [],
        periods: [],
        active: null,
        selection: null,
        history: new History(),
        canUndo: false,
        canRedo: false,
      });
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
        set({
          status: "empty",
          lines,
          periods,
          error: null,
          active: null,
          selection: null,
          history: new History(),
          canUndo: false,
          canRedo: false,
        });
        return;
      }

      const engine = getClient();
      await engine.loadGrid({ lines, periods });
      const grid = await engine.getGrid();
      const cells: Record<string, GridCellView> = {};
      for (const c of grid) cells[cellKey(c.line_id, c.period_id)] = c;
      const derived: Record<string, { ytd: string | null; fy: string | null }> = {};
      for (const line of lines) derived[line.id] = await engine.getDerived(line.id);

      set({
        status: "success",
        lines,
        periods,
        cells,
        derived,
        error: null,
        client: engine,
        active: null,
        selection: null,
        history: new History(),
        canUndo: false,
        canRedo: false,
      });
    } catch (err) {
      set({ status: "error", error: err as BridgeError });
    }
  },

  /**
   * Core cell write: validate + audit through `model.cell.set.v1` (B7/B18-2), then apply to the
   * real HyperFormula graph. Does NOT record history — callers (`setCell`, `fillSelection`,
   * `pasteBlock`, `undo`, `redo`) own the history bookkeeping so each user action is one entry.
   * A clear (both value & formula null) is graph-only: the catalogued command requires a value or
   * formula, so a clear reconciles the engine without an IPC round-trip (M3-1 persistence is
   * already PARTIAL — `model.cell.set.v1` validates + audits only).
   */
  applyEdit: async (input: SetCellInput): Promise<boolean> => {
    const s = get();
    if (!s.client) return false;
    const isClear = input.value == null && input.formula == null;
    try {
      let auditId = s.auditId;
      let recalc: EngineRecalcReport | null = s.recalc;
      if (!isClear) {
        const written = (await call("model.cell.set.v1", {
          line_id: input.line_id,
          scenario_id: s.scenarioId,
          period_id: input.period_id,
          value: input.value ?? null,
          formula: input.formula ?? null,
          manual_override: input.manual_override ?? false,
        })) as { recalc: EngineRecalcReport; audit_id: number };
        auditId = written.audit_id;
        recalc = written.recalc;
      }
      if (isClear) await s.client.clearCell(input.line_id, input.period_id);
      else await s.client.setCell(input);
      const grid = await s.client.getGrid();
      const cells: Record<string, GridCellView> = { ...s.cells };
      for (const c of grid) cells[cellKey(c.line_id, c.period_id)] = c;
      const derived = { ...s.derived };
      derived[input.line_id] = await s.client.getDerived(input.line_id);
      set({ status: "populated", cells, derived, recalc, auditId, error: null });
      return true;
    } catch (err) {
      set({ status: "error", error: err as BridgeError });
      return false;
    }
  },

  setCell: async (input: SetCellInput) => {
    const s = get();
    if (!s.client) return false;
    const before = snapshotFromView(
      s.cells[cellKey(input.line_id, input.period_id)] ?? {
        line_id: input.line_id,
        period_id: input.period_id,
        amount_text: null,
        formula: null,
        computed_text: null,
        error_code: null,
        manual_override: false,
      },
    );
    const ok = await s.applyEdit(input);
    if (!ok) return false;
    const s2 = get();
    const after = snapshotFromView(
      s2.cells[cellKey(input.line_id, input.period_id)] ?? {
        line_id: input.line_id,
        period_id: input.period_id,
        amount_text: null,
        formula: null,
        computed_text: null,
        error_code: null,
        manual_override: false,
      },
    );
    s2.history.push({ label: "edit", cells: [{ before, after }] });
    set({ canUndo: s2.history.canUndo, canRedo: s2.history.canRedo });
    return true;
  },

  setActiveCell: (lineId, periodId) =>
    set({
      active: { lineId, periodId },
      selection: { anchor: { lineId, periodId }, focus: { lineId, periodId } },
    }),

  extendSelection: (lineId, periodId) => {
    const s = get();
    const anchor = s.selection?.anchor ?? s.active ?? { lineId, periodId };
    set({
      selection: { anchor, focus: { lineId, periodId } },
      active: { lineId, periodId },
    });
  },

  moveActive: (dLine, dPeriod) => {
    const s = get();
    const cur = s.active ?? s.selection?.anchor ?? null;
    if (!cur || s.lines.length === 0 || s.periods.length === 0) return;
    const lineIds = s.lines.map((l) => l.id);
    const periodIds = s.periods.map((p) => p.id);
    const i = lineIds.indexOf(cur.lineId);
    const j = periodIds.indexOf(cur.periodId);
    if (i < 0 || j < 0) return;
    const ni = Math.max(0, Math.min(lineIds.length - 1, i + dLine));
    const nj = Math.max(0, Math.min(periodIds.length - 1, j + dPeriod));
    const lineId = lineIds[ni];
    const periodId = periodIds[nj];
    set({
      active: { lineId, periodId },
      selection: { anchor: { lineId, periodId }, focus: { lineId, periodId } },
    });
  },

  selectTo: (dLine, dPeriod) => {
    const s = get();
    const base = s.selection?.focus ?? s.active ?? s.selection?.anchor ?? null;
    if (!base || s.lines.length === 0 || s.periods.length === 0) return;
    const lineIds = s.lines.map((l) => l.id);
    const periodIds = s.periods.map((p) => p.id);
    const i = lineIds.indexOf(base.lineId);
    const j = periodIds.indexOf(base.periodId);
    if (i < 0 || j < 0) return;
    const ni = Math.max(0, Math.min(lineIds.length - 1, i + dLine));
    const nj = Math.max(0, Math.min(periodIds.length - 1, j + dPeriod));
    const focus = { lineId: lineIds[ni], periodId: periodIds[nj] };
    const anchor = s.selection?.anchor ?? s.active ?? base;
    set({ selection: { anchor, focus }, active: focus });
  },

  clearSelection: () => set({ selection: null }),

  undo: async () => {
    const s = get();
    const entry = s.history.popUndo();
    if (!entry) return;
    for (const c of entry.cells) {
      const ok = await s.applyEdit(snapshotToInput(c.before));
      if (!ok) break;
    }
    const s2 = get();
    set({ canUndo: s2.history.canUndo, canRedo: s2.history.canRedo });
  },

  redo: async () => {
    const s = get();
    const entry = s.history.popRedo();
    if (!entry) return;
    for (const c of entry.cells) {
      const ok = await s.applyEdit(snapshotToInput(c.after));
      if (!ok) break;
    }
    const s2 = get();
    set({ canUndo: s2.history.canUndo, canRedo: s2.history.canRedo });
  },

  fillSelection: async (direction) => {
    const s = get();
    if (!s.selection || !s.client) return;
    const edits = buildFillEdits({
      direction,
      anchor: s.selection.anchor,
      focus: s.selection.focus,
      lines: s.lines,
      periods: s.periods,
      getCell: (lineId, periodId) => s.cells[cellKey(lineId, periodId)] ?? null,
    });
    if (edits.length === 0) return;
    const items = edits.map((e) => ({
      before: snapshotFromView(
        s.cells[cellKey(e.line_id, e.period_id)] ?? {
          line_id: e.line_id,
          period_id: e.period_id,
          amount_text: null,
          formula: null,
          computed_text: null,
          error_code: null,
          manual_override: false,
        },
      ),
      input: e,
    }));
    for (const it of items) {
      const ok = await s.applyEdit(it.input);
      if (!ok) return;
    }
    const s2 = get();
    const cells = items.map((it) => ({
      before: it.before,
      after: snapshotFromView(
        s2.cells[cellKey(it.input.line_id, it.input.period_id)] ?? {
          line_id: it.input.line_id,
          period_id: it.input.period_id,
          amount_text: null,
          formula: null,
          computed_text: null,
          error_code: null,
          manual_override: false,
        },
      ),
    }));
    s2.history.push({ label: `fill-${direction}`, cells });
    set({ canUndo: s2.history.canUndo, canRedo: s2.history.canRedo });
  },

  pasteBlock: async (text) => {
    const s = get();
    if (!s.active || !s.client) return false;
    let edits: SetCellInput[];
    try {
      edits = buildPasteEdits({ text, anchor: s.active, lines: s.lines, periods: s.periods });
    } catch (err) {
      const valueErr: BridgeError = {
        code: "VALUE_INVALID",
        userMessage: "Value is not valid for this cell (clipboard).",
        httpStatus: 422,
        retryable: false,
        retryAfterMs: null,
        details: { reason: (err as Error).message },
      };
      set({ status: "error", error: valueErr });
      return false;
    }
    if (edits.length === 0) return false;
    const items = edits.map((e) => ({
      before: snapshotFromView(
        s.cells[cellKey(e.line_id, e.period_id)] ?? {
          line_id: e.line_id,
          period_id: e.period_id,
          amount_text: null,
          formula: null,
          computed_text: null,
          error_code: null,
          manual_override: false,
        },
      ),
      input: e,
    }));
    for (const it of items) {
      const ok = await s.applyEdit(it.input);
      if (!ok) return false;
    }
    const s2 = get();
    const cells = items.map((it) => ({
      before: it.before,
      after: snapshotFromView(
        s2.cells[cellKey(it.input.line_id, it.input.period_id)] ?? {
          line_id: it.input.line_id,
          period_id: it.input.period_id,
          amount_text: null,
          formula: null,
          computed_text: null,
          error_code: null,
          manual_override: false,
        },
      ),
    }));
    s2.history.push({ label: "paste", cells });
    set({ canUndo: s2.history.canUndo, canRedo: s2.history.canRedo });
    return true;
  },

  copySelection: () => {
    const s = get();
    if (!s.selection) return "";
    const lineIds = s.lines.map((l) => l.id);
    const periodIds = s.periods.map((p) => p.id);
    const ai = lineIds.indexOf(s.selection.anchor.lineId);
    const aj = periodIds.indexOf(s.selection.anchor.periodId);
    const fi = lineIds.indexOf(s.selection.focus.lineId);
    const fj = periodIds.indexOf(s.selection.focus.periodId);
    if (ai < 0 || aj < 0 || fi < 0 || fj < 0) return "";
    const minI = Math.min(ai, fi);
    const maxI = Math.max(ai, fi);
    const minJ = Math.min(aj, fj);
    const maxJ = Math.max(aj, fj);
    const matrix: (GridCellView | null)[][] = [];
    for (let i = minI; i <= maxI; i += 1) {
      const row: (GridCellView | null)[] = [];
      for (let j = minJ; j <= maxJ; j += 1) {
        row.push(s.cells[cellKey(lineIds[i], periodIds[j])] ?? null);
      }
      matrix.push(row);
    }
    return serializeSelection(matrix);
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
        model_id: activeModelId(),
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
      active: null,
      selection: null,
      history: new History(),
      canUndo: false,
      canRedo: false,
    });
  },
}));
