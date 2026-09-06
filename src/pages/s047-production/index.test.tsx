import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { ProductionPage } from "./index";

describe("S-047 Production & Backlog Page (F-018)", () => {
  it("renders populated state with metrics, tables and is axe-clean", async () => {
    const { container } = render(<ProductionPage />);

    expect(screen.getByText("Production & Backlog")).toBeInTheDocument();
    expect(screen.getByText("Enterprise Core Unit")).toBeInTheDocument();
    expect(screen.getByText("Sensor Array Module")).toBeInTheDocument();

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it("switches tabs between production plan and backlog", () => {
    render(<ProductionPage />);

    const backlogTab = screen.getByRole("tab", { name: /Backlog & POC/i });
    fireEvent.click(backlogTab);

    expect(screen.getByText("CT-2026-081")).toBeInTheDocument();
    expect(screen.getByText("Global Logistics Corp")).toBeInTheDocument();
  });

  it("toggles empty state when clear data is clicked", () => {
    render(<ProductionPage />);

    const clearBtn = screen.getByRole("button", { name: /Clear Data/i });
    fireEvent.click(clearBtn);

    expect(screen.getByText("No production plan")).toBeInTheDocument();

    const addBtn = screen.getByRole("button", { name: /Add Product Line/i });
    fireEvent.click(addBtn);

    expect(screen.getByText("Enterprise Core Unit")).toBeInTheDocument();
  });
});
