/**
 * S-053 Planning Cycle & Input Collection Page (F-021 · F-023 · M4-5 · M4-6 · SCREENS-SPEC S-053 · WIREFRAMES-ANALYTICS S-053).
 *
 * Layout:
 *   1. MILESTONE BAND: kickoff ── submit ── review ── approve ── baseline (dates, status).
 *   2. TABS: Status board · Close checklist (per-period tasks) · Input Collection.
 *   3. STATUS BOARD: contributors, submission stats, milestone approvals.
 *   4. CLOSE CHECKLIST: period close tasks, dependencies, completion toggles (`CYCLE_TASK_BLOCKED` handling).
 *   5. INPUT COLLECTION: export template, returned sheets, conflict resolution queue (`COLLECTION_CONFLICT`).
 *   6. FOOTSTRIP: 12/18 submitted · 2 conflicts · [Approve cycle] primary action.
 *
 * Screen states:
 *   - loading: skeleton/spinner
 *   - empty: "Start a planning cycle"
 *   - error: `CYCLE_TASK_BLOCKED`, `COLLECTION_CONFLICT`, `CYCLE_NAME_DUP`
 *   - success: timeline + checklist active
 *   - populated: tasks, contributors, statuses
 */

import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  Download,
  Upload,
  RefreshCw,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Button, Input, StatePanel } from "@/components/ui";
import { useCycleStore, type CycleMilestone } from "@/stores/cycle";
import { activeModelId } from "@/stores/model";
import { formatPercent } from "@/utils/money";

const MILESTONES: { key: CycleMilestone; label: string; desc: string }[] = [
  { key: "kickoff", label: "Kickoff", desc: "Targets set & model templates opened" },
  { key: "submit", label: "Submit", desc: "BU contributors submit departmental plans" },
  { key: "review", label: "Review", desc: "FP&A variance review & conflict resolution" },
  { key: "approve", label: "Approve", desc: "Executive sign-off & milestone review" },
  { key: "baseline", label: "Baseline", desc: "Cycle locked as frozen plan baseline" },
];

