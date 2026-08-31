import { create } from "zustand";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";

export type ScreenState = "loading" | "empty" | "error" | "success" | "populated";

interface SessionState {
  unlocked: boolean;
  companyId: string | null;
  /** Active model for the opened Company; native bootstrap returns one for new files. */
  modelId: string | null;
  companyName: string | null;
  /** AUTH-SPEC §2.5: set when unlock-time audit-chain verification failed — the Company is
   * read-only and the shell shows the restore offer (AUDIT_CHAIN_BREAK, never dismissible). */
  readOnly: boolean;
  status: ScreenState;
  error: BridgeError | null;
  checking: boolean;
  check: () => Promise<void>;
  unlock: (pin: string, companyId: string) => Promise<boolean>;
  open: (path: string) => Promise<boolean>;
  lock: () => Promise<void>;
}

function setError(error: BridgeError): Partial<SessionState> {
  return { status: "error", error };
}

/** Best-effort company name for the shell top bar (non-fatal when the lookup fails). */
async function resolveCompanyName(companyId: string): Promise<string | null> {
  try {
    const data = (await call("company.list", {})) as { id: string; name: string }[];
    return data.find((c) => c.id === companyId)?.name ?? null;
  } catch {
    return null;
  }
}

export const useSessionStore = create<SessionState>((set) => ({
  unlocked: false,
  companyId: null,
  modelId: null,
  companyName: null,
  readOnly: false,
  status: "loading",
  error: null,
  checking: false,

  check: async () => {
    set({ checking: true, status: "loading", error: null });
    try {
      const data = (await call("session.status", {})) as {
        unlocked: boolean;
        company_id: string | null;
        read_only?: boolean;
        model_id?: string | null;
      };
      const companyName = data.company_id ? await resolveCompanyName(data.company_id) : null;
      set({
        unlocked: data.unlocked,
        companyId: data.company_id,
        modelId: data.model_id === undefined ? useSessionStore.getState().modelId : data.model_id,
        companyName,
        readOnly: data.read_only === true,
        status: "success",
        checking: false,
      });
    } catch (err) {
      set({ status: "error", error: err as BridgeError, checking: false });
    }
  },

  unlock: async (pin, companyId) => {
    try {
      const data = (await call("session.unlock", { pin, company_id: companyId })) as {
        company_id: string;
        model_id?: string | null;
        read_only?: boolean;
        integrity?: { audit_chain_ok: boolean; broken_at_seq: number | null };
      };
      const companyName = await resolveCompanyName(data.company_id);
      set({
        unlocked: true,
        companyId: data.company_id,
        modelId: data.model_id ?? null,
        companyName,
        // Read-only when the core says so, or when the §2.5 integrity report flags a break.
        readOnly: data.read_only === true || data.integrity?.audit_chain_ok === false,
        status: "populated",
        error: null,
      });
      return true;
    } catch (err) {
      set(setError(err as BridgeError));
      return false;
    }
  },

  open: async (path) => {
    try {
      const data = (await call("company.open", { path })) as {
        company_id: string;
        model_id?: string | null;
        read_only?: boolean;
        integrity?: { audit_chain_ok: boolean; broken_at_seq: number | null };
        summary: { name: string };
      };
      set({
        unlocked: true,
        companyId: data.company_id,
        modelId: data.model_id ?? null,
        companyName: data.summary.name,
        readOnly: data.read_only === true || data.integrity?.audit_chain_ok === false,
        status: "populated",
        error: null,
      });
      return true;
    } catch (err) {
      set(setError(err as BridgeError));
      return false;
    }
  },

  lock: async () => {
    await call("session.lock", {});
    set({
      unlocked: false,
      companyId: null,
      modelId: null,
      companyName: null,
      readOnly: false,
      status: "empty",
      error: null,
    });
  },
}));

export function isScreenState(value: unknown): value is ScreenState {
  return ["loading", "empty", "error", "success", "populated"].includes(String(value));
}
