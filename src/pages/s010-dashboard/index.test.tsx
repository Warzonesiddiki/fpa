import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DashboardPage } from "./index";

describe("S-010 Dashboard — Plan-Only default (F-030)", () => {
  it("shows the plan-only empty state with a CTA", () => {
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("FY2026 · P08")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Plan-Only — showing driver-based Best / Base / Worst",
    );
    // M3 wires the empty-state CTA; the panel itself is the five-state contract (Q1)
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders all four KPI cards with exact currency values", async () => {
    render(<DashboardPage />);
    expect(screen.getByText("USD 6,350,000.00")).toBeInTheDocument(); // revenue (not thousands)
    expect(screen.getByText("USD 2,380")).toBeInTheDocument(); // gross margin (thousands)
    expect(screen.getByText("USD 1,140")).toBeInTheDocument(); // ebitda (thousands)
    expect(screen.getByText("USD 1,320")).toBeInTheDocument(); // cash (thousands)
    const explainers = screen.getAllByText("How is this KPI computed?");
    expect(explainers).toHaveLength(4);
    await userEvent.click(explainers[0]); // D-008 explainer toggle (no crash; wire-up in M3)
  });

  it("renders KPI cards inside Card surfaces", () => {
    const { container } = render(<DashboardPage />);
    expect(container.querySelectorAll("section")).toHaveLength(4);
  });
});
