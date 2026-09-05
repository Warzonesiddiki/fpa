import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompareStore } from "./compare";
import type { ModelDiffRow } from "@/api/schema";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const SC_A = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";
const SC_B = "3f9f2c9e-9f8b-4e2d-9a1c-000000000002";
const V1 = "5c4f1a2b-9d3e-4c7a-8b2f-100000000001";

function diffRow(overrides: Partial<ModelDiffRow> = {}): ModelDiffRow {
  return {
    line_id: "ln-rev",
    sheet_id: "sh-rev",
    sheet_name: "Revenue",
    line_name: "ln-rev",
    account_id: null,
    driver_id: null,
    driver_name: null,
    period_id: "fp-2027-p01",
    period_label: "fp-2027-p01",
    value_a: "100.00",
    value_a_minor: 10000,
    formula_a: null,
    value_b: "120.00",
    value_b_minor: 12000,
    formula_b: null,
    delta_minor: 2000,
    delta_text: "2000",
    delta_pct: 0.2,
    is_changed: true,
    ...overrides,
  };
}

describe("useCompareStore (M4-3 · S-051 · SCENARIO-VERSION-SPEC §4)", () => {
  beforeEach(() => {
    useCompareStore.getState().reset();
    callMock.mockReset();
  });

  it("starts in empty state with default changed-only filter", () => {
    const s = useCompareStore.getState();
    expect(s.status).toBe("empty");
    expect(s.error).toBeNull();
    expect(s.filterOnlyChanged).toBe(true);
    expect(s.diffRows).toEqual([]);
    expect(s.scenarioA).toBeNull();
    expect(s.scenarioB).toBeNull();
  });

  it("loads diff and transitions to populated when rows exist", async () => {
    const row1 = diffRow();
    const row2 = diffRow({
      period_id: "fp-2027-p02",
      is_changed: false,
      delta_minor: 0,
      delta_pct: 0,
    });
    callMock.mockResolvedValueOnce({ diff_rows: [row1, row2] });

    await useCompareStore.getState().loadDiff(SC_A, null, SC_B, V1);

    const s = useCompareStore.getState();
    expect(s.status).toBe("populated");
    expect(s.scenarioA).toBe(SC_A);
    expect(s.versionA).toBeNull();
    expect(s.scenarioB).toBe(SC_B);
    expect(s.versionB).toBe(V1);
    expect(s.diffRows).toHaveLength(2);

    // filterOnlyChanged defaults to true
    expect(s.getFilteredRows()).toHaveLength(1);
    expect(s.getFilteredRows()[0].line_id).toBe("ln-rev");

    // toggle changed filter off
    s.setFilterOnlyChanged(false);
    expect(useCompareStore.getState().getFilteredRows()).toHaveLength(2);
  });

  it("transitions to success when diff_rows is empty", async () => {
    callMock.mockResolvedValueOnce({ diff_rows: [] });

    await useCompareStore.getState().loadDiff(SC_A, null, SC_B, null);

    const s = useCompareStore.getState();
    expect(s.status).toBe("success");
    expect(s.diffRows).toEqual([]);
    expect(s.error).toBeNull();
  });

  it("transitions to error and surfaces BridgeError when model.diff rejects", async () => {
    const bridgeError = {
      code: "COMPARE_INCOMPATIBLE",
      userMessage: "Cannot compare: Models/COAs differ. Select two Scenarios of the same Model.",
      httpStatus: 422,
      retryable: false,
    };
    callMock.mockRejectedValueOnce(bridgeError);

    await useCompareStore.getState().loadDiff(SC_A, null, SC_B, null);

    const s = useCompareStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toEqual(bridgeError);
    expect(s.diffRows).toEqual([]);
  });

  it("retries with current scenario selection", async () => {
    const bridgeError = {
      code: "INTERNAL",
      userMessage: "An unexpected error occurred.",
      httpStatus: 500,
      retryable: true,
    };
    callMock.mockRejectedValueOnce(bridgeError);

    await useCompareStore.getState().loadDiff(SC_A, "v1", SC_B, "v2");
    expect(useCompareStore.getState().status).toBe("error");

    callMock.mockResolvedValueOnce({ diff_rows: [diffRow()] });
    await useCompareStore.getState().retry();

    const s = useCompareStore.getState();
    expect(s.status).toBe("populated");
    expect(s.diffRows).toHaveLength(1);
  });

  it("resets back to initial empty state", async () => {
    callMock.mockResolvedValueOnce({ diff_rows: [diffRow()] });
    await useCompareStore.getState().loadDiff(SC_A, null, SC_B, null);
    expect(useCompareStore.getState().status).toBe("populated");

    useCompareStore.getState().reset();
    const s = useCompareStore.getState();
    expect(s.status).toBe("empty");
    expect(s.scenarioA).toBeNull();
    expect(s.diffRows).toEqual([]);
    expect(s.filterOnlyChanged).toBe(true);
  });
});
