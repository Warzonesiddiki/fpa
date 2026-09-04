import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScenarioStore } from "./scenarios";
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
const SC = WORKING_SCENARIO_ID;
const SC2 = "5c4f1a2b-9d3e-4c7a-8b2f-000000000001";
const V1 = "5c4f1a2b-9d3e-4c7a-8b2f-100000000001";

function scenarioRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SC,
    model_id: WORKING_MODEL_ID,
    name: "Base",
    kind: "budget",
    state: "draft",
    parent_scenario_id: null,
    baseline: false,
    versions: [],
    ...overrides,
  };
}

function mockModelList(rows: ReturnType<typeof scenarioRow>[]) {
  callMock.mockImplementation((cmd: string) => {
    if (cmd === "model.list") {
      return Promise.resolve([
        {
          id: WORKING_MODEL_ID,
          company_id: CO,
          name: "Working Model",
          horizon: 1,
          pack_id: null,
          scenarios: rows,
        },
      ]);
    }
    if (cmd === "scenario.create" || cmd === "scenario.duplicate") {
      return Promise.resolve({ scenario_id: SC2, version_id: null });
    }
    if (cmd === "scenario.lock") return Promise.resolve({ scenario_id: SC, version_id: V1 });
    if (cmd === "baseline.set") return Promise.resolve({ baseline_version_id: V1 });
    return Promise.resolve({ scenario_id: SC, version_id: null });
  });
}

const BRIDGE_ERROR = {
  code: "SCENARIO_LOCK_CONFLICT",
  userMessage: "This Scenario is already in locked — cannot transition.",
  httpStatus: 409,
  retryable: false,
  retryAfterMs: null,
  details: {},
};

describe("scenario store (S-050 · F-022)", () => {
  beforeEach(() => {
    callMock.mockReset();
    companyIdMock.mockReturnValue(CO);
    modelIdMock.mockReturnValue(WORKING_MODEL_ID);
    useModelGridStore.setState({ scenarioId: WORKING_SCENARIO_ID });
    useScenarioStore.setState({ status: "loading", error: null, models: [], scenarios: [] });
  });

  it("loads models + the active model's scenarios through model.list", async () => {
    mockModelList([scenarioRow(), scenarioRow({ id: SC2, name: "Plan v2", state: "review" })]);
    await useScenarioStore.getState().load();
    const s = useScenarioStore.getState();
    expect(s.status).toBe("populated");
    expect(s.models).toHaveLength(1);
    expect(s.scenarios.map((x) => x.id)).toEqual([SC, SC2]);
    expect(callMock).toHaveBeenCalledWith("model.list", { company_id: CO });
  });

  it("shows empty when no Company is open or the model has no scenarios", async () => {
    companyIdMock.mockReturnValue(null);
    await useScenarioStore.getState().load();
    expect(useScenarioStore.getState().status).toBe("empty");

    companyIdMock.mockReturnValue(CO);
    mockModelList([]);
    await useScenarioStore.getState().load();
    expect(useScenarioStore.getState().status).toBe("empty");
  });

  it("surfaces model.list failures as the error state with the BridgeError", async () => {
    callMock.mockRejectedValue(BRIDGE_ERROR);
    await useScenarioStore.getState().load();
    const s = useScenarioStore.getState();
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("SCENARIO_LOCK_CONFLICT");

    callMock.mockImplementation((cmd: string) =>
      cmd === "model.list" ? Promise.resolve([]) : Promise.resolve({}),
    );
    await useScenarioStore.getState().retry();
    expect(useScenarioStore.getState().status).toBe("empty");
  });

  it("create/duplicate write through the catalogued commands and refresh the list", async () => {
    mockModelList([scenarioRow()]);
    let created = false;
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "model.list") {
        return Promise.resolve([
          {
            id: WORKING_MODEL_ID,
            company_id: CO,
            name: "Working Model",
            horizon: 1,
            pack_id: null,
            scenarios: created
              ? [scenarioRow(), scenarioRow({ id: SC2, name: "Base (copy)" })]
              : [scenarioRow()],
          },
        ]);
      }
      if (cmd === "scenario.duplicate") {
        created = true;
        return Promise.resolve({ scenario_id: SC2, version_id: null });
      }
      return Promise.resolve({ scenario_id: SC2, version_id: null });
    });
    const newId = await useScenarioStore.getState().duplicate(SC);
    expect(newId).toBe(SC2);
    expect(callMock).toHaveBeenCalledWith("scenario.duplicate", {
      model_id: WORKING_MODEL_ID,
      name: undefined,
      base_id: SC,
    });
    expect(useScenarioStore.getState().scenarios).toHaveLength(2);

    const createdId = await useScenarioStore.getState().create("Q4 Forecast");
    expect(createdId).toBe(SC2);
    expect(callMock).toHaveBeenCalledWith("scenario.create", {
      model_id: WORKING_MODEL_ID,
      name: "Q4 Forecast",
      base_id: undefined,
    });
  });

  it("submit/approve/lock/reopen/remove/setBaseline each call their command and refresh", async () => {
    mockModelList([scenarioRow({ state: "locked", versions: [{} as never] })]);
    const store = useScenarioStore.getState();
    await expect(store.submit(SC)).resolves.toBe(true);
    expect(callMock).toHaveBeenCalledWith("scenario.submit", { scenario_id: SC });
    await expect(store.approve(SC)).resolves.toBe(true);
    expect(callMock).toHaveBeenCalledWith("scenario.approve", { scenario_id: SC });
    await expect(store.lock(SC)).resolves.toBe(V1);
    expect(callMock).toHaveBeenCalledWith("scenario.lock", { scenario_id: SC });
    await expect(store.reopen(SC, "restatement")).resolves.toBe(true);
    expect(callMock).toHaveBeenCalledWith("scenario.reopen", {
      scenario_id: SC,
      reason: "restatement",
    });
    await expect(store.remove(SC)).resolves.toBe(true);
    expect(callMock).toHaveBeenCalledWith("scenario.delete", { scenario_id: SC });
    await expect(store.setBaseline(SC)).resolves.toBe(true);
    expect(callMock).toHaveBeenCalledWith("baseline.set", { scenario_id: SC });
    await expect(store.setBaseline(SC, "re-approve")).resolves.toBe(true);
    expect(callMock).toHaveBeenCalledWith("baseline.set", {
      scenario_id: SC,
      reason: "re-approve",
    });
  });

  it("keeps transition errors on the store without mutating the local list", async () => {
    mockModelList([scenarioRow({ state: "locked" })]);
    await useScenarioStore.getState().load();
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "scenario.approve") return Promise.reject(BRIDGE_ERROR);
      return Promise.resolve({});
    });
    const ok = await useScenarioStore.getState().approve(SC);
    expect(ok).toBe(false);
    const s = useScenarioStore.getState();
    expect(s.error?.code).toBe("SCENARIO_LOCK_CONFLICT");
    expect(s.error?.userMessage).toBe("This Scenario is already in locked — cannot transition.");
    expect(s.scenarios[0].state).toBe("locked");
  });
});

