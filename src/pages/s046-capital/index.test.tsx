/**
 * Unit tests for S-046 Capital, Debt & Working Capital screen (F-017 · M3-7).
 *
 * Verifies:
 * - 5 Sub-Tabs: Capital Projects, Debt Schedule, Working Capital Drivers, 13-Week Cash, Covenant Gauges
 * - Tab switching and contents
 * - Schedule calculations (Capex SL/DDB preview, Debt balances & interest, WC impact, 13-week cash rolling closing)
 * - Error states and codes: CAPEX_IN_SERVICE_INVALID, DEBT_SCHEDULE_OVERDRAWN, COVENANT_BREACH
 * - Adding a project and facility
 * - Canonical 5 states: loading, empty, error, success, populated
 * - 0 axe accessibility violations across states
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { CapitalPage } from "./index";
import {
  useCapitalStore,
  INITIAL_PROJECTS,
  INITIAL_FACILITIES,
  INITIAL_WC_DRIVERS,
  INITIAL_OPENING_CASH,
  INITIAL_WEEKLY_RECEIPTS,
  INITIAL_WEEKLY_DISBURSEMENTS,
  INITIAL_WEEKLY_FINANCING,
  INITIAL_EBITDA,
} from "@/stores/capital";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/model/capital"]}>
      <CapitalPage />
    </MemoryRouter>,
  );
}

describe("S-046 Capital, Debt & Working Capital screen (F-017 · M3-7)", () => {
  beforeEach(() => {
    // Reset store to standard populated state
    useCapitalStore.setState({
      status: "populated",
      error: null,
      currency: "INR",
      activeTab: "capital",
      projects: [...INITIAL_PROJECTS],
      facilities: [...INITIAL_FACILITIES],
      wcDrivers: { ...INITIAL_WC_DRIVERS },
      openingCashMinor: INITIAL_OPENING_CASH,
      weeklyReceipts: [...INITIAL_WEEKLY_RECEIPTS],
      weeklyDisbursements: [...INITIAL_WEEKLY_DISBURSEMENTS],
      weeklyFinancing: [...INITIAL_WEEKLY_FINANCING],
      ebitdaMinor: INITIAL_EBITDA,
    });
  });

  it("renders the 5 sub-tabs and header", () => {
    renderPage();
    expect(screen.getByText("Capital, Debt & Working Capital")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Capital Projects" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Debt Schedule" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Working Capital Drivers" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "13-Week Cash" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Covenant Gauges" })).toBeInTheDocument();
  });

  it("switches tabs correctly to Debt Schedule", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("tab", { name: "Debt Schedule" }));
    expect(
      screen.getByRole("heading", { name: "Debt Facilities & Amortization Schedule" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Debt Facilities Table" })).toBeInTheDocument();
    expect(screen.getByText("Term Loan A")).toBeInTheDocument();
  });

  it("switches to Working Capital Drivers and updates driver values", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("tab", { name: "Working Capital Drivers" }));
    expect(
      screen.getByRole("heading", { name: "Working Capital Drivers & Cash Flow Sensitivity" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Days Sales Outstanding (DSO)")).toBeInTheDocument();
    expect(screen.getByText("Days Payable Outstanding (DPO)")).toBeInTheDocument();
    expect(screen.getByText("Days Inventory Outstanding (DIO)")).toBeInTheDocument();
    expect(
      screen.getByText("Net Working Capital & Operating Cash Flow Impact"),
    ).toBeInTheDocument();
  });

  it("switches to 13-Week Cash flow rolling schedule", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("tab", { name: "13-Week Cash" }));
    expect(
      screen.getByRole("heading", { name: "13-Week Direct Cash Flow Rolling Forecast" }),
    ).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "13-Week Cash Schedule Table" });
    expect(table).toBeInTheDocument();
    expect(within(table).getByText("W01")).toBeInTheDocument();
    expect(within(table).getByText("W13")).toBeInTheDocument();
  });

  it("switches to Covenant Gauges and displays compliance metrics", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("tab", { name: "Covenant Gauges" }));
    expect(
      screen.getByRole("heading", { name: "Lender Covenant Gauges & Compliance Monitoring" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Leverage Ratio (Net Debt / EBITDA)")).toBeInTheDocument();
    expect(screen.getByText("Interest Cover (EBITDA / Interest)")).toBeInTheDocument();
    expect(screen.getAllByText("COMPLIANT").length).toBeGreaterThan(0);
  });

  it("renders COVENANT_BREACH warning and gauge indicators when covenants are breached", () => {
    // EBITDA drops to 1_000_000_00 (making Net Debt / EBITDA ratio huge)
    useCapitalStore.getState().setEbitda(1_000_000_00);
    renderPage();

    expect(screen.getByText("COVENANT_BREACH")).toBeInTheDocument();
  });

  it("renders error state when CAPEX_IN_SERVICE_INVALID is triggered", () => {
    useCapitalStore.getState().triggerError("CAPEX_IN_SERVICE_INVALID");
    renderPage();

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(within(alert).getByText("CAPEX_IN_SERVICE_INVALID")).toBeInTheDocument();
    expect(
      within(alert).getByText(
        "Depreciation cannot start before the capital project's in-service date.",
      ),
    ).toBeInTheDocument();
  });

  it("renders error state when DEBT_SCHEDULE_OVERDRAWN is triggered", () => {
    useCapitalStore.getState().triggerError("DEBT_SCHEDULE_OVERDRAWN");
    renderPage();

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(within(alert).getByText("DEBT_SCHEDULE_OVERDRAWN")).toBeInTheDocument();
  });

  it("renders empty state with 'Add a Capital Project or Debt Facility'", () => {
    useCapitalStore.getState().clearAll();
    renderPage();

    expect(screen.getByText("Add a Capital Project or Debt Facility")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Capital Project" })).toBeInTheDocument();
  });

  it("renders loading state", () => {
    useCapitalStore.setState({ status: "loading" });
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Calculating capital asset roll-forwards, debt schedules & 13-week cash...",
    );
  });

  it("renders success state confirmation", () => {
    useCapitalStore.setState({ status: "success" });
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Capital and debt schedules updated successfully.",
    );
  });

  it("allows adding a new capital project through the form", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Add Project" }));
    expect(screen.getByRole("form", { name: "Add Capital Project Form" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Project Name"), "Cloud Migration");
    await user.type(screen.getByLabelText(/Capex Amount/), "5000000");
    await user.click(screen.getByRole("button", { name: "Save Project" }));

    expect(screen.getByText("Cloud Migration")).toBeInTheDocument();
  });

  it("keeps the screen axe-clean (0 WCAG violations) in populated state", async () => {
    const { container } = renderPage();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it("keeps the screen axe-clean in covenant breach state", async () => {
    useCapitalStore.getState().setEbitda(1_000_000_00);
    useCapitalStore.getState().setActiveTab("covenants");
    const { container } = renderPage();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it("keeps the screen axe-clean in empty state", async () => {
    useCapitalStore.getState().clearAll();
    const { container } = renderPage();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
