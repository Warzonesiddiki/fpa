/**
 * S-045 Headcount Plan store (F-016 · M3-6).
 *
 * The native command contract is `model.schedule.upsert`; this store keeps the current schedule in
 * a session cache because the catalog has no schedule.list read command yet. Every schedule write
 * still crosses the audited command before the exact-decimal TS preview is recalculated. The cache
 * and calculations are intentionally marked as a preview mirror until the Rust handler and SQLite
 * persistence land (B1/B18-3); this unit is not DONE while that mock/native gap exists.
 */
import { create } from "zustand";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";
import {
  CalendarPreviewData,
  ModelScheduleUpsertData,
  type ModelScheduleUpsertArgs,
} from "@/api/schema";
import { useSessionStore } from "@/stores/session";
import { activeModelId, WORKING_CALENDAR } from "@/stores/model";
import type { ScreenState } from "@/components/ui/StatePanel";
import {
  calculateHeadcountRollup,
  newHeadcountRowId,
  validateHeadcountRows,
  type HeadcountPeriod,
  type HeadcountPeriodRollup,
  type HeadcountScheduleRow,
} from "@/model/headcount";
import type { EngineRecalcReport } from "@/workers/modelEngine";

export type {
  HeadcountPeriod,
  HeadcountPeriodRollup,
  HeadcountScheduleRow,
} from "@/model/headcount";

export interface HeadcountStoreState {
  status: ScreenState;
  error: BridgeError | null;
  rows: HeadcountScheduleRow[];
  periods: HeadcountPeriod[];
  rollups: HeadcountPeriodRollup[];
  scheduleId: string | null;
  recalc: EngineRecalcReport | null;
  importedBatchId: string | null;
  loadedCompanyId: string | null;
  loadedModelId: string | null;
  load: () => Promise<void>;
  saveRow: (row: HeadcountScheduleRow) => Promise<boolean>;
  removeRow: (rowId: string) => Promise<boolean>;
  importDriverData: (filePath: string, mappingId: string) => Promise<boolean>;
  retry: () => Promise<void>;
  reset: () => void;
}

function errorFromIssue(issue: {
  code: string;
  userMessage: string;
  details: Record<string, unknown>;
}): BridgeError {
  return {
    code: issue.code,
    userMessage: issue.userMessage,
    httpStatus: 422,
    retryable: false,
    retryAfterMs: null,
    details: issue.details,
  };
}

function periodIdFromPreview(fyLabel: string, periodNo: number): string {
  const year = fyLabel.replace(/^FY/i, "");
  return `fp-${year}-p${String(periodNo).padStart(2, "0")}`;
}

function normalizeRow(
  row: HeadcountScheduleRow,
  existing: HeadcountScheduleRow[],
): HeadcountScheduleRow {
  return {
    id: row.id ?? newHeadcountRowId(existing),
    role: row.role.trim(),
    cost_center: row.cost_center.trim(),
    start_date: row.start_date,
    termination_date: row.termination_date?.trim() || null,
    base_comp_decimal: row.base_comp_decimal.trim(),
    bonus_pct: row.bonus_pct.trim(),
    benefits_pct: row.benefits_pct.trim(),
    employer_load_pct: row.employer_load_pct.trim(),
    ramp_months: row.ramp_months,
  };
}

function currentRollups(rows: HeadcountScheduleRow[], periods: HeadcountPeriod[]) {
  return calculateHeadcountRollup(rows, periods);
}

