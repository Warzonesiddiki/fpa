import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWizard } from "@/test/wizard-harness";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const PACKS = [
  {
    key: "saas",
    name: "SaaS / Tech",
    version: "2.1.0",
    schema_version: "1.0.0",
    description:
      "ARR, net revenue retention, CAC payback, burn multiple — SaaS revenue and unit economics.",
    is_bundled: true,
  },
  {
    key: "manufacturing",
    name: "Manufacturing",
    version: "2.1.0",
    schema_version: "1.0.0",
    description:
      "Standard costing, production plan, capacity, WIP; OEE, inventory turns, standard cost variance.",
    is_bundled: true,
  },
  {
    key: "retail",
    name: "Retail",
    version: "2.1.0",
    schema_version: "1.0.0",
    description: "Same-store sales, GMROI, conversion, inventory turns.",
    is_bundled: true,
  },
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
  beforeEach(() => {
    callMock.mockReset();
    localStorage.clear();
  });

  it("walks all five steps with Back enabled from step 2", async () => {
    installLiveMocks();
    renderWizard();
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
    renderWizard();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // On the calendar step the (250ms-debounced) preview fetches the 12-month calendar
    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith(
        "calendar.preview",
        expect.objectContaining({ preset: "12month", year_count: 1 }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Company" }));
    // S-002 success: opens the Company and navigates to S-010
    expect(await screen.findByText("Dashboard S-010")).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledWith(
      "company.create",
      expect.objectContaining({ name: "Acme", pack_key: "saas", horizon: "1y" }),
    );
    expect(callMock).toHaveBeenCalledWith(
      "company.open",
      expect.objectContaining({ path: "Acme.fpa" }),
    );
  });

  it("drives the calendar preview and create payload with the FY start month", async () => {
    installLiveMocks();
    renderWizard();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Manufacturing");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // 12-month preset: the FY start month picker is visible, default April (4)
    const fyStart = screen.getByRole("combobox", { name: "FY start month" });
    expect(fyStart).toHaveValue("4");
    fireEvent.change(fyStart, { target: { value: "10" } });
    // The live preview re-fetches with the new FY start month
    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith(
        "calendar.preview",
        expect.objectContaining({ preset: "12month", fy_start_month: 10 }),
      ),
    );

    // … and company.create carries the same choice through to the core
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Company" }));
    await screen.findByText("Acme created");
    expect(callMock).toHaveBeenCalledWith(
      "company.create",
      expect.objectContaining({
        calendar: expect.objectContaining({ preset: "12month", fy_start_month: 10 }),
      }),
    );
  });

  it("hides the FY start picker for week-based presets and states the Sunday week rule", async () => {
    installLiveMocks();
    renderWizard();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Manufacturing");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByText("Retail 4-5-4 (NRF)"));
    await screen.findByText("P01");
    expect(screen.queryByRole("combobox", { name: "FY start month" })).not.toBeInTheDocument();
    expect(
      screen.getByText("Weeks start on Sunday (required for 4-4-5 calendars)."),
    ).toBeInTheDocument();
    // Week-based preview sends null FY start (anchor rule governs instead)
    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith(
        "calendar.preview",
        expect.objectContaining({ preset: "454", fy_start_month: null }),
      ),
    );
  });

  it("keeps the selected pack when the library contains it", async () => {
    installLiveMocks();
    renderWizard();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Manufacturing");
    fireEvent.click(screen.getByLabelText(/Manufacturing/));
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Create Company" }));
    await screen.findByText("Dashboard S-010");
    expect(callMock).toHaveBeenCalledWith(
      "company.create",
      expect.objectContaining({ pack_key: "manufacturing" }),
    );
  });
});

