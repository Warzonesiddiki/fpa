/**
 * Planning Cycle & Input Collection Zustand Store (M4-5 · M4-6 · S-053).
 *
 * Manages:
 * - 5 canonical screen states: `loading`, `empty`, `error`, `success`, `populated`
 * - Active planning cycle milestone progression: `kickoff` -> `submit` -> `review` -> `approve` -> `baseline`
 * - Active tabs: `board` (Status board), `checklist` (Close checklist), `collection` (Input collection)
 * - Close checklist tasks (dependencies, completion checks)
 * - Input collection loop & driver conflict resolution
 */

import { create } from "zustand";
import { call, toBridgeError } from "../api/bridge";
import type {
  CycleTask,
  CollectionConflictItem,
  CycleChecklistStatusData,
  CycleStartData,
  CollectionExportData,
  CollectionImportData,
} from "../api/schema";

export type { CycleTask, CollectionConflictItem } from "../api/schema";
export type CycleTab = "board" | "checklist" | "collection";
export type CycleMilestone = "kickoff" | "submit" | "review" | "approve" | "baseline";
export type ScreenState = "loading" | "empty" | "error" | "success" | "populated";

export interface ContributorStatus {
  id: string;
  name: string;
  business_unit: string;
  status: "pending" | "submitted" | "conflict" | "approved";
  last_submitted_at: string | null;
}

export interface CycleStoreState {
  // Screen state
  state: ScreenState;
  errorMessage: string | null;
  errorCode: string | null;
  activeTab: CycleTab;

  // Cycle details
  cycleId: string | null;
  cycleName: string;
  cycleKind: "budget" | "forecast" | "rolling";
  currentMilestone: CycleMilestone;
  milestoneDates: Record<CycleMilestone, string>;

  // Checklist tasks
  tasks: CycleTask[];
  tasksReady: boolean;

  // Input collection
  contributors: ContributorStatus[];
  conflicts: CollectionConflictItem[];
  exportedFile: string | null;

  // Actions
  setActiveTab: (tab: CycleTab) => void;
  loadChecklist: (modelId: string, periodId?: string) => Promise<void>;
  startCycle: (
    modelId: string,
    kind: "budget" | "forecast" | "rolling",
    name: string,
    due: string,
  ) => Promise<boolean>;
  updateTaskStatus: (
    taskId: string,
    status: "pending" | "done" | "blocked",
    note?: string,
  ) => Promise<boolean>;
  exportCollectionSheet: (driverIds: string[], template?: string) => Promise<boolean>;
  importCollectionSheet: (filePath: string, mappingId?: string) => Promise<boolean>;
  resolveConflict: (
    conflictId: string,
    choice: "choose_a" | "choose_b" | "average",
    note?: string,
  ) => Promise<boolean>;
  advanceMilestone: (nextMilestone: CycleMilestone) => void;
  reset: () => void;
}

const DEFAULT_CONTRIBUTORS: ContributorStatus[] = [
  {
    id: "cnt-1",
    name: "Sarah Jenkins (Sales Director)",
    business_unit: "North America Commercial",
    status: "submitted",
    last_submitted_at: "2026-09-03T14:20:00Z",
  },
  {
    id: "cnt-2",
    name: "Alex Rivera (Operations VP)",
    business_unit: "Global Supply Chain",
    status: "conflict",
    last_submitted_at: "2026-09-04T09:15:00Z",
  },
  {
    id: "cnt-3",
    name: "Marcus Vance (Engineering Head)",
    business_unit: "R&D Product",
    status: "pending",
    last_submitted_at: null,
  },
  {
    id: "cnt-4",
    name: "Priya Patel (Finance Lead)",
    business_unit: "Corporate",
    status: "approved",
    last_submitted_at: "2026-09-01T11:00:00Z",
  },
];

const DEFAULT_MILESTONE_DATES: Record<CycleMilestone, string> = {
  kickoff: "2026-08-15",
  submit: "2026-09-01",
  review: "2026-09-10",
  approve: "2026-09-18",
  baseline: "2026-09-25",
};

