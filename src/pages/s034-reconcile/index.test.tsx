import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { MemoryRouter } from "react-router-dom";
import { ReconciliationPage } from "./index";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/import/reconcile"]}>
      <ReconciliationPage />
    </MemoryRouter>,
  );
}

describe("S-034 Source Reconciliation — honest gated state (reconcile.* unbuilt)", () => {
  it("renders the gate banner and never renders fabricated comparison data", () => {
    renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: /Source Reconciliation & Cross-Tie/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("note", { name: /Reconciliation actions unavailable/i }),
    ).toHaveTextContent(/no registered handlers and no typed contract/i);

    // Nothing simulated: no diff table, no authoritative action, no success claim.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark authoritative/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/logged to HMAC audit trail/i)).not.toBeInTheDocument();
  });

  it("never fabricates the core-owned SRC_MISMATCH_UNRESOLVED code in the browser", () => {
    const { container } = renderPage();
    expect(container.textContent).not.toContain("SRC_MISMATCH_UNRESOLVED");
  });

  it("offers the real Manual Import path instead", () => {
    renderPage();
    const link = screen.getByRole("link", { name: /use manual import instead/i });
    expect(link).toHaveAttribute("href", "/app/import");
  });

  it("is axe-clean", async () => {
    const { container } = renderPage();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
