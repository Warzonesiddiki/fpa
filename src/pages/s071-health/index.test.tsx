/**
 * S-071 Model Health Check screen tests (F-032 · US-033 · SCREENS-SPEC S-071).
 *
 * Verifies:
 *  - header, the five category rows and the "N blocking · M warnings" footstrip
 *  - all 5 canonical states: loading (indeterminate, no fake %) / empty (no Model) /
 *    empty (never run) / error / success (all green) / populated (findings)
 *  - the waiver is NEVER inline on the row: it opens a panel, and the confirm button stays
 *    disabled until a non-blank reason exists (D-010 friction)
 *  - a waived finding stays visible with its reason and author (US-033)
 *  - "→ cell" is offered ONLY for a `cell:` entity_ref, never for line/driver/period refs
 *  - no auto-fix affordance exists anywhere on the screen (QA-CHECKLIST F-032 item 3)
 *  - the export gate line reflects the engine's blocking count
 *  - axe: 0 violations (empty, populated, success, error states)
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import { HealthCheckPage } from "./index";
import { useHealthStore, type HealthStoreState } from "@/stores/health";
import { useSessionStore } from "@/stores/session";
import type { HealthCategoryResult, HealthFindingRecord } from "@/api/schema";

const MODEL_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000010";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/governance/health"]}>
      <HealthCheckPage />
    </MemoryRouter>,
  );
}

function finding(overrides: Partial<HealthFindingRecord> = {}): HealthFindingRecord {
  return {
    id: "f-1",
    category: "tie_out",
    severity: "hard",
    message: "Committed GL does not tie for period fp-2026-p02.",
    entity_ref: "period:fp-2026-p02",
    waiver: null,
    ...overrides,
  };
}

const CELL_FINDING = finding({
  id: "f-2",
  category: "reference",
  severity: "hard",
  message: "Formula is not valid: unsupported function: LAMBDA.",
  entity_ref: "cell:ln-opex:sc-budget:fp-2026-p03",
});

const WARN_FINDING = finding({
  id: "f-3",
  category: "anomaly",
  severity: "warn",
  message: "Value moves from 120000 to 980000 minor units into period fp-2026-p04.",
  entity_ref: "cell:ln-mkt:sc-budget:fp-2026-p04",
});

function categories(overrides: Partial<Record<string, number>> = {}): HealthCategoryResult[] {
  return (["tie_out", "reference", "rounding", "driver_feed", "anomaly"] as const).map(
    (category) => {
      const count = overrides[category] ?? 0;
      return {
        category,
        status: count > 0 ? ("failed" as const) : ("passed" as const),
        finding_count: count,
        blocking_count: count,
        warning_count: 0,
      };
    },
  );
}

/** Drive the store directly; the network path is covered by stores/health.test.ts. */
function setPopulated(partial: Partial<HealthStoreState> = {}) {
  useHealthStore.setState({
    status: "populated",
    error: null,
    waiveError: null,
    modelId: MODEL_ID,
    checkId: "hc-1",
    runAt: "2026-09-05T10:00:00Z",
    runStatus: "failed",
    findings: [finding(), CELL_FINDING, WARN_FINDING],
    categories: categories({ tie_out: 1, reference: 1 }),
    blockingCount: 2,
    warningCount: 1,
    waivedCount: 0,
    history: [],
    ...partial,
  });
}

