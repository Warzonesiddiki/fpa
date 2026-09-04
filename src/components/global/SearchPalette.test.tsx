import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchPalette } from "./SearchPalette";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const { openMock } = vi.hoisted(() => ({ openMock: vi.fn() }));
vi.mock("@/stores/session", () => ({
  useSessionStore: (selector: (s: unknown) => unknown) => selector({ open: openMock }),
}));

const COMPANIES = [
  {
    id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    name: "Meridian Holdings (Demo)",
    company_file_path: "/Users/demo/Meridian.fpa",
  },
];

const PACKS = [{ key: "saas", name: "SaaS / Tech", version: "2.1.0" }];

function renderPalette(open = true) {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={["/app/dashboard"]}>
      <Routes>
        <Route path="/app/dashboard" element={<div>dashboard</div>} />
      </Routes>
      <SearchPalette open={open} onOpen={onOpen} onClose={onClose} />
    </MemoryRouter>,
  );
  return { ...utils, onOpen, onClose };
}

describe("S-003 Global Search Palette (⌘K)", () => {
  beforeEach(() => {
    callMock.mockReset();
    openMock.mockReset();
    openMock.mockResolvedValue(true);
    localStorage.clear();
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "company.list") return Promise.resolve(COMPANIES);
      if (cmd === "pack.list") return Promise.resolve(PACKS);
      return Promise.resolve({});
    });
  });

  it("opens with Ctrl+K and opens a company from the live index", async () => {
    const { onOpen } = renderPalette(false);
    const user = userEvent.setup();
    await user.keyboard("{Control>}k{/Control}");
    expect(onOpen).toHaveBeenCalledTimes(1);

    renderPalette();
    await user.type(screen.getByRole("combobox", { name: "Search" }), "merid");
    const option = await screen.findByRole("option", { name: /Meridian Holdings/ });
    expect(option).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(openMock).toHaveBeenCalledWith("/Users/demo/Meridian.fpa");
  });

  it("moves the active option with ArrowDown and selects it with Enter", async () => {
    const { onClose } = renderPalette();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox", { name: "Search" }), "model");
    // "model" now surfaces the Model Grid screen first (S-041), then the COA and Calendar
    // screens — SCREEN_INDEX order: grid < coa < calendar.
    const grid = await screen.findByRole("option", { name: /Model Grid/ });
    expect(grid).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: /Chart of Accounts/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: /Fiscal Calendar/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalled();
  });

  it("finds a pack by its key and navigates to Pack Studio", async () => {
    const { onClose } = renderPalette();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox", { name: "Search" }), "saas");
    const pack = await screen.findByRole("option", { name: /SaaS \/ Tech/ });
    expect(pack).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalled();
  });

  it("indexes the S-030/S-031/S-032 import routes and S-075 Settings", async () => {
    renderPalette();
    const user = userEvent.setup();
    const input = screen.getByRole("combobox", { name: "Search" });
    await user.type(input, "import");
    expect(await screen.findByRole("option", { name: /Import Hub/ })).toHaveTextContent(
      "/app/import",
    );
    await user.clear(input);
    await user.type(input, "mapping");
    expect(await screen.findByRole("option", { name: /Mapping Wizard/ })).toHaveTextContent(
      "/app/import/map",
    );
    await user.clear(input);
    await user.type(input, "tie-out");
    expect(await screen.findByRole("option", { name: /Tie-Out & Commit/ })).toHaveTextContent(
      "/app/import/commit",
    );
    await user.clear(input);
    await user.type(input, "settings");
    expect(await screen.findByRole("option", { name: /Settings/ })).toHaveTextContent(
      "/app/settings",
    );
    await user.clear(input);
    await user.type(input, "headcount");
    expect(await screen.findByRole("option", { name: /Headcount Plan/ })).toHaveTextContent(
      "/app/model/headcount",
    );
  });

  it("shows the no-matches empty state after the debounce", async () => {
    renderPalette();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox", { name: "Search" }), "zzzz-no-match");
    expect(await screen.findByText(/No matches for 'zzzz-no-match'/)).toBeInTheDocument();
  });

  it("falls back to screens-only search when the live index fails", async () => {
    callMock.mockRejectedValue({ code: "INTERNAL", userMessage: "boom" });
    renderPalette();
    expect(await screen.findByText(/search index is unavailable/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole("combobox", { name: "Search" }), "dashboard");
    expect(await screen.findByRole("option", { name: /Dashboard/ })).toBeInTheDocument();
  });

  it("persists a recent history entry and shows it above the groups", async () => {
    const first = renderPalette();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox", { name: "Search" }), "dashboard");
    await user.keyboard("{Enter}");
    first.unmount();

    renderPalette();
    expect(screen.getByText("Recent")).toBeInTheDocument();
    // Dashboard appears in both Recent and Screens groups
    expect(screen.getAllByRole("option", { name: /Dashboard/ })).toHaveLength(2);
  });

  it("closes with Escape", async () => {
    const { onClose } = renderPalette();
    const user = userEvent.setup();
    screen.getByRole("combobox", { name: "Search" }).focus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
