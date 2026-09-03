import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDriverStore } from "./drivers";
import { useModelGridStore, WORKING_MODEL_ID, WORKING_SCENARIO_ID } from "./model";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const { companyIdMock, modelIdMock } = vi.hoisted(() => ({
  companyIdMock: vi.fn(),
  modelIdMock: vi.fn(),
}));
vi.mock("@/stores/session", () => ({
  useSessionStore: { getState: () => ({ companyId: companyIdMock(), modelId: modelIdMock() }) },
}));

const CO = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";
const DRIVER_ID = "dr-units";
const PERIOD = "fp-2026-p01";

const CALENDAR = {
  fiscal_years: [
    {
      fy_label: "FY2026",
      periods: [
        { period_no: 1, code: "P01" },
        { period_no: 2, code: "P02" },
      ],
    },
  ],
};

function mockCalendar() {
  callMock.mockImplementation((cmd: string) => {
    if (cmd === "calendar.preview") return Promise.resolve(CALENDAR);
    return Promise.resolve({});
  });
}

describe("driver tables store (S-043)", () => {
  beforeEach(() => {
    callMock.mockReset();
    companyIdMock.mockReturnValue(CO);
    // No native model id known → the store falls back to the documented example id.
    modelIdMock.mockReturnValue(null);
    // Reset the shared engine client — the driver store and model grid store share the same
    // HyperFormula graph (getModelEngineClient), so clearing it isolates the driver sheet per test.
    useModelGridStore.getState().reset();
    useDriverStore.getState().reset();
  });

  it("shows empty when no company is open", async () => {
    companyIdMock.mockReturnValue(null);
    await useDriverStore.getState().load();
    expect(useDriverStore.getState().status).toBe("empty");
    expect(callMock).not.toHaveBeenCalled();
  });

  it("loads fiscal periods and shows empty (create-your-first) when no drivers exist", async () => {
    mockCalendar();
    await useDriverStore.getState().load();
    const s = useDriverStore.getState();
    expect(s.status).toBe("empty");
    expect(s.periods.map((p) => p.id)).toEqual(["fp-2026-p01", "fp-2026-p02"]);
    expect(callMock).toHaveBeenCalledWith("calendar.preview", expect.anything());
  });

  it("upserts a driver through driver.upsert and moves to populated", async () => {
    mockCalendar();
    await useDriverStore.getState().load();
    callMock.mockResolvedValue({ driver_id: DRIVER_ID, created: true });
    const ok = await useDriverStore.getState().upsertDriver({
      name: "units",
      driver_type: "volume_x_rate",
      unit: "units",
      source: "global",
      is_core: true,
      bounds_low: "0",
      bounds_high: "100000",
    });
    expect(ok).toBe(true);
    expect(callMock).toHaveBeenCalledWith("driver.upsert", {
      model_id: WORKING_MODEL_ID,
      driver: expect.objectContaining({ name: "units", source: "global" }),
    });
    const s = useDriverStore.getState();
    expect(s.status).toBe("populated");
    expect(s.drivers).toHaveLength(1);
    expect(s.drivers[0].id).toBe(DRIVER_ID);
    expect(s.coreDriverCount).toBe(1);
  });

  it("sends the session's native Model id to driver.upsert, never the API-SPEC example id", async () => {
    // Regression (2026-09-03): the store sent WORKING_MODEL_ID while the core mints a per-Company
    // model id and `driver.upsert` enforces `model_belongs_to_company` → 403 in the shell.
    const nativeModelId = "3f9f2c9e-9f8b-4e2d-9a1c-100000000001";
    modelIdMock.mockReturnValue(nativeModelId);
    mockCalendar();
    await useDriverStore.getState().load();
    callMock.mockResolvedValue({ driver_id: DRIVER_ID, created: true });
    const ok = await useDriverStore.getState().upsertDriver({
      name: "units",
      driver_type: "volume_x_rate",
      unit: "units",
      source: "global",
      is_core: false,
    });
    expect(ok).toBe(true);
    expect(callMock).toHaveBeenCalledWith("driver.upsert", {
      model_id: nativeModelId,
      driver: expect.objectContaining({ name: "units" }),
    });
    expect(callMock).not.toHaveBeenCalledWith(
      "driver.upsert",
      expect.objectContaining({ model_id: WORKING_MODEL_ID }),
    );
  });

  it("surfaces the core's model-scope refusal (VALUE_INVALID/403) as the error state", async () => {
    mockCalendar();
    await useDriverStore.getState().load();
    callMock.mockRejectedValue({
      code: "VALUE_INVALID",
      userMessage: "This operation is not permitted.",
      httpStatus: 403,
      retryable: false,
      retryAfterMs: null,
      details: {},
    });
    const ok = await useDriverStore.getState().upsertDriver({
      name: "units",
      driver_type: "volume_x_rate",
      unit: "units",
      source: "global",
      is_core: false,
    });
    expect(ok).toBe(false);
    const s = useDriverStore.getState();
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("VALUE_INVALID");
    expect(s.error?.httpStatus).toBe(403);
    expect(s.drivers).toHaveLength(0);
  });

  it("sets a driver value through driver.set_value and stores the exact decimal", async () => {
    mockCalendar();
    await useDriverStore.getState().load();
    callMock.mockResolvedValue({ driver_id: "dr-price", created: true });
    await useDriverStore.getState().upsertDriver({
      name: "price",
      driver_type: "ratio",
      unit: null,
      source: "global",
      is_core: false,
    });
    callMock.mockResolvedValue({
      ok: true,
      value_decimal: "12000.50",
      recalc: {
        dirty_cells: 1,
        cycles: [],
        changed_cells: ["dr-price"],
        issues: [],
        duration_ms: 0,
      },
    });
    const ok = await useDriverStore.getState().setValue("dr-price", PERIOD, "12000.50");
    expect(ok).toBe(true);
    expect(callMock).toHaveBeenCalledWith("driver.set_value", {
      driver_id: "dr-price",
      scenario_id: WORKING_SCENARIO_ID,
      period_id: PERIOD,
      value_decimal: "12000.50",
    });
    const s = useDriverStore.getState();
    expect(s.status).toBe("populated");
    expect(s.values[`dr-price:${PERIOD}`]).toBe("12000.50");
  });

  it("propagates DRIVER_OUT_OF_BOUNDS from driver.set_value into the error state", async () => {
    mockCalendar();
    await useDriverStore.getState().load();
    callMock.mockResolvedValue({ driver_id: "dr-units", created: true });
    await useDriverStore.getState().upsertDriver({
      name: "units",
      driver_type: "volume_x_rate",
      unit: "units",
      source: "global",
      is_core: false,
      bounds_low: "0",
      bounds_high: "100",
    });
    callMock.mockRejectedValue({
      code: "DRIVER_OUT_OF_BOUNDS",
      userMessage: "Driver value 200000 is outside its bounds",
      httpStatus: 422,
    });
    const ok = await useDriverStore.getState().setValue("dr-units", PERIOD, "200000");
    expect(ok).toBe(false);
    expect(useDriverStore.getState().status).toBe("error");
    expect(useDriverStore.getState().error?.code).toBe("DRIVER_OUT_OF_BOUNDS");
  });

  it("imports a driver-data file through driver.import", async () => {
    mockCalendar();
    await useDriverStore.getState().load();
    callMock.mockResolvedValue({ batch_id: "3f9f2c9e-9f8b-4e2d-9a1c-300000000001" });
    const ok = await useDriverStore.getState().importDrivers("/tmp/drivers.xlsx", "canonical");
    expect(ok).toBe(true);
    expect(callMock).toHaveBeenCalledWith("driver.import", {
      file_path: "/tmp/drivers.xlsx",
      mapping_id: "canonical",
    });
  });

  it("retries a failed load and resets cleanly", async () => {
    callMock.mockRejectedValue({ code: "INTERNAL", userMessage: "boom", httpStatus: 500 });
    await useDriverStore.getState().load();
    expect(useDriverStore.getState().status).toBe("error");
    mockCalendar();
    await useDriverStore.getState().retry();
    expect(useDriverStore.getState().status).toBe("empty");
    useDriverStore.getState().reset();
    const s = useDriverStore.getState();
    expect(s.status).toBe("loading");
    expect(s.drivers).toEqual([]);
    expect(s.values).toEqual({});
  });
});
