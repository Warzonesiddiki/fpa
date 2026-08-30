import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WizardPage } from "./index";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

describe("S-002 First-Run Wizard (F-004)", () => {
  beforeEach(() => callMock.mockReset());

  it("walks all five steps with Back enabled from step 2", () => {
    render(<WizardPage />);
    // Step 1: company name gate
    const next = screen.getByRole("button", { name: "Next" });
    expect(next).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    expect(next).toBeEnabled();
    fireEvent.click(next);

    // Step 2: pack choice (default saas)
    expect(screen.getByRole("heading", { name: "Industry Pack" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 3: calendar, switch to 4-5-4
    expect(screen.getByRole("heading", { name: "Fiscal Calendar" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retail 4-5-4 (NRF)"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 4: COA review
    expect(screen.getByRole("heading", { name: "Chart of Accounts" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 5: model configuration with Back re-enabled
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Create Company" })).toBeInTheDocument();
  });

  it("creates a company and shows the success state", async () => {
    callMock.mockResolvedValue({ company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001" });
    render(<WizardPage />);
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Create Company" }));
    expect(await screen.findByText("Acme created")).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledWith(
      "company.create",
      expect.objectContaining({ name: "Acme", pack_key: "saas", horizon: "1y" }),
    );
  });
});
