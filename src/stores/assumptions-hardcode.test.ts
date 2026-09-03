import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assumptionEffectiveForPeriod,
  assumptionValueForPeriod,
  diffAssumptionValues,
  hardcodeFindingKey,
  useAssumptionStore,
} from "./assumptions";
import type { HardcodedFinding, HardcodedLiteral } from "@/workers/modelEngine";

const callMock = vi.fn();
const { scanMock, convertMock } = vi.hoisted(() => ({
  scanMock: vi.fn(),
  convertMock: vi.fn(),
}));
const fakeClient = {
  scanHardcoded: scanMock,
  convertHardcoded: convertMock,
  setCell: vi.fn(),
};

vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const { companyIdMock, modelIdMock, engineClientMock } = vi.hoisted(() => ({
  companyIdMock: vi.fn(),
  modelIdMock: vi.fn(),
  engineClientMock: vi.fn(),
}));
vi.mock("@/stores/session", () => ({
  useSessionStore: { getState: () => ({ companyId: companyIdMock(), modelId: modelIdMock() }) },
}));
vi.mock("@/stores/model", () => ({
  getModelEngineClient: () => engineClientMock(),
  activeScenarioId: () => "3f9f2c9e-9f8b-4e2d-9a1c-400000000003",
  WORKING_MODEL_ID: "3f9f2c9e-9f8b-4e2d-9a1c-400000000001",
  WORKING_SCENARIO_ID: "3f9f2c9e-9f8b-4e2d-9a1c-400000000003",
}));

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

const FINDING: HardcodedFinding = {
  line_id: "line-salary",
  period_id: "fp-2026-p01",
  formula: "=base_salary*1.04",
  literals: [{ literal: "1.04", start: 13, end: 17 }],
};
const LITERAL: HardcodedLiteral = { literal: "1.04", start: 13, end: 17 };

