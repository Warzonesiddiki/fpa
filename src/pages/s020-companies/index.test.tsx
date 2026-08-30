import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompaniesPage } from "./index";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const { openMock } = vi.hoisted(() => ({ openMock: vi.fn() }));
vi.mock("@/stores/session", () => ({
  useSessionStore: (selector: (s: unknown) => unknown) =>
    selector({
      open: openMock,
      companyId: null,
      companyName: null,
      unlocked: true,
      status: "populated",
    }),
}));

const COMPANIES = [
  {
    id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    name: "Meridian Holdings (Demo)",
    type: "group",
    default_currency_code: "USD",
    base_locale: "en-IN",
    last_opened_at: "2026-08-30T00:00:00Z",
    company_file_path: "/Users/demo/Meridian.fpa",
    license_status: "active",
  },
  {
    id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000002",
    name: "Atlas Manufacturing (Sandbox)",
    type: "single",
    default_currency_code: "EUR",
    base_locale: "en-IN",
    last_opened_at: "2026-01-02T00:00:00Z",
    company_file_path: "/Users/demo/Atlas.fpa",
    license_status: "grace",
  },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/companies"]}>
      <Routes>
        <Route path="/app/companies" element={<CompaniesPage />} />
        <Route path="/welcome" element={<div>wizard</div>} />
        <Route path="/app/dashboard" element={<div>dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("S-020 Company Manager (F-001)", () => {
  beforeEach(() => {
    callMock.mockReset();
    openMock.mockReset();
  });

  it("renders a loading skeleton then the populated company cards", async () => {
    callMock.mockResolvedValue(COMPANIES);
    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(await screen.findByText("Meridian Holdings (Demo)")).toBeInTheDocument();
    expect(screen.getByText("Atlas Manufacturing (Sandbox)")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Company" })).toBeInTheDocument();
  });

  it("opens a company via the session store and navigates to the dashboard", async () => {
    callMock.mockResolvedValue(COMPANIES);
    openMock.mockResolvedValue(true);
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Meridian Holdings (Demo)");
    const openButtons = screen.getAllByRole("button", { name: /Open/ });
    await user.click(openButtons[0]);
    expect(await screen.findByText("dashboard")).toBeInTheDocument();
    expect(openMock).toHaveBeenCalledWith("/Users/demo/Meridian.fpa");
  });

  it("navigates to the wizard from New Company", async () => {
    callMock.mockResolvedValue(COMPANIES);
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Meridian Holdings (Demo)");
    await user.click(screen.getByRole("button", { name: "New Company" }));
    expect(await screen.findByText("wizard")).toBeInTheDocument();
  });

  it("renders the empty state with a create CTA when no companies exist", async () => {
    callMock.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/No Companies yet/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create your first Company" }));
    expect(await screen.findByText("wizard")).toBeInTheDocument();
  });

  it("deletes a company after the 2-step confirm with a reason", async () => {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "company.delete") return Promise.resolve({ deleted: true });
      return Promise.resolve(COMPANIES);
    });
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Meridian Holdings (Demo)");
    const deleteButtons = screen.getAllByRole("button", { name: /Delete/ });
    await user.click(deleteButtons[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Delete permanently" });
    expect(confirm).toBeDisabled(); // reason required (audit)
    await user.type(screen.getByPlaceholderText(/Superseded by/), "superseded");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(await screen.findByText("Meridian Holdings (Demo) deleted")).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledWith("company.delete", {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      reason: "superseded",
    });
    expect(screen.queryByText("Meridian Holdings (Demo)")).not.toBeInTheDocument();
  });
});
