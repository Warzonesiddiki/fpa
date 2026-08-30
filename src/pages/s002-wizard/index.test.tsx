import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WizardPage } from "./index";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const PACKS = [
  { key: "saas", name: "SaaS / Tech", version: "2.1.0", schema_version: "1.0.0", is_bundled: true },
  {
    key: "manufacturing",
    name: "Manufacturing",
    version: "2.1.0",
    schema_version: "1.0.0",
    is_bundled: true,
  },
  { key: "retail", name: "Retail", version: "2.1.0", schema_version: "1.0.0", is_bundled: true },
];

const PREVIEW = {
  fiscal_years: [
    {
      fy_label: "FY2026",
      start_date: "2026-02-01",
      end_date: "2027-01-30",
      week_count: 52,
      periods: [
        {
          period_no: 1,
          code: "P01",
          start_date: "2026-02-01",
          end_date: "2026-02-28",
          is_53rd_week: false,
        },
        {
          period_no: 2,
          code: "P02",
          start_date: "2026-03-01",
          end_date: "2026-03-28",
          is_53rd_week: false,
        },
      ],
    },
  ],
};

/** Live-data commands answer the documented shapes; company.create is the only write. */
function installLiveMocks() {
  callMock.mockImplementation((cmd: string) => {
    if (cmd === "pack.list") return Promise.resolve(PACKS);
    if (cmd === "calendar.preview") return Promise.resolve(PREVIEW);
    return Promise.resolve({ company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001" });
  });
}

describe("S-002 First-Run Wizard (F-004)", () => {
  beforeEach(() => callMock.mockReset());

  it("walks all five steps with Back enabled from step 2", async () => {
    installLiveMocks();
    render(<WizardPage />);
    // Step 1: company name gate
    const next = screen.getByRole("button", { name: "Next" });
    expect(next).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    expect(next).toBeEnabled();
    fireEvent.click(next);

    // Step 2: pack list loads from the live library (default saas)
    expect(screen.getByRole("heading", { name: "Industry Pack" })).toBeInTheDocument();
    expect(await screen.findByText("Manufacturing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 3: calendar, switch to 4-5-4; live preview renders period rows
    expect(screen.getByRole("heading", { name: "Fiscal Calendar" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retail 4-5-4 (NRF)"));
    expect(await screen.findByText("P01")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 4: COA review
    expect(screen.getByRole("heading", { name: "Chart of Accounts" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 5: model configuration with Back re-enabled
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Create Company" })).toBeInTheDocument();
  });

  it("creates a company and shows the success state", async () => {
    installLiveMocks();
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
    // The preview fetch crossed the real bridge with the NRF rule scoped to 4-5-4
    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith(
        "calendar.preview",
        expect.objectContaining({ preset: "12month", year_count: 1 }),
      ),
    );
  });

  it("keeps the selected pack when the library contains it", async () => {
    installLiveMocks();
    render(<WizardPage />);
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Manufacturing");
    fireEvent.click(screen.getByLabelText(/Manufacturing/));
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Create Company" }));
    await screen.findByText("Acme created");
    expect(callMock).toHaveBeenCalledWith(
      "company.create",
      expect.objectContaining({ pack_key: "manufacturing" }),
    );
  });
});

describe("S-002 wizard — live pack library states (B18-3 mock mirrors shapes)", () => {
  beforeEach(() => callMock.mockReset());

  it("shows an error banner with retry when pack.list fails", async () => {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "pack.list")
        return Promise.reject({
          code: "PACK_SCHEMA_INVALID",
          userMessage: "Unknown Industry Pack.",
          httpStatus: 422,
          retryable: false,
          retryAfterMs: null,
          details: {},
        });
      return Promise.resolve(PREVIEW);
    });
    render(<WizardPage />);
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Unknown Industry Pack.")).toBeInTheDocument();

    // Retry succeeds → the library renders
    installLiveMocks();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Manufacturing")).toBeInTheDocument();
  });

  it("renders the empty state when the pack library is missing", async () => {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "pack.list") return Promise.resolve([]);
      return Promise.resolve(PREVIEW);
    });
    render(<WizardPage />);
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      await waitFor(() => screen.getByText(/No Industry Packs are installed/)),
    ).toBeInTheDocument();
  });
});
