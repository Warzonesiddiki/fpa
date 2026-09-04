import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHeadcountStore } from "./headcount";
import type { HeadcountScheduleRow } from "@/model/headcount";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const { companyIdMock, modelIdMock } = vi.hoisted(() => ({
  companyIdMock: vi.fn(),
  modelIdMock: vi.fn(),
}));
vi.mock("@/stores/session", () => ({
  useSessionStore: { getState: () => ({ companyId: companyIdMock(), modelId: modelIdMock() }) },
}));
vi.mock("@/stores/model", () => ({
  activeModelId: () => modelIdMock() ?? "3f9f2c9e-9f8b-4e2d-9a1c-400000000001",
  WORKING_CALENDAR: { preset: "12month", fy_start_month: 4 },
}));

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";
const MODEL_ID = "3f9f2c9e-9f8b-4e2d-9a1c-100000000001";
const CALENDAR = {
  fiscal_years: [
    {
      fy_label: "FY2026",
      start_date: "2026-04-01",
      end_date: "2026-06-30",
      week_count: 52 as const,
      periods: [
        {
          period_no: 1,
          code: "P01",
          start_date: "2026-04-01",
          end_date: "2026-04-30",
          is_53rd_week: false,
        },
        {
          period_no: 2,
          code: "P02",
          start_date: "2026-05-01",
          end_date: "2026-05-31",
          is_53rd_week: false,
        },
        {
          period_no: 3,
          code: "P03",
          start_date: "2026-06-01",
          end_date: "2026-06-30",
          is_53rd_week: false,
        },
      ],
    },
  ],
};

const RECALC = {
  dirty_cells: 1,
  cycles: [],
  changed_cells: ["hc-row-1"],
  issues: [],
  duration_ms: 0,
};
const AUDIT_ID = 101;

function row(overrides: Partial<HeadcountScheduleRow> = {}): HeadcountScheduleRow {
  return {
    id: "hc-row-1",
    role: "Analyst",
    cost_center: "Finance",
    start_date: "2026-04-16",
    termination_date: null,
    base_comp_decimal: "1200",
    bonus_pct: "0",
    benefits_pct: "20",
    employer_load_pct: "0",
    ramp_months: 0,
    ...overrides,
  };
}

function installCalendar() {
  callMock.mockImplementation((command: string) => {
    if (command === "calendar.preview") return Promise.resolve(CALENDAR);
    return Promise.resolve({
      schedule_id: "3f9f2c9e-9f8b-4e2d-9a1c-600000000001",
      recalc: RECALC,
      audit_id: AUDIT_ID,
    });
  });
}

describe("headcount plan store (S-045)", () => {
  beforeEach(() => {
    callMock.mockReset();
    companyIdMock.mockReturnValue(COMPANY_ID);
    modelIdMock.mockReturnValue(MODEL_ID);
    useHeadcountStore.getState().reset();
  });

  it("shows an empty state without an open Company and does not call IPC", async () => {
    companyIdMock.mockReturnValue(null);
    await useHeadcountStore.getState().load();
    expect(useHeadcountStore.getState().status).toBe("empty");
    expect(callMock).not.toHaveBeenCalled();
  });

  it("loads fiscal dates and keeps a real empty schedule distinct from loading", async () => {
    installCalendar();
    await useHeadcountStore.getState().load();
    const state = useHeadcountStore.getState();
    expect(state.status).toBe("empty");
    expect(state.periods.map((period) => period.id)).toEqual([
      "fp-2026-p01",
      "fp-2026-p02",
      "fp-2026-p03",
    ]);
    expect(state.periods[1]).toMatchObject({ start_date: "2026-05-01", end_date: "2026-05-31" });
  });

  it("audits a row through model.schedule.upsert before exposing exact rollups", async () => {
    installCalendar();
    await useHeadcountStore.getState().load();
    const ok = await useHeadcountStore.getState().saveRow(row());
    expect(ok).toBe(true);
    expect(callMock).toHaveBeenLastCalledWith("model.schedule.upsert", {
      model_id: MODEL_ID,
      schedule_type: "headcount",
      rows: [row()],
    });
    const state = useHeadcountStore.getState();
    expect(state.status).toBe("success");
    expect(state.scheduleId).toBe("3f9f2c9e-9f8b-4e2d-9a1c-600000000001");
    expect(state.rollups[0]).toMatchObject({ active_headcount: 1, total_cost_decimal: "240" });
    expect(state.rollups[0].members[0]).toMatchObject({ active_days: 15, period_days: 30 });
  });

  it("blocks same-role overlap locally with a typed error and never sends the bad schedule", async () => {
    installCalendar();
    await useHeadcountStore.getState().load();
    await useHeadcountStore.getState().saveRow(row());
    callMock.mockClear();
    const ok = await useHeadcountStore
      .getState()
      .saveRow(row({ id: "hc-row-2", start_date: "2026-04-20" }));
    expect(ok).toBe(false);
    expect(callMock).not.toHaveBeenCalled();
    expect(useHeadcountStore.getState().error).toMatchObject({
      code: "HC_OVERLAP",
      httpStatus: 422,
    });
  });

  it("preserves the native error and existing rows when a schedule write fails", async () => {
    installCalendar();
    await useHeadcountStore.getState().load();
    callMock.mockRejectedValue({
      code: "AUDIT_CHAIN_BREAK",
      userMessage: "Audit integrity check failed. Restore from the last verified Snapshot?",
      httpStatus: 409,
      retryable: false,
      retryAfterMs: null,
      details: {},
    });
    const ok = await useHeadcountStore.getState().saveRow(row({ start_date: "2026-04-01" }));
    expect(ok).toBe(false);
    expect(useHeadcountStore.getState().status).toBe("error");
    expect(useHeadcountStore.getState().error?.code).toBe("AUDIT_CHAIN_BREAK");
    expect(useHeadcountStore.getState().rows).toEqual([]);
  });

  it("removes a row through the audited full-schedule command", async () => {
    installCalendar();
    await useHeadcountStore.getState().load();
    await useHeadcountStore.getState().saveRow(row());
    callMock.mockClear();
    const ok = await useHeadcountStore.getState().removeRow("hc-row-1");
    expect(ok).toBe(true);
    expect(useHeadcountStore.getState().status).toBe("empty");
    expect(useHeadcountStore.getState().rows).toEqual([]);
    expect(callMock).toHaveBeenCalledWith("model.schedule.upsert", {
      model_id: MODEL_ID,
      schedule_type: "headcount",
      rows: [],
    });
  });

  it("hands driver-data import to the existing pipeline and records the batch id", async () => {
    installCalendar();
    await useHeadcountStore.getState().load();
    callMock.mockResolvedValue({ batch_id: "3f9f2c9e-9f8b-4e2d-9a1c-300000000001" });
    const ok = await useHeadcountStore
      .getState()
      .importDriverData("/tmp/headcount.csv", "canonical");
    expect(ok).toBe(true);
    expect(useHeadcountStore.getState().importedBatchId).toBe(
      "3f9f2c9e-9f8b-4e2d-9a1c-300000000001",
    );
    expect(callMock).toHaveBeenCalledWith("driver.import", {
      file_path: "/tmp/headcount.csv",
      mapping_id: "canonical",
    });
  });
});
