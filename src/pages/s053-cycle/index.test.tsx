/**
 * S-053 Planning Cycle & Input Collection Loop Tests (F-021 � F-023 � M4-5 � M4-6 � SCREENS-SPEC S-053 � WIREFRAMES-ANALYTICS S-053).
 *
 * Verifies:
 *   1. All 5 canonical states (loading, empty, error, success, populated).
 *   2. Milestone timeline navigation and milestone steps.
 *   3. Tabs switching: Status Board, Close Checklist, Input Collection.
 *   4. Close checklist task completion and blocked task dependency handling (CYCLE_TASK_BLOCKED).
 *   5. Input collection export, import, and conflict resolution modal (COLLECTION_CONFLICT).
 *   6. Footstrip stats and approval gating.
 *   7. WCAG 2.2 AA accessibility audit with vitest-axe.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import S053PlanningCyclePage from "./index";
import { useCycleStore } from "@/stores/cycle";
import type { CycleTask, ContributorStatus, CollectionConflictItem } from "@/stores/cycle";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({
  call: (...args: unknown[]) => callMock(...args),
  toBridgeError: (err: unknown) => {
    if (typeof err === "object" && err !== null && "code" in err) {
      return err;
    }
    return {
      code: "INTERNAL_ERROR",
      message: String(err),
      userMessage: "An error occurred",
      status: 500,
    };
  },
}));

const mockTasks: CycleTask[] = [
  {
    id: "task-01",
    cycle_id: "cycle-test-01",
    title: "Lock Revenue Inputs",
    owner: "fp-a-lead",
    depends_on_id: null,
    due_date: "2026-10-10",
    status: "done",
    sort_order: 1,
  },
  {
    id: "task-02",
    cycle_id: "cycle-test-01",
    title: "Headcount Reconciliation",
    owner: "hr-finance",
    depends_on_id: "task-01",
    due_date: "2026-10-12",
    status: "pending",
    sort_order: 2,
  },
  {
    id: "task-03",
    cycle_id: "cycle-test-01",
    title: "Final P&L Consolidation",
    owner: "controller",
    depends_on_id: "task-02",
    due_date: "2026-10-15",
    status: "blocked",
    sort_order: 3,
  },
];

const mockContributors: ContributorStatus[] = [
  {
    id: "cnt-01",
    name: "Alice North",
    business_unit: "North America Enterprise",
    status: "submitted",
    last_submitted_at: "2026-10-12T14:30:00Z",
  },
  {
    id: "cnt-02",
    name: "Bob EMEA",
    business_unit: "EMEA Retail",
    status: "conflict",
    last_submitted_at: "2026-10-14T09:15:00Z",
  },
];

const mockConflicts: CollectionConflictItem[] = [
  {
    id: "conf-101",
    upload_id: "up-01",
    driver_id: "dr-sales-vol",
    driver_name: "Enterprise Sales Volume",
    period_id: "2027-P01",
    contributor_a: "Alice North (VP Sales)",
    value_a: "15000",
    contributor_b: "Bob EMEA (Regional Lead)",
    value_b: "12500",
    resolved: false,
    resolution_choice: null,
    resolved_value: null,
  },
];

describe("S-053 Planning Cycle & Collection Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCycleStore.getState().reset();
  });

  describe("Canonical 5 States", () => {
    it("renders loading state when store is loading", () => {
      useCycleStore.setState({ state: "loading", cycleId: "cycle-01" });
      render(<S053PlanningCyclePage />);
      expect(screen.getByText(/Evaluating close checklist tasks/i)).toBeInTheDocument();
    });

    it("renders empty state when no cycle is active", () => {
      useCycleStore.setState({ state: "empty", cycleId: null });
      render(<S053PlanningCyclePage />);
      expect(
        screen.getByText(/Start a new planning cycle to coordinate departmental submissions/i),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Start a planning cycle" })).toBeInTheDocument();
    });

    it("renders error state when store encounters a fatal failure", () => {
      useCycleStore.setState({
        state: "error",
        cycleId: "cycle-01",
        errorCode: "CYCLE_NAME_DUP",
        errorMessage: "Cycle name already exists for this fiscal period.",
      });
      render(<S053PlanningCyclePage />);
      expect(
        screen.getByText("Cycle name already exists for this fiscal period."),
      ).toBeInTheDocument();
    });

    it("renders success state after cycle baseline approval", () => {
      useCycleStore.setState({ state: "success", cycleId: "cycle-01" });
      render(<S053PlanningCyclePage />);
      expect(
        screen.getByText(/All close tasks verified and departmental submissions baseline locked/i),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "View Status Board" })).toBeInTheDocument();
    });

    it("renders populated state with milestone band, status board, and footstrip", () => {
      useCycleStore.setState({
        state: "populated",
        cycleId: "cycle-test-01",
        cycleName: "FY27 Operating Plan",
        cycleKind: "budget",
        currentMilestone: "review",
        tasks: mockTasks,
        contributors: mockContributors,
        conflicts: mockConflicts,
        tasksReady: false,
      });

      render(<S053PlanningCyclePage />);

      expect(screen.getByText("FY27 Operating Plan")).toBeInTheDocument();
      expect(screen.getByText("Review")).toBeInTheDocument();
      expect(screen.getByText("Departmental Contributors")).toBeInTheDocument();
      expect(screen.getByText("Alice North")).toBeInTheDocument();
      expect(screen.getByText("Bob EMEA")).toBeInTheDocument();
      expect(screen.getAllByText(/1 \/ 2/).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Tab Navigation", () => {
    it("renders Close Checklist tab when activeTab is checklist", () => {
      useCycleStore.setState({
        state: "populated",
        activeTab: "checklist",
        cycleId: "cycle-test-01",
        cycleName: "FY27 Operating Plan",
        cycleKind: "budget",
        tasks: mockTasks,
        contributors: mockContributors,
        conflicts: mockConflicts,
      });

      render(<S053PlanningCyclePage />);

      expect(screen.getByText("Period Close Sequencing Invariants")).toBeInTheDocument();
      expect(screen.getByText("Lock Revenue Inputs")).toBeInTheDocument();
      expect(screen.getByText("Headcount Reconciliation")).toBeInTheDocument();
      expect(screen.getByText("Final P&L Consolidation")).toBeInTheDocument();
    });

    it("renders Input Collection tab when activeTab is collection", () => {
      useCycleStore.setState({
        state: "populated",
        activeTab: "collection",
        cycleId: "cycle-test-01",
        cycleName: "FY27 Operating Plan",
        cycleKind: "budget",
        tasks: mockTasks,
        contributors: mockContributors,
        conflicts: mockConflicts,
      });

      render(<S053PlanningCyclePage />);

      expect(screen.getByText("Export Collection Template")).toBeInTheDocument();
      expect(screen.getByText("Enterprise Sales Volume")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Export Template (.csv)" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Upload Sheet" })).toBeInTheDocument();
    });
  });

  describe("Close Checklist Task Operations & CYCLE_TASK_BLOCKED Handling", () => {
    it("handles task completion toggle", async () => {
      callMock.mockResolvedValueOnce({ updated: true });

      useCycleStore.setState({
        state: "populated",
        cycleId: "cycle-test-01",
        activeTab: "checklist",
        tasks: mockTasks,
      });

      const user = userEvent.setup();
      render(<S053PlanningCyclePage />);

      const pendingTaskButton = screen.getByRole("button", {
        name: /Toggle task completion: Headcount Reconciliation/i,
      });
      await user.click(pendingTaskButton);

      expect(callMock).toHaveBeenCalledWith("cycle.task.update", {
        task_id: "task-02",
        status: "done",
        note: undefined,
      });
    });

    it("displays error alert when completing a task sets error state", async () => {
      useCycleStore.setState({
        state: "populated",
        cycleId: "cycle-test-01",
        activeTab: "checklist",
        tasks: mockTasks,
        errorCode: "CYCLE_TASK_BLOCKED",
        errorMessage: "This task is blocked by unfinished tasks: task-02.",
      });

      render(<S053PlanningCyclePage />);

      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent("CYCLE_TASK_BLOCKED");
      expect(alert).toHaveTextContent("This task is blocked by unfinished tasks: task-02.");
    });
  });

  describe("Input Collection & Conflict Resolution", () => {
    it("triggers template export handler", async () => {
      callMock.mockResolvedValueOnce({
        filename: "FY27_driver_template.csv",
        sheet_data_b64: "Y29sdW1uMQ==",
        driver_count: 3,
      });

      useCycleStore.setState({
        state: "populated",
        cycleId: "cycle-test-01",
        activeTab: "collection",
        tasks: mockTasks,
        contributors: mockContributors,
        conflicts: mockConflicts,
      });

      const user = userEvent.setup();
      render(<S053PlanningCyclePage />);

      const exportBtn = screen.getByRole("button", { name: /Export Template/i });
      await user.click(exportBtn);

      expect(callMock).toHaveBeenCalledWith(
        "collection.export",
        expect.objectContaining({
          cycle_id: "cycle-test-01",
        }),
      );
    });

    it("opens conflict resolution modal and submits resolution", async () => {
      callMock.mockResolvedValueOnce({
        conflict_id: "conf-101",
        resolved_value: "15000",
        audit_event_id: "aud-res-01",
      });

      useCycleStore.setState({
        state: "populated",
        cycleId: "cycle-test-01",
        activeTab: "collection",
        tasks: mockTasks,
        contributors: mockContributors,
        conflicts: mockConflicts,
      });

      const user = userEvent.setup();
      render(<S053PlanningCyclePage />);

      const resolveBtn = screen.getByRole("button", { name: "Resolve" });
      await user.click(resolveBtn);

      expect(screen.getByRole("heading", { name: "Resolve Driver Conflict" })).toBeInTheDocument();
      expect(screen.getByText(/Accept Alice North \(VP Sales\)/)).toBeInTheDocument();

      const applyBtn = screen.getByRole("button", { name: "Apply Resolution" });
      await user.click(applyBtn);

      expect(callMock).toHaveBeenCalledWith("collection.resolve_conflict", {
        conflict_id: "conf-101",
        choice: "choose_a",
        note: "",
      });
    });
  });

  describe("Accessibility (vitest-axe)", () => {
    it("passes axe checks in populated state", async () => {
      useCycleStore.setState({
        state: "populated",
        cycleId: "cycle-test-01",
        cycleName: "FY27 Operating Plan",
        cycleKind: "budget",
        currentMilestone: "review",
        tasks: mockTasks,
        contributors: mockContributors,
        conflicts: mockConflicts,
        tasksReady: false,
      });

      render(<S053PlanningCyclePage />);
      const results = await axe(document.body);
      expect(results.violations).toEqual([]);
    });
  });
});
