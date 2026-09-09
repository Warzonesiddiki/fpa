import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { useSessionStore } from "@/stores/session";
import { call } from "@/api/bridge";

/**
 * App-level flow through the real mock bridge (dev preview semantics):
 * S-001 unlock → wrong PIN error → policy-valid PIN → S-004 shell + S-010 dashboard.
 * This is the P0 acceptance path without the native shell (CI runs the Tauri e2e too).
 */
describe("App — Unlock → Shell → Dashboard flow (P0)", () => {
  beforeEach(async () => {
    try {
      await call("session.lock", {});
    } catch {
      // ignore in environments where bridge lock might fail
    }
    useSessionStore.setState({
      unlocked: false,
      companyId: null,
      modelId: null,
      companyName: null,
      readOnly: false,
      status: "loading",
      error: null,
      checking: false,
    });
  });

  it("renders populated unlock list and rejects a wrong PIN", async () => {
    render(<App />);
    expect(await screen.findByText("Enter your PIN to open your Company")).toBeInTheDocument();
    expect(await screen.findByText("Meridian Holdings (Demo)")).toBeInTheDocument();

    const pin = screen.getByLabelText("PIN");
    await userEvent.type(pin, "WrongPin9!");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

    // mock AUTH_PIN_INVALID (120ms simulated latency); copy per ERROR-HANDLING §A
    await waitFor(async () => {
      expect(await screen.findByText("Incorrect PIN.")).toBeInTheDocument();
    });
    expect(pin).toHaveValue("");
  });

  it("unlocks with the demo PIN and lands on the dashboard", async () => {
    render(<App />);
    await screen.findByText("Meridian Holdings (Demo)");
    await userEvent.type(screen.getByLabelText("PIN"), "Meridian2026");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("FY2026 · P08")).toBeInTheDocument();
  }, 15_000);
});
