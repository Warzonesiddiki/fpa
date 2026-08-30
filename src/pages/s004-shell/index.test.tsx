import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ShellPage } from "./index";

describe("S-004 App Shell — a11y-first chrome", () => {
  it("renders all 8 nav destinations as links", () => {
    render(
      <MemoryRouter initialEntries={["/app/dashboard"]}>
        <Routes>
          <Route path="/app" element={<ShellPage />}>
            <Route index element={<div>index</div>} />
            <Route path="dashboard" element={<div>dashboard</div>} />
          </Route>
          <Route path="/data" element={<div>data</div>} />
          <Route path="/model" element={<div>model</div>} />
          <Route path="/plan" element={<div>plan</div>} />
          <Route path="/analyze" element={<div>analyze</div>} />
          <Route path="/reports" element={<div>reports</div>} />
          <Route path="/governance" element={<div>governance</div>} />
          <Route path="/settings" element={<div>settings</div>} />
        </Routes>
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav).toBeInTheDocument();
    for (const label of [
      "Dashboard",
      "Data",
      "Model",
      "Plan",
      "Analyze",
      "Reports",
      "Governance",
      "Settings",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    // Active route styling on the current link (relative nav under /app)
    expect(screen.getByRole("link", { name: "Dashboard" }).className).toContain("oneprimary");
  });

  it("renders the outlet content inside the shell", () => {
    render(
      <MemoryRouter initialEntries={["/app/dashboard"]}>
        <Routes>
          <Route path="/app" element={<ShellPage />}>
            <Route index element={<div>index</div>} />
            <Route path="dashboard" element={<div>content-here</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("content-here")).toBeInTheDocument();
  });
});
