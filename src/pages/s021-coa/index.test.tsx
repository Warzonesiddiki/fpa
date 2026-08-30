import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoaPage } from "./index";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const { companyIdMock } = vi.hoisted(() => ({ companyIdMock: vi.fn() }));
vi.mock("@/stores/session", () => ({
  useSessionStore: (selector: (s: unknown) => unknown) =>
    selector({ companyId: companyIdMock(), companyName: null }),
}));

const ACCOUNTS = [
  {
    id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000010",
    code: "4000",
    name: "Revenue",
    account_type: "revenue",
    report_section: "Income Statement",
    parent_id: null,
    bu_id: null,
    is_control: false,
    active: true,
    version: 1,
    usage_count: 0,
  },
  {
    id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000011",
    code: "4100",
    name: "Software Licenses",
    account_type: "revenue",
    report_section: "Income Statement",
    parent_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000010",
    bu_id: null,
    is_control: false,
    active: true,
    version: 1,
    usage_count: 3,
  },
];

const CO = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/model/coa"]}>
      <Routes>
        <Route path="/app/model/coa" element={<CoaPage />} />
        <Route path="/app/model/packs" element={<div>packs</div>} />
        <Route path="/app/model/calendar" element={<div>calendar</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("S-021 Chart of Accounts (F-002)", () => {
  beforeEach(() => {
    callMock.mockReset();
    companyIdMock.mockReturnValue(CO);
  });

  it("loads accounts from coa.list and renders the tree table", async () => {
    callMock.mockResolvedValue(ACCOUNTS);
    renderPage();
    expect(await screen.findByText("Software Licenses")).toBeInTheDocument();
    expect(screen.getByText("4000")).toBeInTheDocument(); // code column
    expect(screen.getByText("3")).toBeInTheDocument(); // usage count
    expect(callMock).toHaveBeenCalledWith("coa.list", { company_id: CO });
  });

  it("filters rows and shows the dimension tabs", async () => {
    callMock.mockResolvedValue(ACCOUNTS);
    renderPage();
    await screen.findByText("Software Licenses");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Filter accounts"), "4100");
    // The matched row renders together with its parent (children never orphan in a filtered tree)
    expect(screen.getByText("Software Licenses")).toBeInTheDocument();
    expect(screen.getByText("4000")).toBeInTheDocument();
    // Dimension tabs render with their empty state
    await user.click(screen.getByRole("tab", { name: "Project" }));
    expect(screen.getByText(/No dimension values configured yet/)).toBeInTheDocument();
  });

  it("shows the empty state with a pack-template CTA when no accounts exist", async () => {
    callMock.mockResolvedValue([]);
    renderPage();
    const user = userEvent.setup();
    expect(await screen.findByText(/No Accounts yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Browse Pack templates" }));
    expect(await screen.findByText("packs")).toBeInTheDocument();
  });

  it("shows the no-company empty state outside a session", () => {
    companyIdMock.mockReturnValue(null);
    renderPage();
    expect(screen.getByText(/Open a Company to manage its Chart of Accounts/)).toBeInTheDocument();
    expect(callMock).not.toHaveBeenCalled();
  });

  it("shows the typed error state with retry", async () => {
    callMock.mockRejectedValueOnce({
      code: "INTERNAL",
      userMessage: "A database error occurred.",
      httpStatus: 500,
      retryable: true,
      retryAfterMs: null,
      details: {},
    });
    renderPage();
    expect(await screen.findByText("A database error occurred.")).toBeInTheDocument();
    callMock.mockResolvedValue(ACCOUNTS);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Software Licenses")).toBeInTheDocument();
  });
});
