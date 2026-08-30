import { render, screen } from "@testing-library/react";
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

async function fillValidPin() {
  await userEvent.type(screen.getByLabelText("PIN"), "Meridian#2026");
  await userEvent.type(screen.getByLabelText("Confirm PIN"), "Meridian#2026");
}

/** Error-path tests in a separate file (Vitest async-rejection quirk, playbook §4.6). */
describe("first-run PIN setup — error states", () => {
  beforeEach(() => callMock.mockReset());

  it("surfaces PIN_POLICY_WEAK as an inline banner and keeps the form editable", async () => {
    callMock.mockRejectedValueOnce({
      code: "PIN_POLICY_WEAK",
      userMessage: "PIN must be ≥8 characters with letters and digits.",
      httpStatus: 422,
      retryable: false,
      retryAfterMs: null,
      details: {},
    });
    renderPage();
    await fillValidPin();
    await userEvent.click(screen.getByRole("button", { name: "Set PIN" }));

    expect(
      await screen.findByText("PIN must be ≥8 characters with letters and digits."),
    ).toBeInTheDocument();
    expect(screen.getByText("PIN_POLICY_WEAK")).toBeInTheDocument();

    // Form stays usable; a retry succeeds after the policy issue is resolved
    callMock.mockResolvedValue({ ok: true });
    await userEvent.click(screen.getByRole("button", { name: "Set PIN" }));
    expect(
      await screen.findByText("PIN set — you're ready to create your first Company."),
    ).toBeInTheDocument();
  });

  it("handles a second-call PIN_ALREADY_SET (VALUE_INVALID) without a crash", async () => {
    callMock.mockRejectedValueOnce({
      code: "VALUE_INVALID",
      userMessage: "Invalid arguments.",
      httpStatus: 422,
      retryable: false,
      retryAfterMs: null,
      details: {},
    });
    renderPage();
    await fillValidPin();
    await userEvent.click(screen.getByRole("button", { name: "Set PIN" }));

    expect(await screen.findByText("Invalid arguments.")).toBeInTheDocument();
    expect(screen.getByText("VALUE_INVALID")).toBeInTheDocument();
    expect(screen.getByLabelText("PIN")).toHaveValue("Meridian#2026");
  });
});
