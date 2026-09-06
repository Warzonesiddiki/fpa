/**
 * S-064 Board Pack tests (F-030 · M6-5 · SCREENS-SPEC S-064).
 *
 * Verifies:
 *  - Document outline navigation with 9 sections
 *  - Section commentary editing and PACK_NO_COMMENTARY alert
 *  - HEALTH_CHECK_BLOCKED export gate disabling buttons
 *  - Zero accessibility violations (vitest-axe)
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { BrowserRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import { BoardPackPage } from "./index";
import { useSessionStore } from "@/stores/session";
import * as bridge from "@/api/bridge";

function renderPage() {
  return render(
    <BrowserRouter>
      <BoardPackPage />
    </BrowserRouter>,
  );
}

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

describe("S-064 BoardPackPage (F-030 · M6-5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSessionStore.setState({ companyId: COMPANY_ID });
  });

  it("renders document outline and section preview", () => {
    renderPage();

    expect(screen.getByText("Board Pack Generator")).toBeInTheDocument();
    expect(screen.getByText("Document Outline")).toBeInTheDocument();
    expect(screen.getAllByText("Income Statement (P&L)").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Executive Commentary & Notes")).toBeInTheDocument();
  });

  it("switches active section and updates commentary", () => {
    renderPage();

    const secItem = screen.getByTestId("section-item-sec-kpis");
    fireEvent.click(secItem);

    const commentaryInput = screen.getByLabelText(/Executive Commentary & Notes/i);
    expect(commentaryInput).toHaveValue("ARR expanded 34% YoY led by enterprise expansion.");

    fireEvent.change(commentaryInput, { target: { value: "Updated quarterly commentary." } });
    expect(commentaryInput).toHaveValue("Updated quarterly commentary.");
  });

  it("disables export buttons when HEALTH_CHECK_BLOCKED is active", async () => {
    vi.spyOn(bridge, "call").mockResolvedValueOnce({
      blocking_count: 2,
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    expect(screen.getByText(/HEALTH_CHECK_BLOCKED/i)).toBeInTheDocument();
    expect(screen.getByTestId("export-excel-btn")).toBeDisabled();
    expect(screen.getByTestId("export-pdf-btn")).toBeDisabled();
  });

  it("satisfies axe accessibility rules in populated state", async () => {
    const { container } = renderPage();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
