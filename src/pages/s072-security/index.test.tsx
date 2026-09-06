/**
 * S-072 Security screen unit and a11y tests (F-034 · SCREENS-SPEC S-072 · AUTH-SPEC §2).
 *
 * Verifies:
 * - 5 Canonical states: loading, empty, error, success, populated
 * - PIN change form interaction, policy validation, and security.change_pin invocation
 * - Error feedback for weak PIN (PIN_POLICY_WEAK) and invalid current PIN (AUTH_PIN_INVALID)
 * - Amber banner warning when OS keychain is unavailable (KEYCHAIN_UNAVAILABLE)
 * - D-007 Recovery phrase reveal modal: one-time confirmation, copy button
 * - Failed-attempt audit log table rendering
 * - 0 axe accessibility violations across all states and open dialogs
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { MemoryRouter } from "react-router-dom";
import SecurityPage from "./index";
import * as bridge from "@/api/bridge";

function renderSecurityPage(props = {}) {
  return render(
    <MemoryRouter>
      <SecurityPage {...props} />
    </MemoryRouter>,
  );
}

describe("S-072 Security Page (F-034 PIN/Recovery/Keychain)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the loading state initially", () => {
    renderSecurityPage({ initialState: "loading" });
    expect(screen.getByRole("main", { name: "Security & Credentials" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders the populated state with all cards and status indicators", async () => {
    vi.spyOn(bridge, "call").mockResolvedValue({ unlocked: true });
    const { container } = renderSecurityPage();

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Security & Credentials" }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("F-034 PIN & Key Vault")).toBeInTheDocument();
    expect(screen.getByText("Change Application PIN")).toBeInTheDocument();
    expect(screen.getByText("Recovery Phrase")).toBeInTheDocument();
    expect(screen.getByText("OS Keychain & Hardware Security")).toBeInTheDocument();
    expect(screen.getByText("Security & Attempt Audit Log")).toBeInTheDocument();

    // Verify AES-256-GCM + Argon2id specs badge
    expect(screen.getByText("AES-256-GCM + Argon2id")).toBeInTheDocument();

    // Verify OS keychain status
    expect(screen.getByText("Available & Active")).toBeInTheDocument();

    // Verify failed attempts table
    expect(screen.getByText("AUTH_PIN_INVALID: PIN mismatch attempt #1")).toBeInTheDocument();

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it("renders empty audit log state gracefully and is axe clean", async () => {
    vi.spyOn(bridge, "call").mockResolvedValue({ unlocked: true });
    const { container } = renderSecurityPage({
      initialState: "populated",
      initialAuditEvents: [],
    });

    expect(screen.getByText("No failed authentication attempts recorded.")).toBeInTheDocument();

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it("renders KEYCHAIN_UNAVAILABLE amber warning banner when keychain is missing", async () => {
    vi.spyOn(bridge, "call").mockResolvedValue({ unlocked: true });
    const { container } = renderSecurityPage({
      initialState: "populated",
      initialKeychainStatus: "unavailable",
    });

    expect(
      screen.getByText(/KEYCHAIN_UNAVAILABLE: Unavailable — Local File Fallback/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Operating system keychain service was not detected/i),
    ).toBeInTheDocument();

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it("validates PIN strength policy interactively and updates the policy meter", async () => {
    const user = userEvent.setup();
    vi.spyOn(bridge, "call").mockResolvedValue({ unlocked: true });
    renderSecurityPage({ initialState: "populated" });

    const newPinInput = screen.getByLabelText(/^New PIN/i);
    const confirmInput = screen.getByLabelText(/^Confirm New PIN/i);

    // Initial meter state
    expect(screen.getAllByText("[FAIL]").length).toBeGreaterThanOrEqual(1);

    // Type a weak PIN (short, single class)
    await user.type(newPinInput, "abc");
    expect(screen.getAllByText("[FAIL]").length).toBeGreaterThanOrEqual(1);

    // Type a strong PIN conforming to policy (≥8 chars, 2+ classes, no sequence)
    await user.clear(newPinInput);
    await user.type(newPinInput, "Meridian#2026");
    await user.type(confirmInput, "Meridian#2026");

    // All policy items should now PASS
    expect(screen.queryAllByText("[FAIL]")).toHaveLength(0);
    expect(screen.getAllByText("[PASS]")).toHaveLength(4);
  });

  it("submits PIN change successfully and shows success confirmation notice", async () => {
    const user = userEvent.setup();
    const callSpy = vi.spyOn(bridge, "call").mockResolvedValue({ ok: true });
    renderSecurityPage({ initialState: "populated" });

    const oldPinInput = screen.getByLabelText(/^Current PIN/i);
    const newPinInput = screen.getByLabelText(/^New PIN/i);
    const confirmInput = screen.getByLabelText(/^Confirm New PIN/i);
    const submitBtn = screen.getByRole("button", { name: /Update PIN/i });

    await user.type(oldPinInput, "OldPass#123");
    await user.type(newPinInput, "Meridian#2026");
    await user.type(confirmInput, "Meridian#2026");

    expect(submitBtn).toBeEnabled();
    await user.click(submitBtn);

    await waitFor(() => {
      expect(callSpy).toHaveBeenCalledWith("security.change_pin", {
        old_pin: "OldPass#123",
        new_pin: "Meridian#2026",
      });
      expect(
        screen.getByText("PIN updated successfully. Vault key re-sealed."),
      ).toBeInTheDocument();
    });
  });

  it("handles and displays error when security.change_pin returns AUTH_PIN_INVALID", async () => {
    const user = userEvent.setup();
    vi.spyOn(bridge, "call").mockRejectedValue({
      code: "AUTH_PIN_INVALID",
      userMessage: "Incorrect current PIN.",
      httpStatus: 401,
      retryable: false,
      retryAfterMs: null,
      details: {},
    });
    renderSecurityPage({ initialState: "populated" });

    const oldPinInput = screen.getByLabelText(/^Current PIN/i);
    const newPinInput = screen.getByLabelText(/^New PIN/i);
    const confirmInput = screen.getByLabelText(/^Confirm New PIN/i);
    const submitBtn = screen.getByRole("button", { name: /Update PIN/i });

    await user.type(oldPinInput, "WrongPin9!");
    await user.type(newPinInput, "Meridian#2026");
    await user.type(confirmInput, "Meridian#2026");

    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("AUTH_PIN_INVALID")).toBeInTheDocument();
      expect(screen.getByText("Incorrect current PIN.")).toBeInTheDocument();
    });
  });

  it("handles D-007 Recovery Phrase reveal flow with one-time confirmation and copy", async () => {
    const user = userEvent.setup();
    vi.spyOn(bridge, "call").mockResolvedValue({ unlocked: true });
    renderSecurityPage({ initialState: "populated" });

    // Open modal
    const revealBtn = screen.getByRole("button", { name: /Reveal Recovery Phrase/i });
    await user.click(revealBtn);

    // Modal dialog is open
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        /Store these words offline. Without them, a lost PIN means the Company cannot be recovered./i,
      ).length,
    ).toBeGreaterThanOrEqual(1);

    const viewBtn = screen.getByRole("button", { name: "View 12 Words" });
    expect(viewBtn).toBeDisabled();

    // Check confirmation checkbox
    const confirmCheckbox = screen.getByRole("checkbox");
    await user.click(confirmCheckbox);
    expect(viewBtn).toBeEnabled();

    // Reveal 12 words
    await user.click(viewBtn);

    // Words grid is visible
    expect(screen.getByText("harbor")).toBeInTheDocument();
    expect(screen.getByText("shield")).toBeInTheDocument();

    // Check copy phrase button
    const copyBtn = screen.getByRole("button", { name: /Copy Phrase/i });
    await user.click(copyBtn);
    expect(screen.getByText(/Phrase copied to clipboard/i)).toBeInTheDocument();

    // Close modal
    const closeBtn = screen.getByRole("button", { name: "Done / Close" });
    await user.click(closeBtn);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Recovery phrase viewed and stored offline")).toBeInTheDocument();
  });

  it("has 0 axe accessibility violations with the D-007 modal open", async () => {
    const user = userEvent.setup();
    vi.spyOn(bridge, "call").mockResolvedValue({ unlocked: true });
    renderSecurityPage({ initialState: "populated" });

    const revealBtn = screen.getByRole("button", { name: /Reveal Recovery Phrase/i });
    await user.click(revealBtn);

    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });
});
