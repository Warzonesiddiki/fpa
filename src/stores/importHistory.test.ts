import { beforeEach, describe, expect, it, vi } from "vitest";
import { useImportHistoryStore } from "./importHistory";

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn() }));
vi.mock("@/api/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/bridge")>();
  return { ...actual, call: (...args: unknown[]) => callMock(...args) };
});

const COMPANY_ID = "11111111-2222-4333-8444-555555555555";
const BATCH_ID = "3f9f2c9e-9f8b-4e2d-9a1c-300000000002";
const PRIOR_BATCH_ID = "3f9f2c9e-9f8b-4e2d-9a1c-300000000001";
const ROW = {
  batch_id: BATCH_ID,
  name: "August actuals",
  kind: "gl_dump" as const,
  source_name: "SAP_GL_Aug2026.xlsx",
  source_hash: "a".repeat(64),
  mapping_version: "canonical-v1",
  status: "committed" as const,
  rows: 3,
  currency: "USD",
  debits_minor: 635_000_000,
  credits_minor: 635_000_000,
  tie_out_status: "pass" as const,
  rollback_to_batch_id: null,
  committed_at: "2026-09-02T00:00:02Z",
  created_at: "2026-09-02T00:00:02Z",
};
const PAGE = {
  rows: [ROW],
  meta: { page: 1, page_size: 25 as const, total: 1, total_pages: 1 },
};

function resetStore() {
  useImportHistoryStore.setState({
    companyId: null,
    status: "empty",
    error: null,
    result: null,
    requestId: 0,
    rollbackStatus: "empty",
    rollbackError: null,
    rollbackResult: null,
    rollbackBatchId: null,
    rollbackRequestId: 0,
  });
}