describe("S-002 wizard — demo flow (S-002 Model step; B18-3 clearly-marked)", () => {
  beforeEach(() => {
    callMock.mockReset();
    localStorage.clear();
  });

  const DEMO_FLOW = ["import.parse", "import.validate", "import.tieout", "import.commit"];

  function installDemoMocks() {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "pack.list") return Promise.resolve(PACKS);
      if (cmd === "calendar.preview") return Promise.resolve(PREVIEW);
      if (cmd === "import.parse")
        return Promise.resolve({
          parse_id: "p-1",
          sheets: [{ name: "GL", kind: "gl", row_count: 480 }],
          encodings: ["utf-8"],
          row_counts: { GL: 480 },
        });
      if (cmd === "import.validate")
        return Promise.resolve({
          hard: [],
          warnings: [],
          preview: [],
          rows: 480,
          mapping_version: "1",
        });
      if (cmd === "import.tieout")
        return Promise.resolve({ debits_minor: 93797664, credits_minor: 93797664, diff_rows: [] });
      if (cmd === "import.commit")
        return Promise.resolve({ batch_id: "b-1", audit_id: "a-1", exclusions: 0 });
      return Promise.resolve({ company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001" });
    });
  }

  function reachModelStep() {
    renderWizard();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
  }

  it("seeds demo actuals through the normal import pipeline when the toggle is on", async () => {
    installDemoMocks();
    reachModelStep();
    fireEvent.click(screen.getByLabelText(/Include demo actuals/));
    fireEvent.click(screen.getByRole("button", { name: "Create Company" }));
    expect(await screen.findByText("Dashboard S-010")).toBeInTheDocument();

    for (const cmd of DEMO_FLOW) {
      expect(callMock).toHaveBeenCalledWith(cmd, expect.anything());
    }
    expect(callMock).toHaveBeenCalledWith(
      "import.parse",
      expect.objectContaining({ file_path: "assets/demo/sample_gl_dump.csv", kind: "gl_dump" }),
    );
    expect(callMock).toHaveBeenCalledWith(
      "import.validate",
      expect.objectContaining({ parse_id: "p-1", mapping_id: "canonical" }),
    );
    expect(callMock).toHaveBeenCalledWith(
      "import.commit",
      expect.objectContaining({
        name: expect.stringContaining("DEMO —"),
        exclusions: [],
      }),
    );
  });

  it("creates the clearly-marked Demo Company and loads its actuals", async () => {
    installDemoMocks();
    reachModelStep();
    fireEvent.click(screen.getByRole("button", { name: "Open Demo Company" }));
    expect(await screen.findByText("Dashboard S-010")).toBeInTheDocument();

    expect(callMock).toHaveBeenCalledWith(
      "company.create",
      expect.objectContaining({
        name: "Demo Company — sample data",
        pack_key: "manufacturing",
        plan_only: false,
        calendar: expect.objectContaining({ preset: "12month", fy_start_month: 4 }),
      }),
    );
    expect(callMock).toHaveBeenCalledWith(
      "import.commit",
      expect.objectContaining({ name: expect.stringContaining("DEMO —") }),
    );
  });

  it("surfaces a demo-import failure without losing the created Company", async () => {
    reachModelStep();
    // Break the demo pipeline at tieout (the ingestion gate)
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "pack.list") return Promise.resolve(PACKS);
      if (cmd === "calendar.preview") return Promise.resolve(PREVIEW);
      if (cmd === "import.parse")
        return Promise.resolve({
          parse_id: "p-1",
          sheets: [{ name: "GL", kind: "gl", row_count: 480 }],
          encodings: ["utf-8"],
          row_counts: { GL: 480 },
        });
      if (cmd === "import.validate")
        return Promise.resolve({
          hard: [],
          warnings: [],
          preview: [],
          rows: 480,
          mapping_version: "1",
        });
      if (cmd === "import.tieout")
        return Promise.reject({
          code: "IMPORT_TIE_OUT_FAILED",
          userMessage: "Demo file does not tie out.",
          httpStatus: 422,
          retryable: false,
          retryAfterMs: null,
          details: {},
        });
      return Promise.resolve({ company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001" });
    });
    fireEvent.click(screen.getByLabelText(/Include demo actuals/));
    fireEvent.click(screen.getByRole("button", { name: "Create Company" }));
    // The Company still gets created; no auto-navigation while the warning is shown
    expect(await screen.findByText("Acme created")).toBeInTheDocument();
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to Dashboard" }));
    expect(await screen.findByText("Dashboard S-010")).toBeInTheDocument();
  });
});

describe("S-002 wizard — resume-safe draft (S-002 loading state; TODO M1-8)", () => {
  beforeEach(() => {
    callMock.mockReset();
    localStorage.clear();
  });

  it("restores the in-progress draft (fields + step) on re-open", async () => {
    localStorage.setItem(
      "onefpa.wizard.v1",
      JSON.stringify({
        stepIndex: 2,
        companyName: "Meridian",
        companyType: "group",
        packKey: "retail",
        calendar: "454",
        fyStartMonth: 10,
        planOnly: false,
        horizon: "3y",
        demoData: false,
      }),
    );
    installLiveMocks();
    renderWizard();
    // Restored on the calendar step (step 3 of 5) with the 4-5-4 preset selected
    expect(screen.getByRole("heading", { name: "Fiscal Calendar" })).toBeInTheDocument();
    expect(screen.getByLabelText("Retail 4-5-4 (NRF)")).toBeChecked();
    // Restored FY start month drives the preview request
    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith(
        "calendar.preview",
        expect.objectContaining({ preset: "454", fy_start_month: null }),
      ),
    );
    // Back to step 1: the restored name + type are there
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Company name")).toHaveValue("Meridian");
    expect(screen.getByLabelText("Group / Conglomerate")).toBeChecked();
  });

  it("persists edits as the user proceeds and clears the draft after success", async () => {
    installLiveMocks();
    renderWizard();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    const draftAfterEdit = JSON.parse(localStorage.getItem("onefpa.wizard.v1") ?? "{}");
    expect(draftAfterEdit.companyName).toBe("Acme");

    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Create Company" }));
    expect(await screen.findByText("Dashboard S-010")).toBeInTheDocument();
    expect(localStorage.getItem("onefpa.wizard.v1")).toBeNull();
  });

  it("ignores a corrupt draft instead of crashing first-run", async () => {
    localStorage.setItem("onefpa.wizard.v1", "{not-json");
    installLiveMocks();
    renderWizard();
    expect(screen.getByRole("heading", { name: "Company" })).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toHaveValue("");
  });
});

describe("S-002 wizard — live pack library states (B18-3 mock mirrors shapes)", () => {
  beforeEach(() => {
    callMock.mockReset();
    localStorage.clear();
  });

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
    renderWizard();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Unknown Industry Pack.")).toBeInTheDocument();

    // Retry succeeds → the library renders
    installLiveMocks();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Manufacturing")).toBeInTheDocument();
  });

  it("renders the empty state with a Redownload packs action that re-fetches", async () => {
    let attempts = 0;
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "pack.list") {
        attempts += 1;
        if (attempts === 1) return Promise.resolve([]);
        return Promise.resolve(PACKS);
      }
      return Promise.resolve(PREVIEW);
    });
    renderWizard();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      await waitFor(() => screen.getByText(/No Industry Packs are installed/)),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Redownload packs" }));
    expect(await screen.findByText("Manufacturing")).toBeInTheDocument();
    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it("shows each pack card with its description (S-002 pack cards)", async () => {
    installLiveMocks();
    renderWizard();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Manufacturing")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Standard costing, production plan, capacity, WIP; OEE, inventory turns, standard cost variance.",
      ),
    ).toBeInTheDocument();
  });
});