export const useCycleStore = create<CycleStoreState>((set, get) => ({
  state: "empty",
  errorMessage: null,
  errorCode: null,
  activeTab: "board",

  cycleId: null,
  cycleName: "FY27 Annual Operating Budget",
  cycleKind: "budget",
  currentMilestone: "review",
  milestoneDates: DEFAULT_MILESTONE_DATES,

  tasks: [],
  tasksReady: false,

  contributors: DEFAULT_CONTRIBUTORS,
  conflicts: [],
  exportedFile: null,

  setActiveTab: (tab) => set({ activeTab: tab }),

  loadChecklist: async (modelId, periodId) => {
    set({ state: "loading", errorMessage: null, errorCode: null });
    try {
      const data = (await call("cycle.checklist.status", {
        model_id: modelId,
        period_id: periodId,
      })) as CycleChecklistStatusData;

      if (!data.cycle_id || data.tasks.length === 0) {
        set({
          state: "empty",
          cycleId: null,
          tasks: [],
          tasksReady: false,
        });
        return;
      }

      set({
        state: "populated",
        cycleId: data.cycle_id,
        tasks: data.tasks,
        tasksReady: data.ready,
      });
    } catch (raw) {
      const err = toBridgeError(raw);
      set({
        state: "error",
        errorMessage: err.userMessage,
        errorCode: err.code,
      });
    }
  },

  startCycle: async (modelId, kind, name, due) => {
    set({ state: "loading", errorMessage: null, errorCode: null });
    try {
      const data = (await call("cycle.start", {
        model_id: modelId,
        kind,
        name,
        due,
      })) as CycleStartData;

      set({
        state: "populated",
        cycleId: data.cycle_id,
        cycleName: name,
        cycleKind: kind,
        currentMilestone: "kickoff",
      });

      await get().loadChecklist(modelId);
      return true;
    } catch (raw) {
      const err = toBridgeError(raw);
      set({
        state: "error",
        errorMessage: err.userMessage,
        errorCode: err.code,
      });
      return false;
    }
  },

  updateTaskStatus: async (taskId, status, note) => {
    const prevTasks = get().tasks;
    try {
      await call("cycle.task.update", {
        task_id: taskId,
        status,
        note,
      });

      const updatedTasks = prevTasks.map((t) => (t.id === taskId ? { ...t, status } : t));
      const allDone = updatedTasks.length > 0 && updatedTasks.every((t) => t.status === "done");

      set({
        tasks: updatedTasks,
        tasksReady: allDone,
        state: "populated",
        errorMessage: null,
        errorCode: null,
      });
      return true;
    } catch (raw) {
      const err = toBridgeError(raw);
      set({
        state: "error",
        errorMessage: err.userMessage,
        errorCode: err.code,
      });
      return false;
    }
  },

  exportCollectionSheet: async (driverIds, template = "standard") => {
    const cycleId = get().cycleId ?? "pc-fy27-budget";
    try {
      const data = (await call("collection.export", {
        cycle_id: cycleId,
        driver_ids: driverIds,
        template,
      })) as CollectionExportData;

      set({ exportedFile: data.file });
      return true;
    } catch (raw) {
      const err = toBridgeError(raw);
      set({
        state: "error",
        errorMessage: err.userMessage,
        errorCode: err.code,
      });
      return false;
    }
  },

  importCollectionSheet: async (filePath, mappingId = "m-drivers-standard") => {
    const cycleId = get().cycleId ?? "pc-fy27-budget";
    try {
      const data = (await call("collection.import", {
        cycle_id: cycleId,
        file_path: filePath,
        mapping_id: mappingId,
      })) as CollectionImportData;

      set({
        conflicts: data.conflicts,
        state: "populated",
        errorMessage: null,
        errorCode: null,
      });
      return true;
    } catch (raw) {
      const err = toBridgeError(raw);
      set({
        state: "error",
        errorMessage: err.userMessage,
        errorCode: err.code,
      });
      return false;
    }
  },

  resolveConflict: async (conflictId, choice, note) => {
    try {
      await call("collection.resolve_conflict", {
        conflict_id: conflictId,
        choice,
        note,
      });

      const remainingConflicts = get().conflicts.filter((c) => c.id !== conflictId);
      set({
        conflicts: remainingConflicts,
        state: "populated",
        errorMessage: null,
        errorCode: null,
      });
      return true;
    } catch (raw) {
      const err = toBridgeError(raw);
      set({
        state: "error",
        errorMessage: err.userMessage,
        errorCode: err.code,
      });
      return false;
    }
  },

  advanceMilestone: (nextMilestone) => {
    set({ currentMilestone: nextMilestone });
  },

  reset: () => {
    set({
      state: "empty",
      cycleId: null,
      errorMessage: null,
      errorCode: null,
      tasks: [],
      tasksReady: false,
      conflicts: [],
      exportedFile: null,
    });
  },
}));
