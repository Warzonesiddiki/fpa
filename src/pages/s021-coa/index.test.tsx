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
    version: 2,
    usage_count: 3,
  },
  {
    id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000012",
    code: "5000",
    name: "Cost of Goods Sold",
    account_type: "cogs",
    report_section: "Income Statement",
    parent_id: null,
    bu_id: null,
    is_control: false,
    active: true,
    version: 1,
    usage_count: 1,
  },
];

const PACKS = [
  {
    key: "saas",
    name: "SaaS / Tech",
    version: "2.1.0",
    schema_version: "1.0.0",
    description: "ARR, NRR, CAC payback.",
    is_bundled: true,
  },
  {
    key: "retail",
    name: "Retail",
    version: "1.4.0",
    schema_version: "1.0.0",
    description: "Same-store sales, GMROI.",
    is_bundled: true,
  },
];

const CO = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

/** Command-aware bridge mock — `call` is called for coa.list AND pack.list on mount. */
function queue(responses: Record<string, unknown>) {
  callMock.mockImplementation((cmd: string) => {
    if (!(cmd in responses)) return Promise.resolve([]);
    const v = responses[cmd];
    return typeof v === "function" ? (v as () => unknown)() : Promise.resolve(v);
  });
}

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

  it("loads accounts from coa.list and renders the tree table with versions", async () => {
    queue({ "coa.list": ACCOUNTS, "pack.list": PACKS });
    renderPage();
    expect(await screen.findByText("Software Licenses")).toBeInTheDocument();
    expect(screen.getByText("4000")).toBeInTheDocument(); // code column
    expect(screen.getByText("3")).toBeInTheDocument(); // usage count
    // Version column (version history element — in-place version counter)
    expect(screen.getByRole("columnheader", { name: "Version" })).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledWith("coa.list", { company_id: CO });
  });

  it("filters rows and shows the dimension tabs", async () => {
    queue({ "coa.list": ACCOUNTS, "pack.list": PACKS });
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

  it("imports a Pack COA and reports created/updated", async () => {
    queue({
      "coa.list": ACCOUNTS,
      "pack.list": PACKS,
      "coa.import": { created: 12, updated: 2 },
    });
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Software Licenses");
    await user.selectOptions(screen.getByLabelText("Source Pack"), "saas");
    await user.click(screen.getByRole("button", { name: "Import COA" }));
    expect(await screen.findByText("Import complete: 12 created, 2 updated.")).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledWith("coa.import", {
      company_id: CO,
      pack_key: "saas",
    });
  });

  it("imports from a JSON file path when no pack is chosen", async () => {
    queue({
      "coa.list": ACCOUNTS,
      "pack.list": PACKS,
      "coa.import": { created: 5, updated: 0 },
    });
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Software Licenses");
    const fileInput = screen.getByLabelText("Or JSON file path");
    await user.click(fileInput); // focus — paste targets the focused element
    await user.paste("/home/user/coa.json");
    await user.click(screen.getByRole("button", { name: "Import COA" }));
    expect(await screen.findByText("Import complete: 5 created, 0 updated.")).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledWith("coa.import", {
      company_id: CO,
      file_path: "/home/user/coa.json",
    });
  });

  it("surfaces the COA_DUPLICATE_CODE user message on import failure", async () => {
    queue({
      "coa.list": ACCOUNTS,
      "pack.list": PACKS,
      "coa.import": () =>
        Promise.reject({
          code: "COA_DUPLICATE_CODE",
          userMessage: "Account code 4000 already exists in this scope.",
          httpStatus: 409,
          retryable: false,
          retryAfterMs: null,
          details: {},
        }),
    });
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Software Licenses");
    await user.selectOptions(screen.getByLabelText("Source Pack"), "saas");
    await user.click(screen.getByRole("button", { name: "Import COA" }));
    // role="alert" elements don't take their accessible name from content — query by text
    const alert = (await screen.findByText(/Account code 4000 already exists/)).closest(
      '[role="alert"]',
    );
    expect(alert).not.toBeNull();
  });

  it("merges two accounts and reports the remapped line count", async () => {
    queue({
      "coa.list": ACCOUNTS,
      "pack.list": PACKS,
      "coa.merge_accounts": { remapped: 5 },
    });
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Software Licenses");
    await user.selectOptions(screen.getByLabelText("Merge from"), ACCOUNTS[0].id);
    await user.selectOptions(screen.getByLabelText("Into account"), ACCOUNTS[2].id);
    await user.click(screen.getByRole("button", { name: "Merge" }));
    expect(await screen.findByText("Merge complete: 5 lines remapped.")).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledWith("coa.merge_accounts", {
      from_id: ACCOUNTS[0].id,
      to_id: ACCOUNTS[2].id,
    });
  });

  it("surfaces the COA_TYPE_MISMATCH user message on merge failure", async () => {
    queue({
      "coa.list": ACCOUNTS,
      "pack.list": PACKS,
      "coa.merge_accounts": () =>
        Promise.reject({
          code: "COA_TYPE_MISMATCH",
          userMessage: "Cannot merge: account types differ (Revenue vs COGS).",
          httpStatus: 422,
          retryable: false,
          retryAfterMs: null,
          details: {},
        }),
    });
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Software Licenses");
    await user.selectOptions(screen.getByLabelText("Merge from"), ACCOUNTS[0].id);
    await user.selectOptions(screen.getByLabelText("Into account"), ACCOUNTS[2].id);
    await user.click(screen.getByRole("button", { name: "Merge" }));
    // role="alert" elements don't take their accessible name from content — query by text
    const alert = (await screen.findByText(/Cannot merge: account types differ/)).closest(
      '[role="alert"]',
    );
    expect(alert).not.toBeNull();
  });

  it("disables the merge button until two DIFFERENT accounts are chosen", async () => {
    queue({ "coa.list": ACCOUNTS, "pack.list": PACKS });
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Software Licenses");
    const button = screen.getByRole("button", { name: "Merge" });
    expect(button).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Merge from"), ACCOUNTS[0].id);
    await user.selectOptions(screen.getByLabelText("Into account"), ACCOUNTS[0].id);
    expect(button).toBeDisabled(); // same account — the guard exists before it reaches the core
  });

  it("shows the empty state (import card + pack-template CTA) when no accounts exist", async () => {
    queue({ "coa.list": [], "pack.list": PACKS });
    renderPage();
    const user = userEvent.setup();
    expect(await screen.findByText(/No Accounts yet/)).toBeInTheDocument();
    // The import card is available directly in the empty state (seed the COA here)
    expect(screen.getByRole("heading", { name: "Import COA" })).toBeInTheDocument();
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
    queue({
      "coa.list": () =>
        Promise.reject({
          code: "INTERNAL",
          userMessage: "A database error occurred.",
          httpStatus: 500,
          retryable: true,
          retryAfterMs: null,
          details: {},
        }),
      "pack.list": PACKS,
    });
    renderPage();
    expect(await screen.findByText("A database error occurred.")).toBeInTheDocument();
    callMock.mockImplementation((cmd: string) =>
      cmd === "coa.list" ? Promise.resolve(ACCOUNTS) : Promise.resolve(PACKS),
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Software Licenses")).toBeInTheDocument();
  });
});