describe("persisted Import Batch history store", () => {
  beforeEach(() => {
    callMock.mockReset();
    resetStore();
  });

  it("loads a strict Company-scoped page and classifies empty history", async () => {
    expect(await useImportHistoryStore.getState().load()).toBe(false);
    expect(callMock).not.toHaveBeenCalled();

    useImportHistoryStore.getState().scopeToCompany(COMPANY_ID);
    callMock.mockResolvedValueOnce(PAGE);
    expect(await useImportHistoryStore.getState().load()).toBe(true);
    expect(callMock).toHaveBeenCalledWith("import.history", {
      company_id: COMPANY_ID,
      page: 1,
    });
    expect(useImportHistoryStore.getState()).toMatchObject({
      status: "populated",
      error: null,
      result: PAGE,
    });

    callMock.mockResolvedValueOnce({
      rows: [],
      meta: { page: 2, page_size: 25, total: 0, total_pages: 0 },
    });
    expect(await useImportHistoryStore.getState().load(2)).toBe(true);
    expect(useImportHistoryStore.getState()).toMatchObject({
      status: "empty",
      result: { rows: [], meta: { page: 2 } },
    });
  });

  it("rejects malformed history and preserves locked transport errors", async () => {
    useImportHistoryStore.getState().scopeToCompany(COMPANY_ID);
    callMock.mockResolvedValueOnce({ ...PAGE, rows: [{ ...ROW, currency: "usd" }] });
    expect(await useImportHistoryStore.getState().load()).toBe(false);
    expect(useImportHistoryStore.getState()).toMatchObject({
      status: "error",
      error: { code: "INTERNAL" },
      result: null,
    });

    callMock.mockResolvedValueOnce({
      rows: [],
      meta: { page: 1, page_size: 25, total: 0, total_pages: 0 },
    });
    expect(await useImportHistoryStore.getState().load(2)).toBe(false);
    expect(useImportHistoryStore.getState()).toMatchObject({
      status: "error",
      error: { code: "INTERNAL" },
      result: null,
    });

    useImportHistoryStore.setState({ status: "populated", error: null, result: PAGE });
    callMock.mockRejectedValueOnce({
      code: "TRANSPORT_UNAVAILABLE",
      userMessage: "The local core is unavailable. Try again.",
      httpStatus: 503,
      retryable: true,
      retryAfterMs: null,
      details: {},
    });
    expect(await useImportHistoryStore.getState().load()).toBe(false);
    expect(useImportHistoryStore.getState()).toMatchObject({
      status: "error",
      error: {
        code: "TRANSPORT_UNAVAILABLE",
        userMessage: "The local core is unavailable. Try again.",
        retryable: true,
      },
      result: PAGE,
    });
  });

  it("rolls back only through the registered command and updates persisted history state", async () => {
    useImportHistoryStore.setState({ companyId: COMPANY_ID, status: "populated", result: PAGE });
    useImportHistoryStore.getState().beginRollback(BATCH_ID);
    callMock.mockResolvedValueOnce({ rolled_back_to: PRIOR_BATCH_ID });

    expect(
      await useImportHistoryStore.getState().rollback(BATCH_ID, "Duplicate source import"),
    ).toBe(true);
    expect(callMock).toHaveBeenCalledWith("import.rollback", {
      batch_id: BATCH_ID,
      reason: "Duplicate source import",
    });
    expect(useImportHistoryStore.getState()).toMatchObject({
      rollbackStatus: "success",
      rollbackError: null,
      rollbackResult: { rolled_back_to: PRIOR_BATCH_ID },
      result: {
        rows: [
          {
            batch_id: BATCH_ID,
            status: "rolled_back",
            rollback_to_batch_id: PRIOR_BATCH_ID,
          },
        ],
      },
    });

    useImportHistoryStore.getState().clearRollback();
    expect(useImportHistoryStore.getState()).toMatchObject({
      rollbackStatus: "empty",
      rollbackBatchId: null,
      rollbackResult: null,
    });
  });

  it("surfaces rollback errors verbatim and ignores late cross-Company responses", async () => {
    useImportHistoryStore.setState({ companyId: COMPANY_ID, status: "populated", result: PAGE });
    useImportHistoryStore.getState().beginRollback(BATCH_ID);
    callMock.mockRejectedValueOnce({
      code: "BATCH_ALREADY_ROLLED_BACK",
      userMessage: "This batch was already rolled back.",
      httpStatus: 409,
      retryable: false,
      retryAfterMs: null,
      details: {},
    });
    expect(await useImportHistoryStore.getState().rollback(BATCH_ID, "Correction")).toBe(false);
    expect(useImportHistoryStore.getState()).toMatchObject({
      rollbackStatus: "error",
      rollbackError: {
        code: "BATCH_ALREADY_ROLLED_BACK",
        userMessage: "This batch was already rolled back.",
      },
    });

    useImportHistoryStore.getState().beginRollback(BATCH_ID);
    let resolveRollback: (value: { rolled_back_to: string }) => void = () => undefined;
    callMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRollback = resolve;
      }),
    );
    const pendingRollback = useImportHistoryStore.getState().rollback(BATCH_ID, "Late response");
    useImportHistoryStore.getState().scopeToCompany("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    resolveRollback({ rolled_back_to: PRIOR_BATCH_ID });
    expect(await pendingRollback).toBe(false);
    expect(useImportHistoryStore.getState()).toMatchObject({
      companyId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      rollbackStatus: "empty",
      rollbackResult: null,
    });

    useImportHistoryStore.getState().scopeToCompany(COMPANY_ID);
    useImportHistoryStore.setState({ status: "populated", result: PAGE });
    let resolveHistory: (value: typeof PAGE) => void = () => undefined;
    callMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHistory = resolve;
      }),
    );
    const pending = useImportHistoryStore.getState().load();
    useImportHistoryStore.getState().scopeToCompany("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    resolveHistory(PAGE);
    expect(await pending).toBe(false);
    expect(useImportHistoryStore.getState()).toMatchObject({
      companyId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      status: "empty",
      result: null,
      rollbackStatus: "empty",
    });
  });

  it("resets independently from the ephemeral parse pipeline", () => {
    useImportHistoryStore.setState({ companyId: COMPANY_ID, status: "populated", result: PAGE });
    useImportHistoryStore.getState().reset();
    expect(useImportHistoryStore.getState()).toMatchObject({
      companyId: null,
      status: "empty",
      result: null,
      rollbackStatus: "empty",
    });
  });
});
