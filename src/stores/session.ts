import { create } from "zustand";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";

export type ScreenState = "loading" | "empty" | "error" | "success" | "populated";

interface SessionState {
  unlocked: boolean;
  companyId: string | null;
  status: ScreenState;
  error: BridgeError | null;
  checking: boolean;
  check: () => Promise<void>;
  unlock: (pin: string, companyId: string) => Promise<boolean>;
  lock: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set) => ({
  unlocked: false,
  companyId: null,
  status: "loading",
  error: null,
  checking: false,

  check: async () => {
    set({ checking: true, status: "loading", error: null });
    try {
      const data = (await call("session.status", {})) as {
        unlocked: boolean;
        company_id: string | null;
      };
      set({
        unlocked: data.unlocked,
        companyId: data.company_id,
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
      };
      set({ unlocked: true, companyId: data.company_id, status: "populated", error: null });
      return true;
    } catch (err) {
      set({ status: "error", error: err as BridgeError });
      return false;
    }
  },

  lock: async () => {
    await call("session.lock", {});
    set({ unlocked: false, companyId: null, status: "empty", error: null });
  },
}));

export function isScreenState(value: unknown): value is ScreenState {
  return ["loading", "empty", "error", "success", "populated"].includes(String(value));
}
