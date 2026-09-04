import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { ScenariosPage } from "./index";
import { useScenarioStore } from "@/stores/scenarios";
import { useSessionStore } from "@/stores/session";
import { WORKING_MODEL_ID, WORKING_SCENARIO_ID } from "@/stores/model";
import type { ScenarioRow, ScenarioVersionRow } from "@/api/schema";

/**
 * S-050 page against the REAL scenario store with a scripted bridge (same pattern as the grid
 * page tests): the fake core below runs the SCENARIO-VERSION-SPEC §1 state machine on a local
 * fixture list, so the store's subscriptions/re-renders and typed-error paths are all exercised.
 */

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const CO = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";
const SC_A = WORKING_SCENARIO_ID; // seeded Draft "Base"
const SC_R = "3f9f2c9e-9f8b-4e2d-9a1c-400000000101"; // Review
const SC_AP = "3f9f2c9e-9f8b-4e2d-9a1c-400000000102"; // Approved
const SC_LB = "3f9f2c9e-9f8b-4e2d-9a1c-400000000103"; // Locked + Baseline
const SC_LO = "3f9f2c9e-9f8b-4e2d-9a1c-400000000104"; // Locked, not Baseline

function row(overrides: Partial<ScenarioRow>): ScenarioRow {
  return {
    id: SC_A,
    model_id: WORKING_MODEL_ID,
    name: "Base",
    kind: "budget",
    state: "draft",
    parent_scenario_id: null,
    baseline: false,
    versions: [],
    ...overrides,
  };
}

const V1: ScenarioVersionRow = {
  id: "5c4f1a2b-9d3e-4c7a-8b2f-100000000001",
  scenario_id: SC_LB,
  version_no: 1,
  label: "v1",
  reason: null,
  created_at: "2026-02-01T00:00:00.000Z",
};

/** Fresh, deterministic fixture list (reset per test). */
function seedScenarios() {
  return [
    row({ id: SC_A, name: "Base", kind: "budget", state: "draft" }),
    row({
      id: SC_R,
      name: "FY26 Plan v2",
      kind: "forecast",
      state: "review",
      parent_scenario_id: SC_A,
    }),
    row({ id: SC_AP, name: "Budget v1", kind: "budget", state: "approved" }),
    row({
      id: SC_LB,
      name: "Budget Locked",
      kind: "budget",
      state: "locked",
      baseline: true,
      versions: [V1],
    }),
    row({ id: SC_LO, name: "Stretch", kind: "whatif", state: "locked", versions: [V1] }),
  ];
}

let scenarios: ReturnType<typeof seedScenarios>;
let commandCalls: { command: string; args: Record<string, unknown> }[];

function bridgeError(code: string, userMessage: string, httpStatus = 409) {
  return Promise.reject({
    code,
    userMessage,
    httpStatus,
    retryable: false,
    retryAfterMs: null,
    details: {},
  });
}

