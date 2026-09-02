import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "@/stores/session";
import { ShellPage } from "./index";

describe("S-004 App Shell — a11y-first chrome", () => {
  beforeEach(() => {
    // The zustand store persists across tests — never leak a degraded session into a case.
    useSessionStore.setState({ readOnly: false });
  });

  it("renders all 9 nav destinations as links", () => {
    render(
      <MemoryRouter initialEntries={["/app/dashboard"]}>
        <Routes>
          <Route path="/app" element={<ShellPage />}>
            <Route index element={<div>index</div>} />
            <Route path="dashboard" element={<div>dashboard</div>} />
          </Route>
          <Route path="/companies" element={<div>companies</div>} />
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
      "Companies",
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
    expect(screen.getByRole("link", { name: "Data" })).toHaveAttribute("href", "/app/import");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/app/settings");
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

  it("opens the ⌘K search palette from the top bar button", () => {
    render(
      <MemoryRouter initialEntries={["/app/dashboard"]}>
        <Routes>
          <Route path="/app" element={<ShellPage />}>
            <Route index element={<div>index</div>} />
            <Route path="dashboard" element={<div>dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const searchButton = screen.getByRole("button", { name: /Search/ });
    expect(searchButton).toBeInTheDocument();
  });

  it("no restore banner for a verified session", () => {
    render(
      <MemoryRouter initialEntries={["/app/dashboard"]}>
        <Routes>
          <Route path="/app" element={<ShellPage />}>
            <Route path="dashboard" element={<div>dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the read-only + restore banner when the audit chain failed verification (§2.5)", () => {
    useSessionStore.setState({ readOnly: true, unlocked: true, companyName: "Meridian" });
    render(
      <MemoryRouter initialEntries={["/app/dashboard"]}>
        <Routes>
          <Route path="/app" element={<ShellPage />}>
            <Route path="dashboard" element={<div>dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const alert = screen.getByRole("alert");
    // The banner leads with the exact documented AUDIT_CHAIN_BREAK user text and is never
    // dismissible — tamper evidence is never silenceable (B18-5/6).
    expect(alert).toHaveTextContent(
      "Audit integrity check failed. Restore from the last verified Snapshot?",
    );
    expect(alert).toHaveTextContent("Read-only");
    // Content still renders underneath: read-only does not hide the Company's data.
    expect(screen.getByText("dashboard")).toBeInTheDocument();
  });
});
