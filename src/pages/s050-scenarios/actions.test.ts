import { describe, expect, it } from "vitest";
import { scenarioActions } from "./actions";
import type { ScenarioState } from "@/api/schema";

/**
 * Row-action legality per SCENARIO-VERSION-SPEC §1 transition table (S-050 UI hides illegal
 * actions; the core/mock stays the enforcement point). Duplicate is legal in EVERY state.
 */
describe("scenarioActions (S-050 · SCENARIO-VERSION-SPEC §1)", () => {
  it("Draft offers submit + duplicate, and delete only when no Version exists", () => {
    expect(
      scenarioActions("draft", { state: "draft", hasVersions: false, isBaseline: false }),
    ).toEqual(["submit", "duplicate", "delete"]);
    expect(
      scenarioActions("draft", { state: "draft", hasVersions: true, isBaseline: false }),
    ).toEqual(["submit", "duplicate"]);
  });

  it("Review offers approve + reopen (return-to-draft) + duplicate", () => {
    expect(
      scenarioActions("review", { state: "review", hasVersions: false, isBaseline: false }),
    ).toEqual(["approve", "duplicate", "reopen"]);
  });

  it("Approved offers lock + reopen + duplicate", () => {
    expect(
      scenarioActions("approved", { state: "approved", hasVersions: false, isBaseline: false }),
    ).toEqual(["lock", "duplicate", "reopen"]);
  });

  it("Locked non-Baseline offers set-baseline + duplicate + reopen", () => {
    expect(
      scenarioActions("locked", { state: "locked", hasVersions: true, isBaseline: false }),
    ).toEqual(["baseline", "duplicate", "reopen"]);
  });

  it("Locked Baseline is non-reopenable and already the Baseline — only duplicate remains", () => {
    expect(
      scenarioActions("locked", { state: "locked", hasVersions: true, isBaseline: true }),
    ).toEqual(["duplicate"]);
  });

  it("keeps the canonical action order stable across states", () => {
    for (const state of ["draft", "review", "approved", "locked"] as ScenarioState[]) {
      const actions = scenarioActions(state, {
        state,
        hasVersions: true,
        isBaseline: state === "locked",
      });
      expect(actions).toEqual([...actions].sort((a, b) => orderOf(a) - orderOf(b)));
    }
  });
});

const orderOf = (a: string): number =>
  ["submit", "approve", "lock", "baseline", "duplicate", "reopen", "delete"].indexOf(a);
