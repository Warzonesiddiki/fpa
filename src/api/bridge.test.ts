import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, registerEngineCommand, toBridgeError, unregisterEngineCommand } from "./bridge";
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

  it("normalizes an error whose code is explicitly undefined", () => {
    const err = toBridgeError({ code: undefined });
    expect(err.code).toBe("INTERNAL");
    // ERROR-HANDLING §169 verbatim user-facing copy for INTERNAL.
    expect(err.userMessage).toBe(
      "Something went wrong. Diagnostics were captured — retry or export Local Diagnostics.",
    );
  });
});

describe("engine-command routing (ADR-029 · model.inspect is engine-owned)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("routes a registered command to the in-process handler, bypassing IPC", async () => {
    const handler = vi.fn(async () => ({
      line_id: "3f9f2c9e-9f8b-4e2d-9a1c-700000000001",
      period_id: "fp-2026-p01",
      formula: "=B2*C2",
      computed_text: "1200",
      error_code: null,
      precedents: [],
      dependents: [],
      cycle: null,
      is_cycle: false,
    }));
    registerEngineCommand("model.inspect", handler);
    try {
      const data = (await call("model.inspect", {
        line_id: "3f9f2c9e-9f8b-4e2d-9a1c-700000000001",
        period_id: "fp-2026-p01",
      })) as Record<string, unknown>;
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        line_id: "3f9f2c9e-9f8b-4e2d-9a1c-700000000001",
        period_id: "fp-2026-p01",
      });
      expect(invokeMock).not.toHaveBeenCalled();
      expect(data.formula).toBe("=B2*C2");
    } finally {
      unregisterEngineCommand("model.inspect");
    }
  });

  it("still enforces the Zod arg gate before the engine handler", async () => {
    const handler = vi.fn(async () => ({}));
    registerEngineCommand("model.inspect", handler);
    try {
      await expect(
        call("model.inspect", { line_id: "not-a-uuid", period_id: "fp-2026-p01" } as never),
      ).rejects.toMatchObject({ code: "VALUE_INVALID", httpStatus: 422 });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      unregisterEngineCommand("model.inspect");
    }
  });

  it("converts a thrown engine error into the BridgeError surface", async () => {
    registerEngineCommand("model.inspect", async () => {
      throw { code: "FORMULA_CYCLE", userMessage: "cycle", httpStatus: 422 };
    });
    try {
      await expect(
        call("model.inspect", {
          line_id: "3f9f2c9e-9f8b-4e2d-9a1c-700000000001",
          period_id: "fp-2026-p01",
        }),
      ).rejects.toMatchObject({ code: "FORMULA_CYCLE", httpStatus: 422, retryable: false });
    } finally {
      unregisterEngineCommand("model.inspect");
    }
  });

  it("falls back to IPC/mock once the handler is unregistered", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true } });
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    unregisterEngineCommand("model.inspect");
    const data = await call("model.inspect", {
      line_id: "3f9f2c9e-9f8b-4e2d-9a1c-700000000001",
      period_id: "fp-2026-p01",
    });
    expect(invokeMock).toHaveBeenCalledWith("model.inspect", {
      line_id: "3f9f2c9e-9f8b-4e2d-9a1c-700000000001",
      period_id: "fp-2026-p01",
    });
    expect(data).toEqual({ ok: true });
  });
});