/** Scripted core mirroring mock.ts / SCENARIO-VERSION-SPEC §1 for the command surface. */
function installCore() {
  callMock.mockImplementation((command: string, args: Record<string, unknown>) => {
    commandCalls.push({ command, args });
    const find = (id: string) => scenarios.find((s) => s.id === id);
    switch (command) {
      case "model.list": {
        return Promise.resolve([
          {
            id: WORKING_MODEL_ID,
            company_id: CO,
            name: "Working Model",
            horizon: 1,
            pack_id: null,
            scenarios: scenarios.map((s) => ({
              ...s,
              versions: s.versions.map((v) => ({ ...v })),
            })),
          },
        ]);
      }
      case "scenario.create":
      case "scenario.duplicate": {
        const { name, base_id } = args as { name?: string; base_id?: string };
        const base = base_id ? find(base_id) : undefined;
        const kind = base?.kind ?? "budget";
        // Mirror mock.ts: a blank name becomes "Base" (create) or a unique "<name> (copy)".
        const finalName = name ?? (base ? uniqueCopy(base.name) : "Base");
        if (scenarios.some((s) => s.name === finalName))
          return bridgeError("SCENARIO_NAME_DUP", "A Scenario with this name already exists.");
        const id = `3f9f2c9e-9f8b-4e2d-9a1c-5000000000${String(10 + scenarios.length)}`;
        scenarios.push(
          row({
            id,
            name: finalName,
            kind,
            state: "draft",
            parent_scenario_id: base?.id ?? null,
          }),
        );
        return Promise.resolve({ scenario_id: id, version_id: null });
      }
      case "scenario.submit": {
        const s = find(args.scenario_id as string);
        if (!s || s.state !== "draft")
          return bridgeError(
            "SCENARIO_LOCK_CONFLICT",
            `This Scenario is already in ${s?.state} — cannot transition.`,
          );
        s.state = "review";
        return Promise.resolve({ scenario_id: s.id, version_id: null });
      }
      case "scenario.approve": {
        const s = find(args.scenario_id as string);
        if (!s || s.state !== "review")
          return bridgeError(
            "SCENARIO_LOCK_CONFLICT",
            `This Scenario is already in ${s?.state} — cannot transition.`,
          );
        s.state = "approved";
        return Promise.resolve({ scenario_id: s.id, version_id: null });
      }
      case "scenario.lock": {
        const s = find(args.scenario_id as string);
        if (!s || s.state !== "approved")
          return bridgeError(
            "SCENARIO_LOCK_CONFLICT",
            `This Scenario is already in ${s?.state} — cannot transition.`,
          );
        s.state = "locked";
        s.versions = [
          ...s.versions,
          {
            id: V1.id,
            scenario_id: s.id,
            version_no: s.versions.length + 1,
            label: `v${s.versions.length + 1}`,
            reason: null,
            created_at: "2026-03-02T00:00:00.000Z",
          },
        ];
        return Promise.resolve({ scenario_id: s.id, version_id: V1.id });
      }
      case "scenario.reopen": {
        const s = find(args.scenario_id as string);
        const reason = args.reason as string | undefined;
        if (!s || s.state === "draft" || (s.state === "locked" && s.baseline))
          return bridgeError(
            "SCENARIO_LOCK_CONFLICT",
            `This Scenario is already in ${s?.state} — cannot transition.`,
          );
        if (!reason || !reason.trim())
          return bridgeError(
            "VALUE_INVALID",
            "A written reason is required to reopen a Scenario.",
            422,
          );
        s.state = "draft";
        return Promise.resolve({ scenario_id: s.id, version_id: null });
      }
      case "scenario.delete": {
        const s = find(args.scenario_id as string);
        if (!s || s.state !== "draft" || s.versions.length > 0)
          return bridgeError(
            "SCENARIO_LOCK_CONFLICT",
            `This Scenario is already in ${s?.state} — cannot transition.`,
          );
        scenarios = scenarios.filter((x) => x.id !== s.id);
        return Promise.resolve({ scenario_id: s.id, version_id: null });
      }
      case "baseline.set": {
        const s = find(args.scenario_id as string);
        const reason = args.reason as string | undefined;
        if (!s || s.state !== "locked")
          return bridgeError(
            "SCENARIO_LOCK_CONFLICT",
            `This Scenario is already in ${s?.state} — cannot transition.`,
          );
        const current = scenarios.find((x) => x.baseline && x.id !== s.id);
        if (current && (!reason || !reason.trim()))
          return bridgeError(
            "BASELINE_REPLACE_REASON_REQUIRED",
            "Replacing the baseline requires a written reason.",
            422,
          );
        for (const x of scenarios) x.baseline = false;
        s.baseline = true;
        return Promise.resolve({
          baseline_version_id: s.versions[s.versions.length - 1]?.id ?? s.id,
        });
      }
      default:
        return Promise.resolve({});
    }
  });
}

function uniqueCopy(name: string): string {
  let candidate = `${name} (copy)`;
  let n = 1;
  while (scenarios.some((s) => s.name === candidate)) candidate = `${name} (copy ${++n})`;
  return candidate;
}

function renderPage() {
  return render(
    <main>
      <ScenariosPage />
    </main>,
  );
}

/** Wait until the seeded scenario table (5 data rows + header) has rendered. */
async function waitForList(): Promise<void> {
  await waitFor(() => {
    expect(screen.getAllByRole("row").length).toBeGreaterThanOrEqual(6);
  });
}

/** Find a data row whose first (Scenario name) cell starts with `name` (badges may follow). */
function rowWith(name: string): HTMLElement {
  const row = screen
    .getAllByRole("row")
    .find((r) => r.querySelector("td")?.textContent?.trim().startsWith(name) === true);
  if (!row) throw new Error(`row not found: ${name}`);
  return row;
}