export const useHeadcountStore = create<HeadcountStoreState>((set, get) => ({
  status: "loading",
  error: null,
  rows: [],
  periods: [],
  rollups: [],
  scheduleId: null,
  recalc: null,
  importedBatchId: null,
  loadedCompanyId: null,
  loadedModelId: null,

  /** Load the active Company's fiscal dates; schedule rows remain session-scoped until list exists. */
  load: async () => {
    set({ status: "loading", error: null });
    const companyId = useSessionStore.getState().companyId;
    const modelId = activeModelId();
    if (!companyId) {
      set({
        status: "empty",
        error: null,
        rows: [],
        periods: [],
        rollups: [],
        scheduleId: null,
        recalc: null,
        importedBatchId: null,
        loadedCompanyId: null,
        loadedModelId: null,
      });
      return;
    }

    const identityChanged = get().loadedCompanyId !== companyId || get().loadedModelId !== modelId;
    if (identityChanged) {
      set({
        rows: [],
        rollups: [],
        scheduleId: null,
        recalc: null,
        importedBatchId: null,
        loadedCompanyId: companyId,
        loadedModelId: modelId,
      });
    }

    try {
      const calendar = CalendarPreviewData.parse(
        await call("calendar.preview", {
          preset: WORKING_CALENDAR.preset,
          fy_start_month: WORKING_CALENDAR.fy_start_month,
          week_start_day: 0,
          anchor_rule: null,
          year_end_rule: null,
          from: new Date().toISOString().slice(0, 10),
          year_count: 1,
        }),
      );
      const firstYear = calendar.fiscal_years[0];
      const periods: HeadcountPeriod[] = (firstYear?.periods ?? []).map((period) => ({
        id: firstYear ? periodIdFromPreview(firstYear.fy_label, period.period_no) : period.code,
        code: period.code,
        start_date: period.start_date,
        end_date: period.end_date,
      }));
      const rows = identityChanged ? [] : get().rows;
      const issue = validateHeadcountRows(rows, periods);
      if (issue) {
        set({
          status: "error",
          error: errorFromIssue(issue),
          periods,
          rollups: [],
          loadedCompanyId: companyId,
          loadedModelId: modelId,
        });
        return;
      }
      set({
        status: rows.length > 0 ? "populated" : "empty",
        periods,
        rollups: currentRollups(rows, periods),
        loadedCompanyId: companyId,
        loadedModelId: modelId,
        error: null,
      });
    } catch (err) {
      set({ status: "error", error: err as BridgeError });
    }
  },

  /** Replace one role row, persist the complete schedule, then recalculate the preview. */
  saveRow: async (row) => {
    const existing = get().rows;
    const nextRow = normalizeRow(row, existing);
    const rows = [...existing.filter((candidate) => candidate.id !== nextRow.id), nextRow];
    const issue = validateHeadcountRows(rows, get().periods);
    if (issue) {
      set({ status: "error", error: errorFromIssue(issue) });
      return false;
    }
    try {
      const args: ModelScheduleUpsertArgs = {
        model_id: activeModelId(),
        schedule_type: "headcount",
        rows,
      };
      const written = ModelScheduleUpsertData.parse(await call("model.schedule.upsert", args));
      const periods = get().periods;
      set({
        status: "success",
        rows,
        rollups: currentRollups(rows, periods),
        scheduleId: written.schedule_id,
        recalc: written.recalc,
        error: null,
        loadedModelId: activeModelId(),
      });
      return true;
    } catch (err) {
      set({ status: "error", error: err as BridgeError });
      return false;
    }
  },

  /** Remove one row through the same audited full-schedule write (no silent local deletion). */
  removeRow: async (rowId) => {
    const rows = get().rows.filter((row) => row.id !== rowId);
    const issue = validateHeadcountRows(rows, get().periods);
    if (issue) {
      set({ status: "error", error: errorFromIssue(issue) });
      return false;
    }
    try {
      const written = ModelScheduleUpsertData.parse(
        await call("model.schedule.upsert", {
          model_id: activeModelId(),
          schedule_type: "headcount",
          rows,
        }),
      );
      set({
        status: rows.length > 0 ? "success" : "empty",
        rows,
        rollups: currentRollups(rows, get().periods),
        scheduleId: written.schedule_id,
        recalc: written.recalc,
        error: null,
      });
      return true;
    } catch (err) {
      set({ status: "error", error: err as BridgeError });
      return false;
    }
  },

  /** Hand off a driver-data file to the catalogued import path; row materialisation is native follow-on. */
  importDriverData: async (filePath, mappingId) => {
    if (!filePath.trim() || !mappingId.trim()) {
      set({
        status: "error",
        error: errorFromIssue({
          code: "VALUE_INVALID",
          userMessage: "Choose a driver-data file and mapping before importing.",
          details: { file_path_required: !filePath.trim(), mapping_id_required: !mappingId.trim() },
        }),
      });
      return false;
    }
    try {
      const written = (await call("driver.import", {
        file_path: filePath.trim(),
        mapping_id: mappingId.trim(),
      })) as { batch_id: string };
      set({
        status: get().rows.length > 0 ? "success" : "empty",
        importedBatchId: written.batch_id,
        error: null,
      });
      return true;
    } catch (err) {
      set({ status: "error", error: err as BridgeError });
      return false;
    }
  },

  retry: async () => {
    await get().load();
  },

  reset: () => {
    set({
      status: "loading",
      error: null,
      rows: [],
      periods: [],
      rollups: [],
      scheduleId: null,
      recalc: null,
      importedBatchId: null,
      loadedCompanyId: null,
      loadedModelId: null,
    });
  },
}));