export default function S053PlanningCyclePage(): React.ReactElement {
  const {
    state,
    errorMessage,
    errorCode,
    activeTab,
    cycleName,
    cycleKind,
    currentMilestone,
    milestoneDates,
    tasks,
    tasksReady,
    contributors,
    conflicts,
    exportedFile,
    setActiveTab,
    loadChecklist,
    startCycle,
    updateTaskStatus,
    exportCollectionSheet,
    importCollectionSheet,
    resolveConflict,
    advanceMilestone,
  } = useCycleStore();

  const [selectedDriverIds] = useState<string[]>([
    "dr-sales-volume",
    "dr-price-per-unit",
    "dr-headcount",
  ]);
  const [newCycleModalOpen, setNewCycleModalOpen] = useState(false);
  const [newCycleName, setNewCycleName] = useState("FY28 Operating Plan");
  const [newCycleKind, setNewCycleKind] = useState<"budget" | "forecast" | "rolling">("budget");
  const [newCycleDue, setNewCycleDue] = useState("2026-12-15");

  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [activeConflictId, setActiveConflictId] = useState<string | null>(null);
  const [resolutionChoice, setResolutionChoice] = useState<"choose_a" | "choose_b" | "average">(
    "choose_a",
  );
  const [resolutionNote, setResolutionNote] = useState("");

  const modelId = activeModelId();

  useEffect(() => {
    if (state === "loading") {
      void loadChecklist(modelId);
    }
  }, [state, loadChecklist, modelId]);

  const handleStartCycleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await startCycle(modelId, newCycleKind, newCycleName, newCycleDue);
    if (ok) {
      setNewCycleModalOpen(false);
    }
  };

  const handleResolveConflictSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConflictId) return;
    const ok = await resolveConflict(activeConflictId, resolutionChoice, resolutionNote);
    if (ok) {
      setConflictModalOpen(false);
      setActiveConflictId(null);
      setResolutionNote("");
    }
  };

  const currentMilestoneIndex = MILESTONES.findIndex((m) => m.key === currentMilestone);

  const submittedCount = contributors.filter(
    (c) => c.status === "submitted" || c.status === "approved",
  ).length;
  const totalContributors = contributors.length;

  return (
    <div
      className="flex flex-col h-full bg-slate-50 text-slate-900"
      data-testid="s053-planning-cycle"
    >
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <header className="px-6 py-4 bg-white border-b border-slate-200 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-100 text-blue-800">
              S-053
            </span>
            <span className="text-xs font-medium text-slate-500 uppercase">{cycleKind} Cycle</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-1">{cycleName}</h1>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => setNewCycleModalOpen(true)}>
            + New Cycle
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => loadChecklist(modelId)}
            aria-label="Refresh cycle status"
          >
            <RefreshCw className="w-4 h-4 mr-1.5" />
            Refresh
          </Button>
        </div>
      </header>

      {/* ── Error Banner (shown during interactive actions in populated view) ── */}
      {errorMessage && state !== "error" && (
        <div
          role="alert"
          className="mx-6 mt-4 p-3.5 rounded-lg border border-red-200 bg-red-50 text-red-800 flex items-start gap-2.5"
        >
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold text-sm">{errorCode ? `[${errorCode}] ` : ""}</span>
            <span className="text-sm">{errorMessage}</span>
          </div>
        </div>
      )}

      {/* ── Milestone Timeline Band ─────────────────────────────────── */}
      <section
        aria-label="Planning Cycle Milestones"
        className="px-6 py-3.5 bg-white border-b border-slate-200"
      >
        <ol className="flex items-center justify-between max-w-4xl mx-auto">
          {MILESTONES.map((m, idx) => {
            const isCompleted = idx < currentMilestoneIndex;
            const isCurrent = idx === currentMilestoneIndex;

            return (
              <li key={m.key} className="flex items-center gap-3 flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => advanceMilestone(m.key)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-xs border transition-colors ${
                      isCompleted
                        ? "bg-green-600 border-green-600 text-white"
                        : isCurrent
                          ? "bg-blue-600 border-blue-600 text-white ring-4 ring-blue-100"
                          : "bg-slate-100 border-slate-300 text-slate-500"
                    }`}
                    aria-label={`Milestone: ${m.label} (${m.desc})`}
                    aria-current={isCurrent ? "step" : undefined}
                  >
                    {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                  </button>
                  <span className="text-xs font-medium text-slate-900 mt-1">{m.label}</span>
                  <span className="text-[10px] text-slate-500">{milestoneDates[m.key]}</span>
                </div>
                {idx < MILESTONES.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 ${
                      idx < currentMilestoneIndex ? "bg-green-600" : "bg-slate-200"
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* ── Tab Navigation ──────────────────────────────────────────── */}
      <nav
        aria-label="Planning cycle sections"
        className="px-6 pt-3 bg-white border-b border-slate-200"
      >
        <div
          role="tablist"
          aria-label="Planning cycle views"
          className="flex gap-6 text-sm font-medium"
        >
          <button
            role="tab"
            id="tab-board"
            aria-selected={activeTab === "board"}
            aria-controls="panel-board"
            onClick={() => setActiveTab("board")}
            className={`pb-3 border-b-2 transition-colors ${
              activeTab === "board"
                ? "border-blue-600 text-blue-600 font-semibold"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            Status Board
          </button>
          <button
            role="tab"
            id="tab-checklist"
            aria-selected={activeTab === "checklist"}
            aria-controls="panel-checklist"
            onClick={() => setActiveTab("checklist")}
            className={`pb-3 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "checklist"
                ? "border-blue-600 text-blue-600 font-semibold"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            Close Checklist
            <span
              className={`text-xs px-1.5 py-0.2 rounded-full ${
                tasksReady ? "bg-green-100 text-green-800" : "bg-slate-200 text-slate-700"
              }`}
            >
              {tasks.filter((t) => t.status === "done").length}/{tasks.length}
            </span>
          </button>
          <button
            role="tab"
            id="tab-collection"
            aria-selected={activeTab === "collection"}
            aria-controls="panel-collection"
            onClick={() => setActiveTab("collection")}
            className={`pb-3 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "collection"
                ? "border-blue-600 text-blue-600 font-semibold"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            Input Collection
            {conflicts.length > 0 && (
              <span className="text-xs px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 font-semibold">
                {conflicts.length} conflict{conflicts.length > 1 ? "s" : ""}
              </span>
            )}
          </button>
        </div>
      </nav>

      {/* ── Main Content Area ───────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-6">
        {state === "loading" && (
          <StatePanel
            state="loading"
            message="Evaluating close checklist tasks, contributor progress, and driver collection state..."
          />
        )}

        {state === "empty" && (
          <StatePanel
            state="empty"
            message="Start a new planning cycle to coordinate departmental submissions, close tasks, and driver collection."
            actionLabel="Start a planning cycle"
            onAction={() => setNewCycleModalOpen(true)}
          />
        )}

        {state === "error" && (
          <StatePanel
            state="error"
            message={
              errorMessage || "An unexpected error occurred while loading planning cycle details."
            }
            errorCode={errorCode || undefined}
            onRetry={() => loadChecklist(modelId)}
          />
        )}

        {state === "success" && (
          <StatePanel
            state="success"
            message="All close tasks verified and departmental submissions baseline locked."
          >
            <Button size="sm" onClick={() => setActiveTab("board")}>
              View Status Board
            </Button>
          </StatePanel>
        )}

        {state === "populated" && (
          <>
            {/* ── Tab 1: Status Board ─────────────────────────────────── */}
            {activeTab === "board" && (
              <div
                role="tabpanel"
                id="panel-board"
                aria-labelledby="tab-board"
                className="space-y-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-sm">
                    <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase">
                      <span>Contributors Submitted</span>
                      <Users className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="text-2xl font-bold text-slate-900 mt-2">
                      {submittedCount} / {totalContributors}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {totalContributors > 0
                        ? formatPercent(submittedCount / totalContributors, 0, false)
                        : "0%"}{" "}
                      departmental compliance
                    </div>
                  </div>

                  <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-sm">
                    <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase">
                      <span>Checklist Completion</span>
                      <ShieldCheck className="w-4 h-4 text-green-600" />
                    </div>
                    <div className="text-2xl font-bold text-slate-900 mt-2">
                      {tasks.filter((t) => t.status === "done").length} / {tasks.length}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {tasksReady ? "All close gates passed" : "Predecessor tasks outstanding"}
                    </div>
                  </div>

                  <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-sm">
                    <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase">
                      <span>Collection Conflicts</span>
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="text-2xl font-bold text-slate-900 mt-2">{conflicts.length}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      {conflicts.length === 0
                        ? "No active driver collisions"
                        : "Resolution required before approve"}
                    </div>
                  </div>
                </div>

                {/* Contributors table */}
                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
                    <h2 className="text-sm font-semibold text-slate-900">
                      Departmental Contributors
                    </h2>
                    <span className="text-xs text-slate-500">4 active reporting entities</span>
                  </div>
                  <table
                    className="w-full text-left text-sm"
                    aria-label="Departmental contributors"
                  >
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold border-b border-slate-200">
                      <tr>
                        <th className="px-5 py-3">Contributor</th>
                        <th className="px-5 py-3">Business Unit</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3 text-right">Submitted At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {contributors.map((cnt) => (
                        <tr key={cnt.id} className="hover:bg-slate-50/60">
                          <td className="px-5 py-3 font-medium text-slate-900">{cnt.name}</td>
                          <td className="px-5 py-3 text-slate-600">{cnt.business_unit}</td>
                          <td className="px-5 py-3">
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                cnt.status === "approved"
                                  ? "bg-green-100 text-green-800"
                                  : cnt.status === "submitted"
                                    ? "bg-blue-100 text-blue-800"
                                    : cnt.status === "conflict"
                                      ? "bg-amber-100 text-amber-800"
                                      : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {cnt.status}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right text-xs text-slate-500">
                            {cnt.last_submitted_at
                              ? new Date(cnt.last_submitted_at).toLocaleDateString()
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Tab 2: Close Checklist ──────────────────────────────── */}
            {activeTab === "checklist" && (
              <div
                role="tabpanel"
                id="panel-checklist"
                aria-labelledby="tab-checklist"
                className="space-y-4"
              >
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-sm flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold">Period Close Sequencing Invariants</h3>
                    <p className="text-xs text-blue-800 mt-0.5">
                      Tasks must be resolved in strict dependency order. Attempting to complete a
                      task before its predecessors are marked done surfaces{" "}
                      <code className="font-mono">CYCLE_TASK_BLOCKED</code>.
                    </p>
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-slate-200 shadow-sm divide-y divide-slate-200">
                  {tasks.map((task) => {
                    const isDone = task.status === "done";
                    const isBlocked = task.status === "blocked";

                    return (
                      <div
                        key={task.id}
                        className="p-4 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
                      >
                        <div className="flex items-center gap-3.5">
                          <button
                            type="button"
                            onClick={() => updateTaskStatus(task.id, isDone ? "pending" : "done")}
                            className={`w-6 h-6 rounded border flex items-center justify-center transition-colors ${
                              isDone
                                ? "bg-green-600 border-green-600 text-white"
                                : "border-slate-300 hover:border-slate-400 bg-white"
                            }`}
                            aria-label={`Toggle task completion: ${task.title}`}
                          >
                            {isDone && <CheckCircle2 className="w-4 h-4" />}
                          </button>
                          <div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-sm font-semibold ${isDone ? "line-through text-slate-400" : "text-slate-900"}`}
                              >
                                {task.title}
                              </span>
                              {task.depends_on_id && (
                                <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                  depends on previous
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                              <span>Owner: {task.owner}</span>
                              {task.due_date && <span>Due: {task.due_date}</span>}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              isDone
                                ? "bg-green-100 text-green-800"
                                : isBlocked
                                  ? "bg-red-100 text-red-800"
                                  : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {task.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Tab 3: Input Collection ─────────────────────────────── */}
            {activeTab === "collection" && (
              <div
                role="tabpanel"
                id="panel-collection"
                aria-labelledby="tab-collection"
                className="space-y-6"
              >
                {/* Actions banner */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                        <Download className="w-4 h-4 text-blue-600" />
                        Export Collection Template
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Distribute standardized CSV templates containing current driver lines and
                        horizons to BU contributors.
                      </p>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => exportCollectionSheet(selectedDriverIds, "standard")}
                      >
                        Export Template (.csv)
                      </Button>
                      {exportedFile && (
                        <span className="text-xs text-green-700 font-medium truncate max-w-[200px]">
                          ✓ {exportedFile}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                        <Upload className="w-4 h-4 text-blue-600" />
                        Ingest Returned Sheet
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Upload completed collection workbook. Automated validation checks structure
                        and detects driver collisions.
                      </p>
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => importCollectionSheet("collection_return_clean.xlsx")}
                      >
                        Upload Sheet
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => importCollectionSheet("collection_return_conflict.xlsx")}
                      >
                        Upload (Simulate Conflict)
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Conflict queue */}
                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      <h2 className="text-sm font-semibold text-slate-900">
                        Driver Conflict Resolution Queue
                      </h2>
                    </div>
                    <span className="text-xs text-slate-500">{conflicts.length} unresolved</span>
                  </div>

                  {conflicts.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-sm">
                      <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
                      No driver value conflicts detected. All contributor submissions reconcile
                      cleanly.
                    </div>
                  ) : (
                    <table className="w-full text-left text-sm" aria-label="Driver conflict queue">
                      <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold border-b border-slate-200">
                        <tr>
                          <th className="px-5 py-3">Driver</th>
                          <th className="px-5 py-3">Period</th>
                          <th className="px-5 py-3">Contributor A</th>
                          <th className="px-5 py-3">Contributor B</th>
                          <th className="px-5 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {conflicts.map((conf) => (
                          <tr key={conf.id} className="hover:bg-slate-50/60">
                            <td className="px-5 py-3 font-semibold text-slate-900">
                              {conf.driver_name}
                            </td>
                            <td className="px-5 py-3 text-slate-600 font-mono text-xs">
                              {conf.period_id}
                            </td>
                            <td className="px-5 py-3">
                              <div className="text-xs font-medium text-slate-900">
                                {conf.contributor_a}
                              </div>
                              <div className="text-xs text-slate-600 font-mono mt-0.5">
                                {conf.value_a}
                              </div>
                            </td>
                            <td className="px-5 py-3">
                              <div className="text-xs font-medium text-slate-900">
                                {conf.contributor_b}
                              </div>
                              <div className="text-xs text-slate-600 font-mono mt-0.5">
                                {conf.value_b}
                              </div>
                            </td>
                            <td className="px-5 py-3 text-right">
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => {
                                  setActiveConflictId(conf.id);
                                  setConflictModalOpen(true);
                                }}
                              >
                                Resolve
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Footstrip ───────────────────────────────────────────────── */}
      <footer className="px-6 py-3 bg-white border-t border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <span>
            <strong>
              {submittedCount} / {totalContributors}
            </strong>{" "}
            departmental plans submitted
          </span>
          <span>•</span>
          <span>
            <strong>{conflicts.length}</strong> conflicts pending
          </span>
          <span>•</span>
          <span>
            Checklist: <strong>{tasksReady ? "All Done" : "In Progress"}</strong>
          </span>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            disabled={!tasksReady || conflicts.length > 0}
            onClick={() => advanceMilestone("approve")}
          >
            Approve Cycle
          </Button>
        </div>
      </footer>

      {/* ── Modal: Start New Planning Cycle ─────────────────────────── */}
      {newCycleModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title-cycle"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 id="modal-title-cycle" className="text-base font-bold text-slate-900">
                Start Planning Cycle
              </h3>
              <button
                type="button"
                onClick={() => setNewCycleModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleStartCycleSubmit} className="space-y-4 mt-4">
              <div>
                <Input
                  id="cycle-name"
                  label="Cycle Name"
                  value={newCycleName}
                  onChange={(e) => setNewCycleName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="cycle-kind"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Cycle Kind
                </label>
                <select
                  id="cycle-kind"
                  value={newCycleKind}
                  onChange={(e) =>
                    setNewCycleKind(e.target.value as "budget" | "forecast" | "rolling")
                  }
                  className="w-full text-sm border border-slate-300 rounded px-3 py-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="budget">Annual Operating Budget</option>
                  <option value="forecast">Quarterly Forecast</option>
                  <option value="rolling">Rolling Horizon Plan</option>
                </select>
              </div>

              <div>
                <Input
                  id="cycle-due"
                  label="Due Date (UTC)"
                  type="date"
                  value={newCycleDue}
                  onChange={(e) => setNewCycleDue(e.target.value)}
                  required
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setNewCycleModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm">
                  Initialize Cycle
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Conflict Resolution ──────────────────────────────── */}
      {conflictModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title-conflict"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 id="modal-title-conflict" className="text-base font-bold text-slate-900">
                Resolve Driver Conflict
              </h3>
              <button
                type="button"
                onClick={() => setConflictModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {(() => {
              const activeConflict =
                conflicts.find((c) => c.id === activeConflictId) ?? conflicts[0];
              const contribA = activeConflict?.contributor_a ?? "Contributor A";
              const valA = activeConflict?.value_a ?? "—";
              const contribB = activeConflict?.contributor_b ?? "Contributor B";
              const valB = activeConflict?.value_b ?? "—";

              return (
                <form onSubmit={handleResolveConflictSubmit} className="space-y-4 mt-4">
                  <p className="text-xs text-slate-600">
                    Choose authoritative value or calculate average. All resolutions write an
                    HMAC-chained audit entry.
                  </p>

                  <div className="space-y-2">
                    <label
                      htmlFor="res-choice-a"
                      className="flex items-center gap-3 p-3 rounded border border-slate-200 cursor-pointer hover:bg-slate-50"
                    >
                      <input
                        id="res-choice-a"
                        type="radio"
                        name="resolution"
                        value="choose_a"
                        checked={resolutionChoice === "choose_a"}
                        onChange={() => setResolutionChoice("choose_a")}
                      />
                      Accept {contribA} (Value: {valA})
                    </label>

                    <label
                      htmlFor="res-choice-b"
                      className="flex items-center gap-3 p-3 rounded border border-slate-200 cursor-pointer hover:bg-slate-50"
                    >
                      <input
                        id="res-choice-b"
                        type="radio"
                        name="resolution"
                        value="choose_b"
                        checked={resolutionChoice === "choose_b"}
                        onChange={() => setResolutionChoice("choose_b")}
                      />
                      Accept {contribB} (Value: {valB})
                    </label>

                    <label
                      htmlFor="res-choice-avg"
                      className="flex items-center gap-3 p-3 rounded border border-slate-200 cursor-pointer hover:bg-slate-50"
                    >
                      <input
                        id="res-choice-avg"
                        type="radio"
                        name="resolution"
                        value="average"
                        checked={resolutionChoice === "average"}
                        onChange={() => setResolutionChoice("average")}
                      />
                      Calculate Exact Decimal Average (Auto-computed)
                    </label>
                  </div>

                  <div>
                    <Input
                      id="resolution-note"
                      label="Resolution Note / Governance Rationale"
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                      placeholder="Rationale recorded to audit log..."
                    />
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setConflictModalOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary" size="sm">
                      Apply Resolution
                    </Button>
                  </div>
                </form>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