/** True while a data row with the given first-cell name is present (header row ignored). */
function hasRow(name: string): boolean {
  return screen
    .getAllByRole("row")
    .some((r) => r.querySelector("td")?.textContent?.trim().startsWith(name) === true);
}

describe("S-050 Scenario Manager (F-022)", () => {
  beforeEach(() => {
    callMock.mockReset();
    commandCalls = [];
    scenarios = seedScenarios();
    useSessionStore.setState({ companyId: CO, modelId: WORKING_MODEL_ID });
    useScenarioStore.setState({ status: "loading", error: null, models: [], scenarios: [] });
    installCore();
  });

  it("renders the loading state while model.list is in flight", () => {
    callMock.mockImplementation((cmd: string) =>
      cmd === "model.list" ? new Promise(() => undefined) : Promise.resolve({}),
    );
    renderPage();
    expect(screen.getByRole("heading", { name: "Scenario Manager" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders the error state with the typed code and a working Retry", async () => {
    callMock.mockImplementation((cmd: string) =>
      cmd === "model.list"
        ? Promise.reject({
            code: "FILE_CORRUPT",
            userMessage: "This Company file could not be read.",
            httpStatus: 500,
            retryable: true,
            retryAfterMs: null,
            details: {},
          })
        : Promise.resolve({}),
    );
    renderPage();
    expect(await screen.findByText("This Company file could not be read.")).toBeInTheDocument();
    expect(screen.getByText("FILE_CORRUPT")).toBeInTheDocument();

    installCore();
    await userEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await waitForList();
    expect(screen.getByText("Budget v1")).toBeInTheDocument();
  }, 10_000);

  it("renders the empty state with a Create Base action that seeds the list", async () => {
    scenarios = [];
    installCore();
    renderPage();
    expect(
      await screen.findByText(/No Scenarios yet — create the Base Budget to start planning/),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Create Base scenario" }));
    expect(commandCalls).toContainEqual({ command: "scenario.create", args: expect.any(Object) });
    expect(await screen.findByText("Scenario “Base” created.")).toBeInTheDocument();
    await waitFor(() => expect(hasRow("Base")).toBe(true));
  });

  it("renders the empty no-Company state without the create action", async () => {
    useSessionStore.setState({ companyId: null });
    scenarios = [];
    installCore();
    renderPage();
    expect(await screen.findByText("Open a Company to manage Scenarios.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Base scenario" })).not.toBeInTheDocument();
  });

  it("renders every Scenario row with state/kind/versions/baseline cells", async () => {
    renderPage();
    await waitForList();
    expect(screen.getByText("FY26 Plan v2")).toBeInTheDocument();
    expect(screen.getByText("Budget Locked")).toBeInTheDocument();
    // State chips (text labels — colour is never the only signal, B11).
    for (const label of ["Draft", "Review", "Approved", "Locked"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    // Type chips + baseline marker + version chips.
    expect(screen.getByText("What-if")).toBeInTheDocument();
    expect(screen.getAllByText("Baseline").length).toBeGreaterThan(0);
    expect(screen.getAllByText("v1").length).toBeGreaterThan(0);
    // Per-state row actions: draft rows show Submit, review rows Approve, approved rows Lock,
    // locked-Baseline rows show only Duplicate.
    expect(within(rowWith("Base")).getByRole("button", { name: "Submit" })).toBeInTheDocument();
    expect(
      within(rowWith("FY26 Plan v2")).getByRole("button", { name: "Approve" }),
    ).toBeInTheDocument();
    expect(within(rowWith("Budget v1")).getByRole("button", { name: "Lock" })).toBeInTheDocument();
    expect(
      within(rowWith("Stretch")).getByRole("button", { name: "Set baseline" }),
    ).toBeInTheDocument();
    expect(
      within(rowWith("Budget Locked")).queryByRole("button", { name: "Set baseline" }),
    ).not.toBeInTheDocument();
    expect(
      within(rowWith("Budget Locked")).queryByRole("button", { name: "Reopen" }),
    ).not.toBeInTheDocument();
    expect(
      within(rowWith("Budget Locked")).getByRole("button", { name: "Duplicate" }),
    ).toBeInTheDocument();
  });

  it("submits a Draft immediately and reports the transition", async () => {
    renderPage();
    await waitForList();
    await userEvent.click(within(rowWith("Base")).getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Scenario “Base” submitted for review.")).toBeInTheDocument();
    expect(commandCalls).toContainEqual({
      command: "scenario.submit",
      args: { scenario_id: SC_A },
    });
    // The refreshed list shows the row as Review.
    await waitFor(() => expect(within(rowWith("Base")).getByText("Review")).toBeInTheDocument());
  });

  it("surfaces a submit failure inline as a typed alert", async () => {
    renderPage();
    await waitForList();
    // Wrap the installed core so only scenario.submit rejects (SCENARIO_LOCK_CONFLICT copy).
    const core = callMock.getMockImplementation();
    if (!core) throw new Error("core not installed");
    callMock.mockImplementation((cmd: string, args: Record<string, unknown>) =>
      cmd === "scenario.submit"
        ? bridgeError(
            "SCENARIO_LOCK_CONFLICT",
            "This Scenario is already in draft — cannot transition.",
          )
        : core(cmd, args),
    );
    await userEvent.click(within(rowWith("Base")).getByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This Scenario is already in draft — cannot transition.",
    );
    // The local list is unchanged (no optimistic mutation).
    expect(within(rowWith("Base")).getByText("Draft")).toBeInTheDocument();
  });

  it("locks an Approved Scenario through the D-004 type-to-confirm dialog and writes a Version", async () => {
    renderPage();
    await screen.findByText("Budget v1");
    await userEvent.click(within(rowWith("Budget v1")).getByRole("button", { name: "Lock" }));
    const dialog = await screen.findByRole("dialog", { name: "Lock Scenario" });
    // Two-step: the confirm button stays disabled until the exact name is typed.
    expect(within(dialog).getByRole("button", { name: "Lock" })).toBeDisabled();
    await userEvent.type(
      within(dialog).getByLabelText("Type the Scenario name to confirm"),
      "Budget v1",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Lock" }));
    expect(
      await screen.findByText("Scenario “Budget v1” locked — Version written."),
    ).toBeInTheDocument();
    expect(commandCalls).toContainEqual({ command: "scenario.lock", args: { scenario_id: SC_AP } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(within(rowWith("Budget v1")).getAllByText(/v1/).length).toBeGreaterThan(0),
    );
  });

  it("deletes a Draft only after the D-004 typed confirmation", async () => {
    renderPage();
    await waitForList();
    await userEvent.click(within(rowWith("Base")).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Scenario" });
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeDisabled();
    await userEvent.type(
      within(dialog).getByLabelText("Type the Scenario name to confirm"),
      "Base",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Scenario “Base” deleted.")).toBeInTheDocument();
    expect(commandCalls).toContainEqual({
      command: "scenario.delete",
      args: { scenario_id: SC_A },
    });
    await waitFor(() => expect(hasRow("Base")).toBe(false));
  });

  it("reopens a Review Scenario and requires a written reason", async () => {
    renderPage();
    await screen.findByText("FY26 Plan v2");
    await userEvent.click(within(rowWith("FY26 Plan v2")).getByRole("button", { name: "Reopen" }));
    const dialog = await screen.findByRole("dialog", { name: "Reopen Scenario" });
    // Empty reason → inline validation, no command.
    await userEvent.click(within(dialog).getByRole("button", { name: "Reopen" }));
    expect(
      await within(dialog).findByText("A written reason is required to reopen this Scenario."),
    ).toBeInTheDocument();
    expect(commandCalls.some((c) => c.command === "scenario.reopen")).toBe(false);

    await userEvent.type(within(dialog).getByLabelText("Reason"), "restate FX assumptions");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reopen" }));
    expect(commandCalls).toContainEqual({
      command: "scenario.reopen",
      args: { scenario_id: SC_R, reason: "restate FX assumptions" },
    });
    await waitFor(() =>
      expect(within(rowWith("FY26 Plan v2")).getByText("Draft")).toBeInTheDocument(),
    );
  });

  it("duplicates a Scenario into a fresh Draft", async () => {
    renderPage();
    await waitForList();
    await userEvent.click(within(rowWith("Stretch")).getByRole("button", { name: "Duplicate" }));
    const dialog = await screen.findByRole("dialog", { name: "Duplicate Scenario" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Duplicate" }));
    expect(commandCalls).toContainEqual({
      command: "scenario.duplicate",
      args: expect.objectContaining({ base_id: SC_LO, name: undefined }),
    });
    expect(await screen.findByText("Scenario “Stretch (copy)” duplicated.")).toBeInTheDocument();
    await waitFor(() => expect(hasRow("Stretch (copy)")).toBe(true));
  });

  it("sets a Locked non-Baseline Scenario as THE Baseline", async () => {
    // No Baseline exists yet → the reason-free Set-baseline path (mutate before the page loads).
    scenarios.find((s) => s.id === SC_LB)!.baseline = false;
    renderPage();
    await waitForList();
    await userEvent.click(within(rowWith("Stretch")).getByRole("button", { name: "Set baseline" }));
    const dialog = await screen.findByRole("dialog", { name: "Set as Baseline" });
    // First baseline — reason optional; submit enabled.
    await userEvent.click(within(dialog).getByRole("button", { name: "Set baseline" }));
    expect(commandCalls).toContainEqual({ command: "baseline.set", args: { scenario_id: SC_LO } });
    expect(await screen.findByText("Scenario “Stretch” is now the Baseline.")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(rowWith("Stretch")).getAllByText("Baseline").length).toBeGreaterThan(0),
    );
  });

  it("requires a written reason when replacing the current Baseline", async () => {
    renderPage();
    await screen.findByText("Stretch");
    await userEvent.click(within(rowWith("Stretch")).getByRole("button", { name: "Set baseline" }));
    const dialog = await screen.findByRole("dialog", { name: "Set as Baseline" });
    // The warning names the current Baseline; an empty submit is blocked client-side.
    expect(
      await within(dialog).findByText(/Replacing the current Baseline “Budget Locked”/),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Set baseline" }));
    expect(
      await within(dialog).findByText("Replacing the baseline requires a written reason."),
    ).toBeInTheDocument();
    expect(commandCalls.some((c) => c.command === "baseline.set")).toBe(false);

    await userEvent.type(within(dialog).getByLabelText("Reason"), "Board approved new budget");
    await userEvent.click(within(dialog).getByRole("button", { name: "Set baseline" }));
    expect(commandCalls).toContainEqual({
      command: "baseline.set",
      args: { scenario_id: SC_LO, reason: "Board approved new budget" },
    });
  });

  it("creates a Scenario through the New dialog and validates a blank name without a copy source", async () => {
    renderPage();
    await waitForList();
    await userEvent.click(screen.getByRole("button", { name: "New Scenario" }));
    const dialog = await screen.findByRole("dialog", { name: "New Scenario" });
    // Existing scenarios → a blank name with no copy source is caught up front.
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(
      await within(dialog).findByText("A name is required when no copy source is selected."),
    ).toBeInTheDocument();
    expect(commandCalls.some((c) => c.command === "scenario.create")).toBe(false);

    await userEvent.type(within(dialog).getByLabelText("Name"), "Q4 Forecast");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(commandCalls).toContainEqual({
      command: "scenario.create",
      args: expect.objectContaining({ name: "Q4 Forecast", base_id: undefined }),
    });
    expect(await screen.findByText("Scenario “Q4 Forecast” created.")).toBeInTheDocument();
    await waitFor(() => expect(hasRow("Q4 Forecast")).toBe(true));
  });

  it("shows SCENARIO_NAME_DUP inline when the core rejects a duplicate name", async () => {
    renderPage();
    await waitForList();
    // Force the create path to collide: override scenario.create after install.
    callMock.mockImplementation((cmd: string, _args: Record<string, unknown>) => {
      if (cmd === "scenario.create")
        return bridgeError("SCENARIO_NAME_DUP", "A Scenario with this name already exists.");
      if (cmd === "model.list")
        return Promise.resolve([
          {
            id: WORKING_MODEL_ID,
            company_id: CO,
            name: "Working Model",
            horizon: 1,
            pack_id: null,
            scenarios: scenarios.map((s) => ({ ...s, versions: [...s.versions] })),
          },
        ]);
      return Promise.resolve({});
    });
    await userEvent.click(screen.getByRole("button", { name: "New Scenario" }));
    const dialog = await screen.findByRole("dialog", { name: "New Scenario" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "Base");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    // Dialog stays open with the locked code's user copy.
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "A Scenario with this name already exists.",
    );
    expect(screen.getByRole("dialog", { name: "New Scenario" })).toBeInTheDocument();
  });

  it("keeps the populated page axe-clean", async () => {
    renderPage();
    await waitForList();
    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });

  it("keeps an open dialog axe-clean", async () => {
    renderPage();
    await waitForList();
    await userEvent.click(within(rowWith("Base")).getByRole("button", { name: "Delete" }));
    await screen.findByRole("dialog", { name: "Delete Scenario" });
    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });
});
