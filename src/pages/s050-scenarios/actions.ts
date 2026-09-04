/**
 * S-050 Scenario Manager — pure lifecycle-action logic (F-022 · SCENARIO-VERSION-SPEC §1).
 *
 * Decides which row actions are legal for a given Scenario state WITHOUT touching React or the
 * store, so the state machine is unit-testable on its own. The UI renders the returned actions
 * in this canonical order; the Rust core / dev mock remain the enforcement point (the UI only
 * hides actions the SPEC marks as illegal for the current state).
 */
import type { ScenarioState } from "@/api/schema";

export type ScenarioLifecycleAction =
  | "submit" //   Draft → Review
  | "approve" //  Review → Approved
  | "lock" //     Approved → Locked (auto-writes immutable Version vN)
  | "baseline" // Locked (non-baseline) → THE Baseline (baseline.set)
  | "duplicate" // any state → Draft copy of the Scenario's values
  | "reopen" //   Review/Approved/Locked(non-baseline) → Draft, written reason required
  | "delete"; //  Draft without Versions only (audited)

export interface ScenarioActionContext {
  /** The Scenario's current state (`ScenarioRow.state`). */
  state: ScenarioState;
  /** Whether the Scenario already has ≥1 immutable Version (append-only `scenario_versions`). */
  hasVersions: boolean;
  /** Whether this Scenario is currently THE Baseline of the Model/FY. */
  isBaseline: boolean;
}

/** Canonical display order — primary lifecycle actions first, then copy/reopen/delete. */
const ACTION_ORDER: ScenarioLifecycleAction[] = [
  "submit",
  "approve",
  "lock",
  "baseline",
  "duplicate",
  "reopen",
  "delete",
];

/** Rules mirror SCENARIO-VERSION-SPEC §1 transition table (S-050 row actions). */
const ALLOWED: Record<ScenarioState, (ctx: ScenarioActionContext) => ScenarioLifecycleAction[]> = {
  draft: (ctx) => {
    const actions: ScenarioLifecycleAction[] = ["submit"];
    if (!ctx.hasVersions) actions.push("delete");
    return actions;
  },
  review: () => ["approve", "reopen"],
  approved: () => ["lock", "reopen"],
  locked: (ctx) => {
    const actions: ScenarioLifecycleAction[] = [];
    if (!ctx.isBaseline) actions.push("baseline");
    if (!ctx.isBaseline) actions.push("reopen"); // Locked-Baseline is non-reopenable (SPEC §1)
    return actions;
  },
};

/**
 * Actions available for one Scenario row. `duplicate` is legal in EVERY state (a copy always
 * starts as a fresh Draft — SCENARIO-VERSION-SPEC §1 `[*] --> Draft`).
 */
export function scenarioActions(
  state: ScenarioState,
  ctx: ScenarioActionContext,
): ScenarioLifecycleAction[] {
  const allowed = new Set(ALLOWED[state](ctx));
  allowed.add("duplicate");
  return ACTION_ORDER.filter((a) => allowed.has(a));
}