describe("M3-4 hardcoded-assumption detection (store)", () => {
  beforeEach(() => {
    callMock.mockReset();
    scanMock.mockReset();
    convertMock.mockReset();
    companyIdMock.mockReturnValue(COMPANY_ID);
    modelIdMock.mockReturnValue(null);
    engineClientMock.mockReturnValue(fakeClient);
    useAssumptionStore.getState().reset();
  });

  describe("effective-period + diff helpers", () => {
    it("honors effective_from/effective_to for a fiscal period", () => {
      const assumption = {
        effective_from: "fp-2026-p02",
        effective_to: "fp-2026-p04",
      };
      expect(assumptionEffectiveForPeriod(assumption, "fp-2026-p01")).toBe(false);
      expect(assumptionEffectiveForPeriod(assumption, "fp-2026-p02")).toBe(true);
      expect(assumptionEffectiveForPeriod(assumption, "fp-2026-p03")).toBe(true);
      expect(assumptionEffectiveForPeriod(assumption, "fp-2026-p04")).toBe(true);
      expect(assumptionEffectiveForPeriod(assumption, "fp-2026-p05")).toBe(false);
      expect(
        assumptionEffectiveForPeriod({ effective_from: null, effective_to: null }, "fp-2026-p01"),
      ).toBe(true);
    });

    it("resolves an assumption value only within its effective window", () => {
      const assumption = {
        effective_from: "fp-2026-p01",
        effective_to: "fp-2026-p01",
        values: { "fp-2026-p01": "4.0", "fp-2026-p02": "5.0" },
      };
      expect(assumptionValueForPeriod(assumption, "fp-2026-p01")).toBe("4.0");
      expect(assumptionValueForPeriod(assumption, "fp-2026-p02")).toBeNull();
    });

    it("computes a deterministic before → after period-value diff", () => {
      expect(
        diffAssumptionValues(
          { "fp-2026-p01": "4.0", "fp-2026-p02": "4.0" },
          { "fp-2026-p01": "4.0", "fp-2026-p02": "5.0" },
        ),
      ).toEqual([{ period_id: "fp-2026-p02", before: "4.0", after: "5.0" }]);
      expect(diffAssumptionValues({ "fp-2026-p01": "4.0" }, {})).toEqual([
        { period_id: "fp-2026-p01", before: "4.0", after: null },
      ]);
    });

    it("builds a stable waiver key from the finding and literal span", () => {
      expect(hardcodeFindingKey(FINDING, LITERAL)).toBe("line-salary:fp-2026-p01:13:17");
    });
  });

  it("scans the shared engine and surfaces findings deterministically", async () => {
    scanMock.mockResolvedValue([FINDING]);
    const findings = await useAssumptionStore.getState().scanHardcoded();
    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(findings).toEqual([FINDING]);
    const state = useAssumptionStore.getState();
    expect(state.hardcodeStatus).toBe("populated");
    expect(state.findings).toEqual([FINDING]);

    scanMock.mockResolvedValue([]);
    await useAssumptionStore.getState().scanHardcoded();
    expect(useAssumptionStore.getState().hardcodeStatus).toBe("empty");
  });

  it("records a scan failure without throwing", async () => {
    scanMock.mockRejectedValue({
      code: "INTERNAL",
      userMessage: "Scan failed.",
      httpStatus: 500,
      retryable: true,
      retryAfterMs: null,
      details: {},
    });
    const findings = await useAssumptionStore.getState().scanHardcoded();
    expect(findings).toEqual([]);
    expect(useAssumptionStore.getState().hardcodeStatus).toBe("error");
    expect(useAssumptionStore.getState().hardcodeError?.code).toBe("INTERNAL");
  });

  it("converts a hardcoded literal through the audited model write then the engine", async () => {
    callMock.mockResolvedValue({ recalc: {}, audit_id: 1 });
    convertMock.mockResolvedValue({ cell: { formula: "=base_salary*wage_inflation" } });
    scanMock.mockResolvedValue([]);

    const ok = await useAssumptionStore
      .getState()
      .convertHardcoded(FINDING, LITERAL, "wage_inflation");
    expect(ok).toBe(true);
    expect(callMock).toHaveBeenCalledWith("model.cell.set.v1", {
      line_id: "line-salary",
      scenario_id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000003",
      period_id: "fp-2026-p01",
      value: null,
      formula: "=base_salary*wage_inflation",
      manual_override: false,
    });
    expect(convertMock).toHaveBeenCalledWith(
      "line-salary",
      "fp-2026-p01",
      LITERAL,
      "wage_inflation",
    );
    expect(useAssumptionStore.getState().hardcodeStatus).toBe("empty");
  });

  it("waives a literal only with a non-empty reason and supports undo", () => {
    const rejected = useAssumptionStore.getState().waiveHardcoded(FINDING, LITERAL, "   ");
    expect(rejected).toBe(false);
    expect(useAssumptionStore.getState().hardcodeError?.code).toBe("VALUE_INVALID");
    expect(useAssumptionStore.getState().waived).toEqual({});

    const ok = useAssumptionStore
      .getState()
      .waiveHardcoded(FINDING, LITERAL, "fixed cost baseline");
    expect(ok).toBe(true);
    const key = hardcodeFindingKey(FINDING, LITERAL);
    expect(useAssumptionStore.getState().waived[key]?.reason).toBe("fixed cost baseline");

    useAssumptionStore.getState().unwaiveHardcoded(key);
    expect(useAssumptionStore.getState().waived).toEqual({});
  });

  it("clears hardcode state when the register resets", async () => {
    scanMock.mockResolvedValue([FINDING]);
    await useAssumptionStore.getState().scanHardcoded();
    expect(useAssumptionStore.getState().findings).toHaveLength(1);
    useAssumptionStore.getState().reset();
    const state = useAssumptionStore.getState();
    expect(state.findings).toEqual([]);
    expect(state.waived).toEqual({});
    expect(state.hardcodeStatus).toBe("empty");
  });
});
