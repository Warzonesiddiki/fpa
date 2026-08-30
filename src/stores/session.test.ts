import { beforeEach, describe, expect, it, vi } from "vitest";
import { isScreenState, useSessionStore } from "./session";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

describe("session store — IPC state machine (B12)", () => {
  beforeEach(() => {
    callMock.mockReset();
    useSessionStore.setState({
      unlocked: false,
      companyId: null,
      status: "loading",
      error: null,
      checking: false,
    });
  });

  it("check() success → success state", async () => {
    callMock.mockResolvedValue({ unlocked: false, company_id: null });
    await useSessionStore.getState().check();
    const s = useSessionStore.getState();
    expect(s.status).toBe("success");
    expect(s.unlocked).toBe(false);
    expect(s.checking).toBe(false);
  });

  it("check() failure → error state with BridgeError", async () => {
    callMock.mockRejectedValue({ code: "INTERNAL", userMessage: "boom" });
    await useSessionStore.getState().check();
    const s = useSessionStore.getState();
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("INTERNAL");
  });

  it("unlock() success → populated + unlocked", async () => {
    callMock.mockResolvedValue({ company_id: COMPANY_ID });
    const ok = await useSessionStore.getState().unlock("1234", COMPANY_ID);
    const s = useSessionStore.getState();
    expect(ok).toBe(true);
    expect(s.unlocked).toBe(true);
    expect(s.companyId).toBe(COMPANY_ID);
    expect(s.status).toBe("populated");
    expect(callMock).toHaveBeenCalledWith("session.unlock", {
      pin: "1234",
      company_id: COMPANY_ID,
    });
  });

  it("unlock() failure → error state, still locked", async () => {
    callMock.mockRejectedValue({ code: "AUTH_PIN_INVALID", userMessage: "Incorrect PIN." });
    const ok = await useSessionStore.getState().unlock("wrong", COMPANY_ID);
    expect(ok).toBe(false);
    expect(useSessionStore.getState().unlocked).toBe(false);
    expect(useSessionStore.getState().status).toBe("error");
  });

  it("lock() → empty state", async () => {
    callMock.mockResolvedValue({ locked: true });
    await useSessionStore.getState().lock();
    const s = useSessionStore.getState();
    expect(s.unlocked).toBe(false);
    expect(s.companyId).toBeNull();
    expect(s.status).toBe("empty");
  });

  it("rejects unknown screen states", () => {
    expect(isScreenState("loading")).toBe(true);
    expect(isScreenState("populated")).toBe(true);
    expect(isScreenState("loading2")).toBe(false);
    expect(isScreenState(42)).toBe(false);
    expect(isScreenState(null)).toBe(false);
  });
});