describe("S-071 Model Health Check", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useHealthStore.getState().reset();
    useSessionStore.setState({ modelId: MODEL_ID, readOnly: false });
    // The page runs on mount; keep it inert so each test owns the store state.
    useHealthStore.setState({ run: vi.fn().mockResolvedValue(true) });
  });

  it("renders the title and the five category rows in the documented order", () => {
    setPopulated();
    renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: /model health check/i }),
    ).toBeInTheDocument();
    const cards = screen.getAllByTestId("health-category");
    expect(cards).toHaveLength(5);
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining("Tie-outs"),
      expect.stringContaining("References"),
      expect.stringContaining("Rounding"),
      expect.stringContaining("Driver feeds"),
      expect.stringContaining("Anomalies"),
    ]);
  });

  it("shows the blocking/warning footstrip exactly as the engine counted it", () => {
    setPopulated();
    renderPage();
    expect(screen.getByTestId("health-footstrip")).toHaveTextContent("2 blocking · 1 warnings");
    expect(screen.getByText(/export blocked until every blocking finding/i)).toBeInTheDocument();
  });

  it("allows export when nothing blocks", () => {
    setPopulated({ blockingCount: 0, warningCount: 1, findings: [WARN_FINDING] });
    renderPage();
    expect(screen.getByText(/no blocking findings — export is allowed/i)).toBeInTheDocument();
  });

  describe("canonical states", () => {
    it("loading is indeterminate and shows no percentage", () => {
      useHealthStore.setState({ status: "loading" });
      renderPage();
      expect(screen.getByRole("status", { name: /running health check/i })).toBeInTheDocument();
      expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    });

    it("empty without a Model asks for one", () => {
      useSessionStore.setState({ modelId: null });
      useHealthStore.setState({ status: "empty", modelId: null });
      renderPage();
      expect(screen.getByText(/open a model to run its health check/i)).toBeInTheDocument();
    });

    it("empty with a Model offers the first run", () => {
      useHealthStore.setState({ status: "empty", modelId: MODEL_ID });
      renderPage();
      expect(screen.getByText(/has not been checked yet/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /run health check/i })).toBeInTheDocument();
    });

    it("error shows the code and the userMessage", () => {
      useHealthStore.setState({
        status: "error",
        error: {
          code: "SESSION_LOCKED",
          userMessage: "Session locked. Unlock to continue.",
          httpStatus: 401,
          retryable: false,
          retryAfterMs: null,
          details: {},
        },
      });
      renderPage();
      expect(screen.getByText("Session locked. Unlock to continue.")).toBeInTheDocument();
      expect(screen.getByText(/SESSION_LOCKED/)).toBeInTheDocument();
    });

    it("success reports all clear and lists no findings", () => {
      setPopulated({
        status: "success",
        findings: [],
        categories: categories(),
        blockingCount: 0,
        warningCount: 0,
      });
      renderPage();
      expect(screen.getByText(/no issues — all five checks pass/i)).toBeInTheDocument();
      expect(screen.queryAllByTestId("health-finding")).toHaveLength(0);
    });
  });

  describe("findings table", () => {
    it("lists every finding with its severity", () => {
      setPopulated();
      renderPage();
      const rows = screen.getAllByTestId("health-finding");
      expect(rows).toHaveLength(3);
      expect(rows.filter((r) => r.dataset.severity === "hard")).toHaveLength(2);
      expect(within(rows[2]).getByText("Warning")).toBeInTheDocument();
    });

    it('offers "Go to cell" only when the entity_ref names a cell', () => {
      setPopulated();
      renderPage();
      const rows = screen.getAllByTestId("health-finding");
      // period: ref → no jump target is fabricated
      expect(within(rows[0]).queryByRole("link", { name: /go to cell/i })).toBeNull();
      const link = within(rows[1]).getByRole("link", { name: /go to cell/i });
      expect(link).toHaveAttribute(
        "href",
        "/app/model/grid?line=ln-opex&scenario=sc-budget&period=fp-2026-p03",
      );
    });

    it("exposes no auto-fix affordance anywhere (findings are reported, never repaired)", () => {
      setPopulated();
      renderPage();
      for (const label of [/fix/i, /repair/i, /auto/i, /adjust/i, /dismiss/i, /delete/i]) {
        expect(screen.queryByRole("button", { name: label })).toBeNull();
      }
    });
  });

  describe("waiver (D-010)", () => {
    it("is not inline on the row: it opens an explicit panel", async () => {
      const user = userEvent.setup();
      setPopulated();
      const openWaiver = vi.fn();
      useHealthStore.setState({ openWaiver });
      renderPage();

      const rows = screen.getAllByTestId("health-finding");
      // No reason input exists on the row itself.
      expect(within(rows[0]).queryByRole("textbox")).toBeNull();
      await user.click(within(rows[0]).getByRole("button", { name: /waive/i }));
      expect(openWaiver).toHaveBeenCalledWith("f-1");
    });

    it("keeps the confirm button disabled until a non-blank reason is typed", async () => {
      const user = userEvent.setup();
      setPopulated({ waivingFindingId: "f-1" });
      renderPage();

      const confirm = screen.getByRole("button", { name: /record waiver/i });
      expect(confirm).toBeDisabled();
      const reason = screen.getByLabelText(/reason \(required\)/i);
      await user.type(reason, "   ");
      expect(confirm).toBeDisabled();
      await user.type(reason, "Known feed defect, fixed at source next close.");
      expect(confirm).toBeEnabled();
    });

    it("states that a waiver does not fix the finding and is audited", () => {
      setPopulated({ waivingFindingId: "f-1" });
      renderPage();
      expect(screen.getByText(/a waiver does not fix the finding/i)).toBeInTheDocument();
      expect(screen.getByText(/audit trail/i)).toBeInTheDocument();
    });

    it("refuses to waive while the Company is read-only", () => {
      useSessionStore.setState({ readOnly: true });
      setPopulated({ waivingFindingId: "f-1", findings: [finding()] });
      renderPage();
      expect(screen.getByRole("button", { name: /record waiver/i })).toBeDisabled();
    });

    it("sends the reason to the store on confirm", async () => {
      const user = userEvent.setup();
      const waive = vi.fn().mockResolvedValue(true);
      setPopulated({ waivingFindingId: "f-1" });
      useHealthStore.setState({ waive });
      renderPage();

      await user.type(
        screen.getByLabelText(/reason \(required\)/i),
        "Signed off by the Controller.",
      );
      await user.click(screen.getByRole("button", { name: /record waiver/i }));
      expect(waive).toHaveBeenCalledWith("f-1", "Signed off by the Controller.");
    });

    it("shows the waiver error verbatim", () => {
      setPopulated({
        waivingFindingId: "f-1",
        waiveError: {
          code: "HEALTH_WAIVER_REASON_REQUIRED",
          userMessage: "A waiver reason is required.",
          httpStatus: 422,
          retryable: false,
          retryAfterMs: null,
          details: {},
        },
      });
      renderPage();
      expect(screen.getByRole("alert")).toHaveTextContent("A waiver reason is required.");
    });

    it("keeps a waived finding visible with its reason and author", () => {
      const waived = finding({
        waiver: {
          reason: "Known 5-minor rounding in the legacy Jan feed.",
          actor: "owner",
          created_at: "2026-09-05T11:00:00Z",
        },
      });
      setPopulated({ findings: [waived], blockingCount: 0, warningCount: 0, waivedCount: 1 });
      renderPage();

      const row = screen.getByTestId("health-finding");
      expect(row.dataset.waived).toBe("true");
      const note = within(row).getByTestId("health-waiver-note");
      expect(note).toHaveTextContent("Waived by owner");
      expect(note).toHaveTextContent("Known 5-minor rounding in the legacy Jan feed.");
      // A waived finding offers no second waiver.
      expect(within(row).queryByRole("button", { name: /waive/i })).toBeNull();
      expect(screen.getByText(/1 waived/i)).toBeInTheDocument();
    });
  });

  it("re-runs the check from the header", async () => {
    const user = userEvent.setup();
    const run = vi.fn().mockResolvedValue(true);
    setPopulated();
    useHealthStore.setState({ run });
    renderPage();
    run.mockClear();
    await user.click(screen.getByRole("button", { name: /re-run check/i }));
    expect(run).toHaveBeenCalled();
  });

  it("lists previous runs when there is more than one", () => {
    setPopulated({
      history: [
        { check_id: "hc-2", run_at: "2026-09-05T10:00:00Z", status: "failed", finding_count: 3 },
        { check_id: "hc-1", run_at: "2026-09-04T10:00:00Z", status: "passed", finding_count: 0 },
      ],
    });
    renderPage();
    const history = screen.getByRole("region", { name: /previous runs/i });
    expect(within(history).getAllByRole("listitem")).toHaveLength(2);
  });

  describe("accessibility", () => {
    it("has no axe violations when populated", async () => {
      setPopulated();
      renderPage();
      expect((await axe(document.body)).violations).toEqual([]);
    });

    it("has no axe violations in the waiver panel", async () => {
      setPopulated({ waivingFindingId: "f-1" });
      renderPage();
      expect((await axe(document.body)).violations).toEqual([]);
    });

    it("has no axe violations when all clear", async () => {
      setPopulated({
        status: "success",
        findings: [],
        categories: categories(),
        blockingCount: 0,
        warningCount: 0,
      });
      renderPage();
      expect((await axe(document.body)).violations).toEqual([]);
    });

    it("has no axe violations in the error state", async () => {
      useHealthStore.setState({
        status: "error",
        error: {
          code: "INTERNAL",
          userMessage: "Something went wrong.",
          httpStatus: 500,
          retryable: true,
          retryAfterMs: null,
          details: {},
        },
      });
      renderPage();
      expect((await axe(document.body)).violations).toEqual([]);
    });
  });
});
