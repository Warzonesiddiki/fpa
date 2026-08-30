import { beforeEach, describe, expect, it, vi } from "vitest";
import { isScreenState, useSessionStore } from "./session";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

const COMPANIES = [
  { id: COMPANY_ID, name: "Meridian Holdings", company_file_path: "/tmp/Meridian.fpa" },
];

function installLiveMocks() {
  callMock.mockImplementation((cmd: string) => {
    if (cmd === "company.list") return Promise.resolve(COMPANIES);
    if (cmd === "company.open")
      return Promise.resolve({
        company_id: COMPANY_ID,
        summary: { name: "Meridian Holdings", type: "group", default_currency_code: "USD" },
      });
    if (cmd === "session.unlock") return Promise.resolve({ company_id: COMPANY_ID });
    if (cmd === "session.status")
      return Promise.resolve({ unlocked: false, company_id: null, license: null });
    if (cmd === "session.lock") return Promise.resolve({ locked: true });
    return Promise.reject({ code: "INTERNAL", userMessage: "unexpected" });
  });
}

describe("session store — IPC state machine (B12)", () => {
  beforeEach(() => {
    callMock.mockReset();
    useSessionStore.setState({
      unlocked: false,
      companyId: null,
      companyName: null,
      readOnly: false,
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

  it("check() resolves the company name when a session company is set", async () => {
    installLiveMocks();
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "session.status")
        return Promise.resolve({ unlocked: true, company_id: COMPANY_ID, license: null });
      return Promise.resolve(COMPANIES);
    });
    await useSessionStore.getState().check();
    const s = useSessionStore.getState();
    expect(s.unlocked).toBe(true);
    expect(s.companyName).toBe("Meridian Holdings");
  });

  it("check() failure → error state with BridgeError", async () => {
    callMock.mockRejectedValue({ code: "INTERNAL", userMessage: "boom" });
    await useSessionStore.getState().check();
    const s = useSessionStore.getState();
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("INTERNAL");
  });

  it("unlock() success → populated + unlocked + resolved name", async () => {
    installLiveMocks();
    const ok = await useSessionStore.getState().unlock("1234", COMPANY_ID);
    const s = useSessionStore.getState();
    expect(ok).toBe(true);
    expect(s.unlocked).toBe(true);
    expect(s.companyId).toBe(COMPANY_ID);
    expect(s.companyName).toBe("Meridian Holdings");
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

  it("open() switches the active company via company.open (S-020)", async () => {
    installLiveMocks();
    const ok = await useSessionStore.getState().open("/tmp/Meridian.fpa");
    const s = useSessionStore.getState();
    expect(ok).toBe(true);
    expect(s.companyId).toBe(COMPANY_ID);
    expect(s.companyName).toBe("Meridian Holdings");
    expect(s.status).toBe("populated");
    expect(callMock).toHaveBeenCalledWith("company.open", { path: "/tmp/Meridian.fpa" });
  });

  it("open() failure keeps the session state and surfaces the error", async () => {
    callMock.mockRejectedValue({
      code: "STORAGE_FILE_CORRUPT",
      userMessage: "This Company file could not be verified.",
    });
    useSessionStore.setState({ unlocked: true, companyId: null, status: "success" });
    const ok = await useSessionStore.getState().open("/tmp/missing.fpa");
    const s = useSessionStore.getState();
    expect(ok).toBe(false);
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("STORAGE_FILE_CORRUPT");
    expect(s.companyId).toBeNull();
  });

  it("lock() → empty state and clears the company name", async () => {
    callMock.mockResolvedValue({ locked: true });
    useSessionStore.setState({
      unlocked: true,
      companyId: COMPANY_ID,
      companyName: "Meridian Holdings",
      readOnly: true,
      status: "populated",
    });
    await useSessionStore.getState().lock();
    const s = useSessionStore.getState();
    expect(s.unlocked).toBe(false);
    expect(s.companyId).toBeNull();
    expect(s.companyName).toBeNull();
    expect(s.readOnly).toBe(false);
    expect(s.status).toBe("empty");
  });

  it("unlock() with a broken audit chain sets readOnly (AUTH-SPEC §2.5)", async () => {
    installLiveMocks();
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "session.unlock")
        return Promise.resolve({
          company_id: COMPANY_ID,
          session_token: "dev-mock-session-token-0000000000000",
          read_only: true,
          integrity: { audit_chain_ok: false, broken_at_seq: 41 },
        });
      if (cmd === "company.list") return Promise.resolve(COMPANIES);
      return Promise.reject({ code: "INTERNAL", userMessage: "unexpected" });
    });
    const ok = await useSessionStore.getState().unlock("AuditBrk9!", COMPANY_ID);
    expect(ok).toBe(true);
    const s = useSessionStore.getState();
    expect(s.unlocked).toBe(true);
    expect(s.readOnly).toBe(true);
    // A chain-broken session never blocks the unlock — data stays readable, writes are gated
    // in the Rust core (read-only + restore offer, ADR-011).
    expect(s.status).toBe("populated");
  });

  it("unlock() with an intact chain leaves readOnly false", async () => {
    installLiveMocks();
    const ok = await useSessionStore.getState().unlock("Meridian#2026", COMPANY_ID);
    expect(ok).toBe(true);
    expect(useSessionStore.getState().readOnly).toBe(false);
  });

  it("check() mirrors the core's read_only session flag", async () => {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "session.status")
        return Promise.resolve({
          unlocked: true,
          company_id: COMPANY_ID,
          read_only: true,
          license: null,
        });
      return Promise.resolve(COMPANIES);
    });
    await useSessionStore.getState().check();
    const s = useSessionStore.getState();
    expect(s.unlocked).toBe(true);
    expect(s.readOnly).toBe(true);
  });

  it("open() with an integrity report of a broken chain sets readOnly", async () => {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "company.open")
        return Promise.resolve({
          company_id: COMPANY_ID,
          read_only: true,
          integrity: { audit_chain_ok: false, broken_at_seq: 7 },
          summary: { name: "Meridian Holdings" },
        });
      return Promise.resolve(COMPANIES);
    });
    const ok = await useSessionStore.getState().open("/tmp/Meridian.fpa");
    expect(ok).toBe(true);
    expect(useSessionStore.getState().readOnly).toBe(true);
  });

  it("rejects unknown screen states", () => {
    expect(isScreenState("loading")).toBe(true);
    expect(isScreenState("populated")).toBe(true);
    expect(isScreenState("loading2")).toBe(false);
    expect(isScreenState(42)).toBe(false);
    expect(isScreenState(null)).toBe(false);
  });
});