describe("scenario store — S-050 empty ↔ populated status (first create / last delete)", () => {
  beforeEach(() => {
    callMock.mockReset();
    companyIdMock.mockReturnValue(CO);
    modelIdMock.mockReturnValue(WORKING_MODEL_ID);
    useModelGridStore.setState({ scenarioId: WORKING_SCENARIO_ID });
    useScenarioStore.setState({ status: "loading", error: null, models: [], scenarios: [] });
  });

  it("leaves the empty state after the first Scenario is created", async () => {
    let rows: ReturnType<typeof scenarioRow>[] = [];
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "model.list")
        return Promise.resolve([
          {
            id: WORKING_MODEL_ID,
            company_id: CO,
            name: "Working Model",
            horizon: 1,
            pack_id: null,
            scenarios: rows,
          },
        ]);
      if (cmd === "scenario.create") {
        rows = [scenarioRow({ id: SC2, name: "Base" })];
        return Promise.resolve({ scenario_id: SC2, version_id: null });
      }
      return Promise.resolve({ scenario_id: SC, version_id: null });
    });
    await useScenarioStore.getState().load();
    expect(useScenarioStore.getState().status).toBe("empty");

    const id = await useScenarioStore.getState().create();
    expect(id).toBe(SC2);
    const s = useScenarioStore.getState();
    expect(s.status).toBe("populated");
    expect(s.scenarios.map((x) => x.id)).toEqual([SC2]);
  });

  it("returns to the empty state after the last Scenario is deleted", async () => {
    let rows: ReturnType<typeof scenarioRow>[] = [scenarioRow()];
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "model.list")
        return Promise.resolve([
          {
            id: WORKING_MODEL_ID,
            company_id: CO,
            name: "Working Model",
            horizon: 1,
            pack_id: null,
            scenarios: rows,
          },
        ]);
      if (cmd === "scenario.delete") {
        rows = [];
        return Promise.resolve({ scenario_id: SC, version_id: null });
      }
      return Promise.resolve({ scenario_id: SC, version_id: null });
    });
    await useScenarioStore.getState().load();
    expect(useScenarioStore.getState().status).toBe("populated");

    const ok = await useScenarioStore.getState().remove(SC);
    expect(ok).toBe(true);
    expect(useScenarioStore.getState().status).toBe("empty");
  });
});
