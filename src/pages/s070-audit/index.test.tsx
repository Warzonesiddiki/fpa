/**
 * S-070 Audit Trail screen tests (F-033 · US-034 · SCREENS-SPEC S-070).
 *
 * Verifies:
 *  - header + wireframe toolbar (date range · actor · action · object · chain chip)
 *  - all 5 canonical states: loading / empty (no Company) / empty (no events) / error /
 *    populated
 *  - row expansion reveals the verbatim before/after payload + the hash link
 *  - a broken chain renders the read-only banner and STILL lists every event (US-034)
 *  - the screen exposes no edit/delete affordance at all (B7)
 *  - export buttons are disabled while their commands do not exist (B18-5/7)
 *  - pagination controls drive the store
 *  - axe: 0 violations (empty, populated, error, broken-chain states)
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import { AuditTrailPage } from "./index";
import { useAuditStore, type AuditStoreState } from "@/stores/audit";
import { useSessionStore } from "@/stores/session";
import type { AuditEventRecord } from "@/api/schema";

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/governance/audit"]}>
      <AuditTrailPage />
    </MemoryRouter>,
  );
}

function event(overrides: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return {
    seq: 4,
    actor: "owner",
    action: "import.commit",
    object_type: "import_batch",
    object_id: "2026-08-30_001",
    before_json: null,
    after_json: '{"rows":48213,"debits_minor":915400000}',
    prev_hash: "aaaaaaaabbbbbbbbccccccccdddddddd",
    hash: "1111111122222222333333334444444455555555666666667777777788888888",
    created_at: "2026-08-30T09:14:00Z",
    ...overrides,
  };
}

const FACETS = {
  actors: ["owner", "reviewer"],
  actions: ["import.commit", "scenario.approve"],
  objectTypes: ["import_batch", "scenario"],
};

/** Populate the store directly; the network path is covered by stores/audit.test.ts. */
function setPopulated(partial: Partial<AuditStoreState> = {}) {
  useAuditStore.setState({
    status: "populated",
    error: null,
    companyId: COMPANY_ID,
    events: [
      event(),
      event({
        seq: 3,
        actor: "reviewer",
        action: "scenario.approve",
        object_type: "scenario",
        object_id: "sc-fy27",
        before_json: '{"state":"review"}',
        after_json: '{"state":"approved"}',
      }),
    ],
    chainStatus: { verified: true, broken_at_seq: null, event_count: 2 },
    meta: { page: 1, page_size: 50, total: 2, total_pages: 1 },
    facets: FACETS,
    ...partial,
  });
}

