/**
 * S-063 KPI Builder tests (F-029 · M6-4 · SCREENS-SPEC S-063).
 *
 * Verifies:
 *  - Rendering split pane: table and formula editor
 *  - Populated state with KPIs list
 *  - Editing and saving KPI definitions
 *  - Division by zero detection (KPI_DIV_ZERO) displaying "n/a"
 *  - Dashboard pinning toggle
 *  - Zero accessibility violations (vitest-axe)
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { BrowserRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import { KpiBuilderPage } from "./index";
import { useSessionStore } from "@/stores/session";
import * as bridge from "@/api/bridge";

function renderPage() {
  return render(
    <BrowserRouter>
      <KpiBuilderPage />
    </BrowserRouter>,
  );
}

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

describe("S-063 KpiBuilderPage (F-029 · M6-4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSessionStore.setState({ companyId: COMPANY_ID });
  });

  it("renders split pane with KPI list and formula editor", () => {
    renderPage();

    expect(screen.getByText("KPI Builder")).toBeInTheDocument();
    expect(screen.getByText("Custom KPIs (2)")).toBeInTheDocument();
    expect(screen.getByText("ARR Growth Rate")).toBeInTheDocument();
    expect(screen.getByText("Formula Editor & Explainer")).toBeInTheDocument();
  });

  it("detects division by zero formula and displays KPI_DIV_ZERO alert with n/a", async () => {
    renderPage();

    const formulaInput = screen.getByLabelText(/Formula/i);
    fireEvent.change(formulaInput, { target: { value: "[spend] / 0" } });

    vi.spyOn(bridge, "call").mockResolvedValueOnce({
      kpi_id: "kpi-arr",
    } as never);

    const saveBtn = screen.getByTestId("save-kpi-btn");
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    expect(screen.getByText(/KPI_DIV_ZERO/i)).toBeInTheDocument();
    expect(screen.getAllByText("n/a").length).toBeGreaterThanOrEqual(1);
  });

  it("toggles dashboard pin on KPI row", () => {
    renderPage();

    const pinBtn = screen.getByTestId("pin-kpi-kpi-cac");
    expect(pinBtn).toHaveTextContent("☆");

    fireEvent.click(pinBtn);
    expect(pinBtn).toHaveTextContent("Pinned ★");
  });

  it("satisfies axe accessibility rules in populated state", async () => {
    const { container } = renderPage();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
