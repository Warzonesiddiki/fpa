import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PacksPage } from "./index";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const PACKS = [
  { key: "saas", name: "SaaS / Tech", version: "2.1.0", schema_version: "1.0.0", is_bundled: true },
  {
    key: "manufacturing",
    name: "Manufacturing",
    version: "2.1.0",
    schema_version: "1.0.0",
    is_bundled: true,
  },
  {
    key: "retail",
    name: "Retail",
    version: "1.0.0",
    schema_version: "0.9.0",
    is_bundled: false,
  },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/model/packs"]}>
      <Routes>
        <Route path="/app/model/packs" element={<PacksPage />} />
        <Route path="/app/model/coa" element={<div>coa</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("S-023 Pack Studio (F-005)", () => {
  beforeEach(() => callMock.mockReset());

  it("renders the installed pack inventory with schema conformance badges", async () => {
    callMock.mockResolvedValue(PACKS);
    renderPage();
    expect(await screen.findByRole("button", { name: /SaaS \/ Tech/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Manufacturing/ })).toBeInTheDocument();
    // Conformant pack → favourable schema badge; non-conformant → mismatch alert
    expect(screen.getByRole("button", { name: /Retail/ })).toBeInTheDocument();
    expect(screen.getByText(/Schema version does not match/)).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledWith("pack.list", {});
  });

  it("selects a pack and shows its schema-validated components", async () => {
    callMock.mockResolvedValue(PACKS);
    renderPage();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: /SaaS \/ Tech/ });
    await user.click(screen.getByRole("button", { name: /Manufacturing/ }));
    expect(screen.getByText("COA template")).toBeInTheDocument();
    expect(screen.getByText("KPI definitions")).toBeInTheDocument();
    expect(screen.getAllByText(/bundled · schema-validated/).length).toBeGreaterThan(0);
  });

  it("filters the inventory by name", async () => {
    callMock.mockResolvedValue(PACKS);
    renderPage();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: /SaaS \/ Tech/ });
    await user.type(screen.getByLabelText("Filter packs"), "retail");
    expect(screen.getByRole("button", { name: /Retail/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /SaaS \/ Tech/ })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Filter packs"));
    await user.type(screen.getByLabelText("Filter packs"), "zzz");
    expect(screen.getByText(/No Packs match your filter/)).toBeInTheDocument();
  });

  it("shows the empty state when the library is missing", async () => {
    callMock.mockResolvedValueOnce([]);
    renderPage();
    expect(await screen.findByText(/The Pack library is missing/)).toBeInTheDocument();
    // Redownload retries the load and renders the restored library
    callMock.mockResolvedValue(PACKS);
    await userEvent.click(screen.getByRole("button", { name: "Redownload Packs" }));
    expect(await screen.findByRole("button", { name: /SaaS \/ Tech/ })).toBeInTheDocument();
  });
});
