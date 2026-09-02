import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, toBridgeError } from "./bridge";
import { CommandArgs } from "./schema";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

describe("IPC bridge — Zod gate at the boundary (B12)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("rejects invalid args before invoking with the command's locked error surface", async () => {
    await expect(call("company.create", { name: "A" } as never)).rejects.toMatchObject({
      code: "VALUE_INVALID",
      httpStatus: 422,
    });
    await expect(call("import.map.save_v1", { template: {} } as never)).rejects.toMatchObject({
      code: "MAP_TARGET_INVALID",
      userMessage: "This column cannot map to that field. Choose a supported target.",
      httpStatus: 422,
      retryable: false,
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("command registry is exhaustive (name → schema)", () => {
    expect(Object.keys(CommandArgs).length).toBeGreaterThanOrEqual(6);
    expect(
      CommandArgs["session.unlock"].parse({
        pin: "Meridian2026",
        company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      }),
    ).toBeTruthy();
    expect(
      CommandArgs["security.pin_setup"].parse({
        pin: "Meridian#2026",
        confirm: "Meridian#2026",
      }),
    ).toBeTruthy();
  });

  it("unwraps a Tauri invoke response (native shell = production path)", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    invokeMock.mockResolvedValue({ data: { locked: true } });
    const out = await call("session.lock", {});
    expect(out).toEqual({ locked: true });
    expect(invokeMock).toHaveBeenCalledWith("session.lock", {});
  });

  it("throws BridgeError on an error envelope from the native shell", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    invokeMock.mockResolvedValue({
      error: {
        code: "AUTH_LOCKED",
        message: "too many",
        userMessage: "Try again later.",
        httpStatus: 423,
        retryable: false,
        retryAfterMs: 30000,
        details: {},
      },
    });
    await expect(call("session.lock", {})).rejects.toMatchObject({
      code: "AUTH_LOCKED",
      retryAfterMs: 30000,
    });
  });

  it("passes a bare (non-envelope) Tauri response through", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    invokeMock.mockResolvedValue({ locked: true });
    await expect(call("session.lock", {})).resolves.toEqual({ locked: true });
  });
});

describe("toBridgeError — defensive error shape (B12)", () => {
  it("normalizes non-object rejections to INTERNAL with raw details", () => {
    const err = toBridgeError("kaboom");
    expect(err.code).toBe("INTERNAL");
    expect(err.httpStatus).toBe(500);
    expect(err.details.raw).toBe("kaboom");
  });

  it("defaults missing fields for partial error objects", () => {
    const err = toBridgeError({ code: "X" });
    expect(err.httpStatus).toBe(500);
    expect(err.retryable).toBe(false);
    expect(err.retryAfterMs).toBeNull();
    expect(err.details).toEqual({});
  });

  it("normalizes null/undefined rejections to INTERNAL", () => {
    expect(toBridgeError(null).code).toBe("INTERNAL");
    expect(toBridgeError(undefined).code).toBe("INTERNAL");
  });
});
