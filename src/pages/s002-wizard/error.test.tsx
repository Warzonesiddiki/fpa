import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWizard } from "@/test/wizard-harness";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

describe("S-002 wizard — typed IPC error surface (B12)", () => {
  beforeEach(() => {
    callMock.mockReset();
    callMock.mockRejectedValue({
      code: "PACK_SCHEMA_INVALID",
      userMessage: "Unknown Industry Pack.",
      httpStatus: 422,
      retryable: false,
      retryAfterMs: null,
      details: {},
    });
  });

  it("surfaces a typed IPC error via role=alert", async () => {
    renderWizard();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Create Company" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown Industry Pack.");
  });
});