describe("S-070 Audit Trail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuditStore.getState().reset();
    useSessionStore.setState({ companyId: COMPANY_ID });
    // The page loads on mount; keep it inert so each test owns the store state.
    vi.spyOn(useAuditStore.getState(), "load").mockResolvedValue(true);
    useAuditStore.setState({ load: vi.fn().mockResolvedValue(true) });
  });

  it("renders the title and the wireframe toolbar controls", () => {
    setPopulated();
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: /audit trail/i })).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toBeInTheDocument();
    expect(screen.getByLabelText("To")).toBeInTheDocument();
    expect(screen.getByLabelText("Actor")).toBeInTheDocument();
    expect(screen.getByLabelText("Action")).toBeInTheDocument();
    expect(screen.getByLabelText("Object")).toBeInTheDocument();
    expect(screen.getByTestId("audit-chain-chip")).toHaveTextContent("Chain verified");
  });

  it("populates the actor/action/object selects from the engine facets", () => {
    setPopulated();
    renderPage();
    const actor = screen.getByLabelText("Actor") as HTMLSelectElement;
    expect([...actor.options].map((o) => o.value)).toEqual(["", "owner", "reviewer"]);
    const action = screen.getByLabelText("Action") as HTMLSelectElement;
    expect([...action.options].map((o) => o.value)).toEqual([
      "",
      "import.commit",
      "scenario.approve",
    ]);
  });

  it("lists events newest-first with actor, action and object columns", () => {
    setPopulated();
    renderPage();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("import.commit")).toBeInTheDocument();
    expect(within(rows[0]).getByText(/import_batch · 2026-08-30_001/)).toBeInTheDocument();
    expect(within(rows[1]).getByText("scenario.approve")).toBeInTheDocument();
  });

  it("expands a row to the verbatim before/after payload and the hash link", async () => {
    const user = userEvent.setup();
    setPopulated();
    renderPage();
    const toggle = screen.getByRole("button", { name: "#4" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Exactly the stored bytes — no reformatting of the money in the payload (B3/B6).
    expect(screen.getByText('{"rows":48213,"debits_minor":915400000}')).toBeInTheDocument();
    expect(screen.getByText("— (no payload recorded)")).toBeInTheDocument();
    expect(screen.getByText("Previous hash")).toBeInTheDocument();
    expect(screen.getByText(/11111111…88888888/)).toBeInTheDocument();
  });

  it("shows the loading skeleton", () => {
    useAuditStore.setState({ status: "loading", companyId: COMPANY_ID });
    renderPage();
    expect(screen.getByRole("status", { name: "Loading audit events" })).toBeInTheDocument();
  });

  it("shows 'No events yet' for an empty chain", () => {
    useAuditStore.setState({
      status: "empty",
      companyId: COMPANY_ID,
      events: [],
      chainStatus: { verified: true, broken_at_seq: null, event_count: 0 },
    });
    renderPage();
    expect(screen.getByText("No events yet")).toBeInTheDocument();
  });

  it("distinguishes an empty filter result and offers to clear the filters", async () => {
    const user = userEvent.setup();
    const clearFilters = vi.fn().mockResolvedValue(true);
    useAuditStore.setState({
      status: "empty",
      companyId: COMPANY_ID,
      events: [],
      facets: FACETS,
      filters: {
        from: null,
        to: null,
        actor: "reviewer",
        action: null,
        objectType: null,
        objectId: null,
      },
      clearFilters,
    });
    renderPage();
    expect(screen.getByText("No events match these filters")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    expect(clearFilters).toHaveBeenCalled();
  });

  it("prompts to open a Company when there is no session Company", () => {
    useSessionStore.setState({ companyId: null });
    useAuditStore.setState({ status: "empty", companyId: null, events: [] });
    renderPage();
    expect(screen.getByText("Open a Company to view its Audit Trail.")).toBeInTheDocument();
  });

  it("renders the typed error with its code and a retry when retryable", async () => {
    const user = userEvent.setup();
    const retry = vi.fn().mockResolvedValue(true);
    useAuditStore.setState({
      status: "error",
      companyId: COMPANY_ID,
      error: {
        code: "INTERNAL",
        userMessage: "Something went wrong. Please try again.",
        httpStatus: 500,
        retryable: true,
        retryAfterMs: null,
        details: {},
      },
      retry,
    });
    renderPage();
    expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument();
    expect(screen.getByText(/INTERNAL/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalled();
  });

  it("a broken chain shows the read-only banner, the ✗ chip, and keeps every event readable", () => {
    setPopulated({ chainStatus: { verified: false, broken_at_seq: 3, event_count: 2 } });
    renderPage();
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Audit integrity check failed at event #3");
    expect(banner).toHaveTextContent("Restore from the last verified Snapshot");
    expect(screen.getByTestId("audit-chain-chip")).toHaveTextContent("Chain broken");
    // The tamper is shown, never hidden — the log stays fully readable (US-034).
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("exposes no edit or delete affordance anywhere (append-only, B7)", () => {
    setPopulated();
    renderPage();
    for (const button of screen.getAllByRole("button")) {
      expect(button.textContent ?? "").not.toMatch(/edit|delete|remove/i);
    }
  });

  it("ships the export buttons disabled while their commands do not exist", () => {
    setPopulated();
    renderPage();
    const dataRoom = screen.getByRole("button", { name: /auditor data-room export/i });
    expect(dataRoom).toBeDisabled();
    expect(dataRoom).toHaveAttribute("title", expect.stringContaining("not implemented yet"));
    expect(screen.getByRole("button", { name: /export log/i })).toBeDisabled();
  });

  it("reports the chain event count in the footstrip", () => {
    setPopulated({ chainStatus: { verified: true, broken_at_seq: null, event_count: 18402 } });
    renderPage();
    expect(screen.getByText("18402 events")).toBeInTheDocument();
  });

  it("hides pagination on a single page and drives the store when multi-page", async () => {
    const user = userEvent.setup();
    setPopulated();
    const { unmount } = renderPage();
    expect(screen.queryByRole("navigation", { name: "Audit pagination" })).toBeNull();
    unmount();

    const goToPage = vi.fn().mockResolvedValue(true);
    setPopulated({
      meta: { page: 2, page_size: 50, total: 120, total_pages: 3 },
      page: 2,
      goToPage,
    });
    renderPage();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(goToPage).toHaveBeenCalledWith(3);
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(goToPage).toHaveBeenCalledWith(1);
  });

  it("a filter change goes through the store with the chosen value", async () => {
    const user = userEvent.setup();
    const setFilter = vi.fn().mockResolvedValue(true);
    setPopulated({ setFilter });
    renderPage();
    await user.selectOptions(screen.getByLabelText("Actor"), "reviewer");
    expect(setFilter).toHaveBeenCalledWith("actor", "reviewer");
    await user.type(screen.getByLabelText("From"), "2026-08-01");
    expect(setFilter).toHaveBeenCalledWith("from", "2026-08-01T00:00:00Z");
  });

  describe("accessibility", () => {
    it("populated has no axe violations", async () => {
      setPopulated();
      const { container } = renderPage();
      expect((await axe(container)).violations).toEqual([]);
    });

    it("empty has no axe violations", async () => {
      useAuditStore.setState({ status: "empty", companyId: COMPANY_ID, events: [] });
      const { container } = renderPage();
      expect((await axe(container)).violations).toEqual([]);
    });

    it("error has no axe violations", async () => {
      useAuditStore.setState({
        status: "error",
        companyId: COMPANY_ID,
        error: {
          code: "INTERNAL",
          userMessage: "Something went wrong.",
          httpStatus: 500,
          retryable: false,
          retryAfterMs: null,
          details: {},
        },
      });
      const { container } = renderPage();
      expect((await axe(container)).violations).toEqual([]);
    });

    it("broken chain has no axe violations", async () => {
      setPopulated({ chainStatus: { verified: false, broken_at_seq: 3, event_count: 2 } });
      const { container } = renderPage();
      expect((await axe(container)).violations).toEqual([]);
    });
  });
});
