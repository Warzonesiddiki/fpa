import { create } from "zustand";
import { call, toBridgeError, type BridgeError } from "@/api/bridge";
import {
  ImportParseData,
  type ImportKind,
  type ImportParseData as ImportParseResult,
} from "@/api/schema";
import type { ScreenState } from "@/components/ui/StatePanel";

interface ImportStoreState {
  /** S-030 state: empty → source selected (populated) → parsing (loading) → parsed (success). */
  status: ScreenState;
  error: BridgeError | null;
  companyId: string | null;
  kind: ImportKind;
  filePath: string;
  parsed: ImportParseResult | null;
  /** Monotonic request token: a source/company change invalidates a late parse response. */
  requestId: number;
  scopeToCompany: (companyId: string | null) => void;
  setKind: (kind: ImportKind) => void;
  selectFile: (filePath: string) => void;
  parse: () => Promise<boolean>;
  retry: () => Promise<boolean>;
  reportError: (cause: unknown) => void;
  reset: () => void;
}

function stateForPath(filePath: string): ScreenState {
  return filePath.trim() ? "populated" : "empty";
}

/**
 * S-030 import working set (STATE-MANAGEMENT §1/§2).
 *
 * Parse sessions are deliberately ephemeral and Company-scoped. The Rust core remains the source
 * of truth: it reads the selected path, computes SHA-256, detects workbook sheets/encoding, and
 * holds rows under `parse_id`. This store keeps only the typed hand-off required by S-031; it never
 * reads file bytes, performs money conversion, or claims a batch was committed.
 */
export const useImportStore = create<ImportStoreState>((set, get) => ({
  status: "empty",
  error: null,
  companyId: null,
  kind: "gl_dump",
  filePath: "",
  parsed: null,
  requestId: 0,

  scopeToCompany: (companyId) => {
    const current = get();
    if (current.companyId === companyId) return;
    set({
      companyId,
      status: "empty",
      error: null,
      filePath: "",
      parsed: null,
      requestId: current.requestId + 1,
    });
  },

  setKind: (kind) => {
    const current = get();
    if (current.kind === kind) return;
    set({
      kind,
      status: stateForPath(current.filePath),
      error: null,
      parsed: null,
      requestId: current.requestId + 1,
    });
  },

  selectFile: (filePath) => {
    const path = filePath.trim();
    const current = get();
    set({
      filePath: path,
      status: stateForPath(path),
      error: null,
      parsed: null,
      requestId: current.requestId + 1,
    });
  },

  parse: async () => {
    const current = get();
    if (!current.filePath.trim()) return false;

    const requestId = current.requestId + 1;
    set({ status: "loading", error: null, parsed: null, requestId });
    try {
      const response = await call("import.parse", {
        file_path: current.filePath,
        kind: current.kind,
      });
      const parsed = ImportParseData.parse(response);
      if (get().requestId !== requestId) return false;
      set({ status: "success", parsed, error: null });
      return true;
    } catch (cause) {
      if (get().requestId !== requestId) return false;
      set({ status: "error", error: toBridgeError(cause), parsed: null });
      return false;
    }
  },

  retry: async () => get().parse(),

  reportError: (cause) => {
    const current = get();
    const internalCause = new Error(
      cause instanceof Error ? cause.message : "Native file selection failed.",
    );
    set({
      status: "error",
      error: toBridgeError(internalCause),
      parsed: null,
      requestId: current.requestId + 1,
    });
  },

  reset: () => {
    const current = get();
    set({
      status: "empty",
      error: null,
      kind: "gl_dump",
      filePath: "",
      parsed: null,
      requestId: current.requestId + 1,
    });
  },
}));
