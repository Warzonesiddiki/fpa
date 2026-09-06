import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { MemoryRouter } from "react-router-dom";
import { ConnectorsPage } from "./index";

function renderPage() {
  return render(
    <MemoryRouter>
      <ConnectorsPage />
    </MemoryRouter>,
  );
}

describe("S-033 Connectors Manager (F-009)", () => {
  it("renders the provider catalogue with the gate banner and is axe-clean", async () => {
    const { container } = renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: /ERP & Accounting Connectors/i }),
    ).toBeInTheDocument();

    // Gate banner states the truthful reason (no registered handlers).
    expect(screen.getByText(/Connector runtime not built/i)).toBeInTheDocument();
    expect(screen.getAllByText(/no registered handlers/i).length).toBeGreaterThan(0);

    // All four planned providers are listed as spec content.
    expect(screen.getByText("QuickBooks Online")).toBeInTheDocument();
    expect(screen.getByText("Xero")).toBeInTheDocument();
    expect(screen.getByText("Oracle NetSuite")).toBeInTheDocument();
    expect(screen.getByText("Sage Intacct")).toBeInTheDocument();

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it("never simulates connector actions: Connect is disabled with the gate reason", () => {
    renderPage();

    const connectButtons = screen.getAllByRole("button", { name: /Connect/i });
    expect(connectButtons.length).toBeGreaterThan(0);
    for (const btn of connectButtons) {
      expect(btn).toBeDisabled();
      expect(btn.getAttribute("title")).toMatch(/no registered handlers/);
    }

    // No fabricated runtime: no sync action, no OAuth dialog, no fake history.
    expect(screen.queryByRole("button", { name: /Sync Now/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/Recent Connector Sync Batches/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tied \(0 diff\)/i)).not.toBeInTheDocument();
  });

  it("offers the working alternative: Manual Import (B19)", () => {
    renderPage();

    const manualLinks = screen.getAllByRole("link", { name: /Manual Import/i });
    expect(manualLinks.length).toBeGreaterThan(0);
    for (const link of manualLinks) {
      expect(link).toHaveAttribute("href", "/app/import");
    }
  });
});
