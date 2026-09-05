import { describe, it, expect, beforeEach } from "vitest";
import { useCycleStore } from "./cycle";

describe("useCycleStore", () => {
  beforeEach(() => {
    useCycleStore.getState().reset();
  });

  it("initializes with empty state and default milestone progression", () => {
    const s = useCycleStore.getState();
    expect(s.state).toBe("empty");
    expect(s.activeTab).toBe("board");
    expect(s.tasks).toEqual([]);
    expect(s.conflicts).toEqual([]);
    expect(s.currentMilestone).toBe("review");
  });

  it("switches active tab between board, checklist, and collection", () => {
    const s = useCycleStore.getState();
    s.setActiveTab("checklist");
    expect(useCycleStore.getState().activeTab).toBe("checklist");

    s.setActiveTab("collection");
    expect(useCycleStore.getState().activeTab).toBe("collection");

    s.setActiveTab("board");
    expect(useCycleStore.getState().activeTab).toBe("board");
  });

  it("loads checklist tasks and transitions to populated state", async () => {
    await useCycleStore.getState().loadChecklist("m-main");
    const s = useCycleStore.getState();
    expect(s.state).toBe("populated");
    expect(s.tasks.length).toBe(4);
    expect(s.cycleId).toBe("pc-fy27-budget");
    expect(s.tasksReady).toBe(false);
  });

  it("updates task status and advances ready state when all done", async () => {
    await useCycleStore.getState().loadChecklist("m-main");
    // Mark ct-2 done
    const ok2 = await useCycleStore.getState().updateTaskStatus("ct-2", "done");
    expect(ok2).toBe(true);
    expect(useCycleStore.getState().tasks.find((t) => t.id === "ct-2")?.status).toBe("done");
  });

  it("catches blocked task error with CYCLE_TASK_BLOCKED and locked user message", async () => {
    await useCycleStore.getState().loadChecklist("m-main");
    // ct-3 is blocked by mock trigger
    const ok3 = await useCycleStore.getState().updateTaskStatus("ct-3", "done");
    expect(ok3).toBe(false);
    const s = useCycleStore.getState();
    expect(s.state).toBe("error");
    expect(s.errorCode).toBe("CYCLE_TASK_BLOCKED");
    expect(s.errorMessage).toContain("This task is blocked by unfinished tasks: Run GL tie-out and reconcile accounts.");
  });

  it("exports driver collection sheet", async () => {
    const ok = await useCycleStore.getState().exportCollectionSheet(["dr-1", "dr-2"]);
    expect(ok).toBe(true);
    expect(useCycleStore.getState().exportedFile).toContain("driver_collection_");
  });

  it("imports collection sheet with conflict detection", async () => {
    const ok = await useCycleStore.getState().importCollectionSheet("collection_upload_conflict.xlsx");
    expect(ok).toBe(true);
    const s = useCycleStore.getState();
    expect(s.conflicts.length).toBe(1);
    expect(s.conflicts[0].driver_name).toBe("Sales Volume (Units)");
  });

  it("resolves driver conflict in collection queue", async () => {
    await useCycleStore.getState().importCollectionSheet("collection_upload_conflict.xlsx");
    expect(useCycleStore.getState().conflicts.length).toBe(1);

    const ok = await useCycleStore.getState().resolveConflict("conf-1", "choose_a", "Accepted North America actuals");
    expect(ok).toBe(true);
    expect(useCycleStore.getState().conflicts.length).toBe(0);
  });

  it("starts a new cycle and resets to kickoff milestone", async () => {
    const ok = await useCycleStore.getState().startCycle("m-main", "forecast", "Q4 Rolling Forecast", "2026-11-30");
    expect(ok).toBe(true);
    const s = useCycleStore.getState();
    expect(s.cycleName).toBe("Q4 Rolling Forecast");
    expect(s.cycleKind).toBe("forecast");
    expect(s.currentMilestone).toBe("kickoff");
  });
});
