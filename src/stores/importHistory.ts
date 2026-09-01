import { create } from "zustand";
import { call, toBridgeError, type BridgeError } from "@/api/bridge";
import { ImportHistoryData, ImportRollbackData } from "@/api/schema";
import type { ImportHistoryResult, ImportRollbackResult } from "@/api/schema";

export type ImportHistoryStatus = "empty" | "loading" | "populated" | "error";
export type ImportRollbackStatus = "empty" | "loading" | "success" | "error";

interface ImportHistoryStoreState {
  companyId: string | null;
  status: ImportHistoryStatus;
  error: BridgeError | null;
  result: ImportHistoryResult | null;
  requestId: number;
  rollbackStatus: ImportRollbackStatus;
  rollbackError: BridgeError | null;
  rollbackResult: ImportRollbackResult | null;
  rollbackBatchId: string | null;
  rollbackRequestId: number;
  scopeToCompany: (companyId: string | null) => void;
  load: (page?: number) => Promise<boolean>;
  beginRollback: (batchId: string) => void;
  rollback: (batchId: string, reason: string) => Promise<boolean>;
  clearRollback: () => void;
  reset: () => void;
}

export const useImportHistoryStore = create<ImportHistoryStoreState>((set, get) => ({
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

  scopeToCompany: (companyId) => {
    const current = get();
    if (current.companyId === companyId) return;
    set({
      companyId,
      status: "empty",
      error: null,
      result: null,
      requestId: current.requestId + 1,
      rollbackStatus: "empty",
      rollbackError: null,
      rollbackResult: null,
      rollbackBatchId: null,
      rollbackRequestId: current.rollbackRequestId + 1,
    });
  },

  load: async (page = 1) => {
    const current = get();
    if (!current.companyId || current.status === "loading") return false;
    const companyId = current.companyId;
    const requestId = current.requestId + 1;
    set({
      status: "loading",
      error: null,
      requestId,
      rollbackStatus: "empty",
      rollbackError: null,
      rollbackResult: null,
      rollbackBatchId: null,
      rollbackRequestId: current.rollbackRequestId + 1,
    });
    try {
      const response = await call("import.history", { company_id: companyId, page });
      const result = ImportHistoryData.parse(response);
      if (result.meta.page !== page) {
        throw new Error("import.history returned a different page than requested.");
      }
      const latest = get();
      if (latest.companyId !== companyId || latest.requestId !== requestId) return false;
      set({
        status: result.rows.length === 0 ? "empty" : "populated",
        error: null,
        result,
      });
      return true;
    } catch (cause) {
      const latest = get();
      if (latest.companyId !== companyId || latest.requestId !== requestId) return false;
      set({ status: "error", error: toBridgeError(cause) });
      return false;
    }
  },

  beginRollback: (batchId) => {
    const current = get();
    set({
      rollbackStatus: "empty",
      rollbackError: null,
      rollbackResult: null,
      rollbackBatchId: batchId,
      rollbackRequestId: current.rollbackRequestId + 1,
    });
  },

  rollback: async (batchId, reason) => {
    const current = get();
    if (!current.companyId || current.rollbackStatus === "loading") return false;
    const companyId = current.companyId;
    const requestId = current.requestId;
    const rollbackRequestId = current.rollbackRequestId + 1;
    set({
      rollbackStatus: "loading",
      rollbackError: null,
      rollbackResult: null,
      rollbackBatchId: batchId,
      rollbackRequestId,
    });
    try {
      const response = await call("import.rollback", { batch_id: batchId, reason });
      const result = ImportRollbackData.parse(response);
      const latest = get();
      if (
        latest.companyId !== companyId ||
        latest.requestId !== requestId ||
        latest.rollbackRequestId !== rollbackRequestId ||
        latest.rollbackBatchId !== batchId
      ) {
        return false;
      }
      const history = latest.result
        ? {
            ...latest.result,
            rows: latest.result.rows.map((batch) =>
              batch.batch_id === batchId
                ? {
                    ...batch,
                    status: "rolled_back" as const,
                    rollback_to_batch_id: result.rolled_back_to,
                  }
                : batch,
            ),
          }
        : null;
      set({
        rollbackStatus: "success",
        rollbackError: null,
        rollbackResult: result,
        result: history,
      });
      return true;
    } catch (cause) {
      const latest = get();
      if (
        latest.companyId !== companyId ||
        latest.requestId !== requestId ||
        latest.rollbackRequestId !== rollbackRequestId ||
        latest.rollbackBatchId !== batchId
      ) {
        return false;
      }
      set({
        rollbackStatus: "error",
        rollbackError: toBridgeError(cause),
        rollbackResult: null,
      });
      return false;
    }
  },

  clearRollback: () => {
    const current = get();
    set({
      rollbackStatus: "empty",
      rollbackError: null,
      rollbackResult: null,
      rollbackBatchId: null,
      rollbackRequestId: current.rollbackRequestId + 1,
    });
  },

  reset: () => {
    const current = get();
    set({
      companyId: null,
      status: "empty",
      error: null,
      result: null,
      requestId: current.requestId + 1,
      rollbackStatus: "empty",
      rollbackError: null,
      rollbackResult: null,
      rollbackBatchId: null,
      rollbackRequestId: current.rollbackRequestId + 1,
    });
  },
}));
