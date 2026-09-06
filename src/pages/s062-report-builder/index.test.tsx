/**
 * S-062 Report Builder tests (F-029 · M6-4 · SCREENS-SPEC S-062).
 *
 * Verifies:
 *  - Rendering canvas and palette
 *  - Populated state with table rows and columns
 *  - Empty state when no company selected
 *  - Error state handling with LAYOUT_REFERENCE_BROKEN and auto-remap button
 *  - Zero accessibility violations (vitest-axe)
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { BrowserRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import { ReportBuilderPage } from "./index";
import { useSessionStore } from "@/stores/session";
import * as bridge from "@/api/bridge";

function renderPage() {
  return render(
    <BrowserRouter>
      <ReportBuilderPage />
    </BrowserRouter>,
  );
}

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

describe("S-062 ReportBuilderPage (F-029 · M6-4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSessionStore.setState({ companyId: COMPANY_ID });
  });

  it("renders populated canvas preview with financial rows", async () => {
    vi.spyOn(bridge, "call").mockResolvedValueOnce({
      layout_id: "preview",
      name: "Standard Income Statement",
      rows: [
        {
          line_id: "rev-1",
          label: "Subscription Revenue",
          cells: [
            { col_index: 0, amount_minor: 150000000, text: null },
            { col_index: 1, amount_minor: 160000000, text: null },
            { col_index: 2, amount_minor: 310000000, text: null },
          ],
        },
      ],
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("report-row-rev-1")).toBeInTheDocument();
    });

    expect(screen.getByText("Report Builder")).toBeInTheDocument();
    expect(screen.getByText("Subscription Revenue")).toBeInTheDocument();
    expect(screen.getByText("Layout Palette")).toBeInTheDocument();
  });

  it("renders empty state when no company is open", async () => {
    useSessionStore.setState({ companyId: null });
    renderPage();

    expect(await screen.findByText("New Blank Layout")).toBeInTheDocument();
  });

  it("renders error state with auto-remap offer on LAYOUT_REFERENCE_BROKEN", async () => {
    vi.spyOn(bridge, "call").mockRejectedValueOnce({
      code: "LAYOUT_REFERENCE_BROKEN",
      message: "Layout references broken lines",
      userMessage: "Layout references 2 missing lines. Auto-remap or fix.",
      httpStatus: 422,
      details: { count: 2 },
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/LAYOUT_REFERENCE_BROKEN/i)).toBeInTheDocument();
    });

    const remapBtn = screen.getByTestId("auto-remap-btn");
    expect(remapBtn).toBeInTheDocument();

    fireEvent.click(remapBtn);
    expect(screen.queryByText(/LAYOUT_REFERENCE_BROKEN/i)).not.toBeInTheDocument();
  });

  it("satisfies axe accessibility rules in populated state", async () => {
    vi.spyOn(bridge, "call").mockResolvedValueOnce({
      layout_id: "preview",
      name: "Standard Income Statement",
      rows: [
        {
          line_id: "rev-1",
          label: "Subscription Revenue",
          cells: [{ col_index: 0, amount_minor: 150000000, text: null }],
        },
      ],
    } as never);

    const { container } = renderPage();
    await screen.findByTestId("report-row-rev-1");

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
