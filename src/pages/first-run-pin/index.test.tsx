import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { FirstRunPinPage } from "./index";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/welcome"]}>
      <Routes>
        <Route path="/welcome" element={<FirstRunPinPage />} />
        <Route path="/wizard" element={<div>wizard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** First-run PIN registration (F-004): policy gate → security.pin_setup → wizard. */
describe("first-run PIN setup (F-004)", () => {
  beforeEach(() => callMock.mockReset());

  it("renders the empty state, enforces the policy and shows live hints", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Set your PIN" })).toBeInTheDocument();
    expect(
      screen.getByText("No PIN is set yet. Create one to protect your data."),
    ).toBeInTheDocument();

    // Live policy hints (AUTH-SPEC §2.1)
    expect(screen.getByText("At least 8 characters")).toBeInTheDocument();
    expect(screen.getByText("Two or more character classes")).toBeInTheDocument();
    expect(screen.getByText("No sequences like 1234 or abcd")).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: "Set PIN" });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText("PIN"), "1234");
    expect(submit).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("PIN"));
    await userEvent.type(screen.getByLabelText("PIN"), "Meridian#2026");
    // Policy met but the confirmation is still missing → stays gated
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Confirm PIN"), "Meridian#2026");
    expect(submit).toBeEnabled();
  });

  it("blocks submission on confirm mismatch and supports show/hide (a11y)", async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText("PIN"), "Meridian#2026");
    await userEvent.type(screen.getByLabelText("Confirm PIN"), "Different9!");

    expect(screen.getByText("PINs do not match.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set PIN" })).toBeDisabled();

    // Show/hide toggle flips input type and aria-pressed (aria-label is the stable name)
    const toggle = screen.getByRole("button", { name: "Show or hide PIN" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Show")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.getByLabelText("PIN")).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Hide")).toBeInTheDocument();
  });

  it("submits security.pin_setup and continues to the wizard on success", async () => {
    callMock.mockResolvedValue({ ok: true });
    renderPage();

    await userEvent.type(screen.getByLabelText("PIN"), "Meridian#2026");
    await userEvent.type(screen.getByLabelText("Confirm PIN"), "Meridian#2026");
    await userEvent.click(screen.getByRole("button", { name: "Set PIN" }));

    expect(
      await screen.findByText("PIN set — you're ready to create your first Company."),
    ).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledWith("security.pin_setup", {
      pin: "Meridian#2026",
      confirm: "Meridian#2026",
    });

    await userEvent.click(screen.getByRole("button", { name: "Continue to Company setup" }));
    expect(await screen.findByText("wizard")).toBeInTheDocument();
  });

  it("shows the loading state while the setup call is in flight", async () => {
    let resolve!: (v: unknown) => void;
    callMock.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage();

    await userEvent.type(screen.getByLabelText("PIN"), "Meridian#2026");
    await userEvent.type(screen.getByLabelText("Confirm PIN"), "Meridian#2026");
    await userEvent.click(screen.getByRole("button", { name: "Set PIN" }));

    // Loading is announced by the status panel and mirrored on the submit button
    expect(await screen.findByRole("status")).toHaveTextContent("Setting your PIN…");
    expect(screen.getByRole("button", { name: "Setting your PIN…" })).toBeDisabled();

    resolve({ ok: true });
    await waitFor(() =>
      expect(
        screen.getByText("PIN set — you're ready to create your first Company."),
      ).toBeInTheDocument(),
    );
  });
});
