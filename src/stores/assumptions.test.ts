import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssumptionStore } from "./assumptions";
const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const { companyIdMock, modelIdMock } = vi.hoisted(() => ({
  companyIdMock: vi.fn(),
  modelIdMock: vi.fn(),
}));
vi.mock("@/stores/session", () => ({
  useSessionStore: {
    getState: () => ({ companyId: companyIdMock(), modelId: modelIdMock() }),
  },
}));

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";
const ASSUMPTION_ID = "as-wage_inflation";

const WAGE: {
  name: string;
  unit: string;
  owner: string;
  source: string;
  values: Record<string, string>;
} = {
  name: "wage_inflation",
  unit: "%",
  owner: "HR",
  source: "HR plan",
  values: { "fp-2026-p01": "4.0", "fp-2026-p02": "4.0" },
};

describe("assumption register store (S-044)", () => {
  beforeEach(() => {
    callMock.mockReset();
    callMock.mockResolvedValue([]);
    companyIdMock.mockReturnValue(COMPANY_ID);
    modelIdMock.mockReturnValue(null);
    useAssumptionStore.getState().reset();
  });

  it("shows the empty state when no Company is open without invoking IPC", async () => {
    companyIdMock.mockReturnValue(null);
    await useAssumptionStore.getState().load();
    expect(useAssumptionStore.getState().status).toBe("empty");
    expect(useAssumptionStore.getState().assumptions).toEqual([]);
    expect(callMock).not.toHaveBeenCalled();
  });

  it("scopes the session cache to the active Company", async () => {
    await useAssumptionStore.getState().load();
    expect(useAssumptionStore.getState().loadedCompanyId).toBe(COMPANY_ID);

    callMock.mockResolvedValue({ assumption_id: ASSUMPTION_ID });
    await useAssumptionStore.getState().upsert({
      ...WAGE,
      bounds_low: "0",
      bounds_high: "10",
      effective_from: "fp-2026-p01",
      effective_to: null,
    });
    expect(useAssumptionStore.getState().assumptions).toHaveLength(1);

    companyIdMock.mockReturnValue("3f9f2c9e-9f8b-4e2d-9a1c-000000000002");
    callMock.mockResolvedValue([]);
    await useAssumptionStore.getState().load();
    expect(useAssumptionStore.getState().status).toBe("empty");
    expect(useAssumptionStore.getState().assumptions).toEqual([]);
  });

  it("uses the native active Model id and records an exact-decimal session version", async () => {
    const modelId = "3f9f2c9e-9f8b-4e2d-9a1c-100000000001";
    modelIdMock.mockReturnValue(modelId);
    callMock.mockResolvedValue({ assumption_id: ASSUMPTION_ID, created: true });
    const ok = await useAssumptionStore.getState().upsert({
      ...WAGE,
      bounds_low: "0",
      bounds_high: "10",
      effective_from: "fp-2026-p01",
      effective_to: null,
    });
    expect(ok).toBe(true);
    expect(callMock).toHaveBeenCalledWith("assumption.upsert", {
      model_id: modelId,
      assumption: expect.objectContaining({ name: "wage_inflation", values: WAGE.values }),
    });
    const state = useAssumptionStore.getState();
    expect(state.status).toBe("populated");
    expect(state.assumptions[0]?.values["fp-2026-p01"]).toBe("4.0");
    expect(state.history[ASSUMPTION_ID]).toHaveLength(1);
    expect(state.history[ASSUMPTION_ID]?.[0]?.version).toBe(1);
  });

  it("updates by id, orders rows by name, and increments the version history", async () => {
    callMock.mockResolvedValue({ assumption_id: "as-zeta", created: true });
    await useAssumptionStore.getState().upsert({
      ...WAGE,
      name: "zeta_rate",
      values: { "fp-2026-p01": "1.0" },
    });
    callMock.mockResolvedValue({ assumption_id: ASSUMPTION_ID, created: true });
    await useAssumptionStore.getState().upsert({ ...WAGE, values: { "fp-2026-p01": "4.0" } });
    await useAssumptionStore.getState().upsert({
      ...WAGE,
      id: ASSUMPTION_ID,
      values: { "fp-2026-p01": "5.0" },
    });

    const state = useAssumptionStore.getState();
    expect(state.assumptions.map((assumption) => assumption.name)).toEqual([
      "wage_inflation",
      "zeta_rate",
    ]);
    expect(state.assumptions.find((assumption) => assumption.id === ASSUMPTION_ID)?.values).toEqual(
      {
        "fp-2026-p01": "5.0",
      },
    );
    expect(state.history[ASSUMPTION_ID]).toHaveLength(2);
  });

  it("loads and caches read-only usage results", async () => {
    callMock.mockResolvedValue({ assumption_id: ASSUMPTION_ID });
    await useAssumptionStore.getState().upsert({ ...WAGE });
    const cells = [
      {
        line_id: "line-salary",
        period_id: "fp-2026-p01",
        formula: "=base_salary*(1+@wage_inflation)",
      },
    ];
    callMock.mockResolvedValue({ cells });

    await expect(useAssumptionStore.getState().findUsages(ASSUMPTION_ID)).resolves.toEqual(cells);
    expect(callMock).toHaveBeenLastCalledWith("assumption.find_usages", {
      assumption_id: ASSUMPTION_ID,
    });
    expect(useAssumptionStore.getState().usages[ASSUMPTION_ID]).toEqual(cells);
    expect(useAssumptionStore.getState().usageError).toBeNull();
  });

  it("keeps the register visible when usage lookup fails", async () => {
    callMock.mockResolvedValue({ assumption_id: ASSUMPTION_ID });
    await useAssumptionStore.getState().upsert({ ...WAGE });
    callMock.mockRejectedValue({
      code: "INTERNAL",
      userMessage: "Usage lookup failed.",
      httpStatus: 500,
      retryable: true,
      retryAfterMs: null,
      details: {},
    });

    await expect(useAssumptionStore.getState().findUsages(ASSUMPTION_ID)).resolves.toEqual([]);
    expect(useAssumptionStore.getState().status).toBe("populated");
    expect(useAssumptionStore.getState().usageError?.code).toBe("INTERNAL");
  });

  it("retries a cache load and resets all assumption state", async () => {
    await useAssumptionStore.getState().load();
    callMock.mockResolvedValue({ assumption_id: ASSUMPTION_ID });
    await useAssumptionStore.getState().upsert({ ...WAGE });
    callMock.mockResolvedValue([
      {
        ...WAGE,
        id: ASSUMPTION_ID,
        bounds_low: null,
        bounds_high: null,
        effective_from: null,
        effective_to: null,
        version: 1,
        last_changed_at: null,
      },
    ]);
    await useAssumptionStore.getState().retry();
    expect(useAssumptionStore.getState().status).toBe("populated");

    useAssumptionStore.getState().reset();
    const state = useAssumptionStore.getState();
    expect(state.status).toBe("loading");
    expect(state.assumptions).toEqual([]);
    expect(state.usages).toEqual({});
    expect(state.history).toEqual({});
  });
});
