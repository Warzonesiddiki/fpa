/**
 * S-050 Scenario Manager (F-022 · M4-2 PR B · SCREENS-SPEC S-050 · SCENARIO-VERSION-SPEC §1–§3).
 *
 * Renders the active Model's Scenario lifecycle: Draft → Review → Approved → Locked (auto
 * Version vN on lock), reopen with a written reason, delete (Draft-only), and Baseline setting
 * (Locked-only; replacing the Baseline requires a written reason).
 *
 * All 5 screen states are driven by `useScenarioStore.status`; every mutation goes through the
 * audited catalogued commands in `stores/scenarios.ts` and typed errors surface inline in the
 * dialog (`SCENARIO_NAME_DUP`, `SCENARIO_LOCK_CONFLICT`, `BASELINE_REPLACE_REASON_REQUIRED`).
 * Lock/Delete use the D-004 two-step pattern (type the Scenario name) from SCREENS-SPEC §6.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button, StatePanel } from "@/components/ui";
import { useScenarioStore } from "@/stores/scenarios";
import { useSessionStore } from "@/stores/session";
import type { ScenarioRow } from "@/api/schema";
import { scenarioActions, type ScenarioLifecycleAction } from "./actions";
import {
  BaselineScenarioDialog,
  CreateScenarioDialog,
  DeleteScenarioDialog,
  DuplicateScenarioDialog,
  LockScenarioDialog,
  ReopenScenarioDialog,
} from "./dialogs";

type DialogKind = "create" | "duplicate" | "reopen" | "lock" | "delete" | "baseline";

/** Compact localised date — display only (LOCALIZATION-SPEC; same pattern as S-020). */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** State chip tones — always paired with the state TEXT (B11: never colour-only). */
const STATE_TONE: Record<ScenarioRow["state"], string> = {
  draft: "bg-[var(--color-onesurfacealt)] text-[var(--color-onetextsecondary)]",
  review: "bg-[var(--color-onewarning)] text-white",
  approved: "bg-[var(--color-onefavorable)] text-white",
  locked: "bg-[var(--color-oneprimary)] text-white",
};

export function ScenariosPage() {
  const { t } = useTranslation();
  const status = useScenarioStore((s) => s.status);
  const storeError = useScenarioStore((s) => s.error);
  const models = useScenarioStore((s) => s.models);
  const scenarios = useScenarioStore((s) => s.scenarios);
  const load = useScenarioStore((s) => s.load);
  const create = useScenarioStore((s) => s.create);
  const duplicate = useScenarioStore((s) => s.duplicate);
  const submit = useScenarioStore((s) => s.submit);
  const approve = useScenarioStore((s) => s.approve);
  const lock = useScenarioStore((s) => s.lock);
  const reopen = useScenarioStore((s) => s.reopen);
  const remove = useScenarioStore((s) => s.remove);
  const setBaseline = useScenarioStore((s) => s.setBaseline);

  const companyId = useSessionStore((s) => s.companyId);
  const sessionModelId = useSessionStore((s) => s.modelId);

  // Load once on mount. Failures stop on the error state with a manual Retry — never loop
  // through the bridge on a persistent load failure (load() is idempotent for revisits).
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; load is stable
  }, []);

  const activeModel =
    models.find((m) => m.id === (sessionModelId ?? models[0]?.id ?? "")) ?? models[0] ?? null;

  const nameById = useMemo(() => new Map(scenarios.map((s) => [s.id, s.name])), [scenarios]);
  const currentBaseline = scenarios.find((s) => s.baseline) ?? null;
  const baselineReplacingTarget = (scenarioId: string): ScenarioRow | null =>
    currentBaseline && currentBaseline.id !== scenarioId ? currentBaseline : null;

  /* ── Dialog + mutation plumbing ────────────────────────────────────────────── */
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const closeDialog = () => {
    setDialog(null);
    setTargetId(null);
    setDialogError(null);
  };

  const openDialog = (kind: DialogKind, scenarioId: string | null = null) => {
    setDialogError(null);
    setLastResult(null);
    setTargetId(scenarioId);
    setDialog(kind);
  };

  /**
   * Run a store mutation behind the open dialog. On failure the typed BridgeError text (or a
   * fallback) is shown inline and the dialog stays open so the user can correct and retry.
   */
  async function runMutation(
    op: () => Promise<string | boolean | null>,
    fallbackMessage: string,
    onSuccess: (out: string | true) => void,
  ): Promise<void> {
    setBusy(true);
    setDialogError(null);
    const out = await op();
    if (out === false || out === null) {
      const err = useScenarioStore.getState().error;
      setDialogError(err?.userMessage ?? fallbackMessage);
      setBusy(false);
      return;
    }
    onSuccess(out as string | true);
    closeDialog();
    setBusy(false);
  }

  const target: ScenarioRow | null = targetId
    ? (scenarios.find((s) => s.id === targetId) ?? null)
    : null;

  const handleCreate = (name: string | undefined, baseId: string | undefined) =>
    void runMutation(
      () => create(name, baseId),
      t("scenariosPage.errors.unexpected"),
      (createdId) => {
        const created = useScenarioStore.getState().scenarios.find((s) => s.id === createdId);
        setLastResult(t("scenariosPage.result.created", { name: created?.name ?? name ?? "Base" }));
      },
    );

  const handleDuplicate = (name: string | undefined) => {
    if (!target) return;
    const sourceName = target.name;
    void runMutation(
      () => duplicate(target.id, name),
      t("scenariosPage.errors.unexpected"),
      (createdId) => {
        const created = useScenarioStore.getState().scenarios.find((s) => s.id === createdId);
        setLastResult(
          t("scenariosPage.result.duplicated", {
            name: created?.name ?? name ?? `${sourceName} (copy)`,
          }),
        );
      },
    );
  };

  const handleSubmit = (s: ScenarioRow) =>
    void runMutation(
      () => submit(s.id),
      t("scenariosPage.errors.unexpected"),
      () => setLastResult(t("scenariosPage.result.submitted", { name: s.name })),
    );

  const handleApprove = (s: ScenarioRow) =>
    void runMutation(
      () => approve(s.id),
      t("scenariosPage.errors.unexpected"),
      () => setLastResult(t("scenariosPage.result.approved", { name: s.name })),
    );

  const handleLock = (s: ScenarioRow) =>
    void runMutation(
      () => lock(s.id),
      t("scenariosPage.errors.unexpected"),
      () => setLastResult(t("scenariosPage.result.locked", { name: s.name })),
    );

  const handleReopen = (s: ScenarioRow, reason: string) =>
    void runMutation(
      () => reopen(s.id, reason),
      t("scenariosPage.errors.unexpected"),
      () => setLastResult(t("scenariosPage.result.reopened", { name: s.name })),
    );

  const handleDelete = (s: ScenarioRow) =>
    void runMutation(
      () => remove(s.id),
      t("scenariosPage.errors.unexpected"),
      () => setLastResult(t("scenariosPage.result.deleted", { name: s.name })),
    );

  const handleSetBaseline = (s: ScenarioRow, reason: string | undefined) =>
    void runMutation(
      () => setBaseline(s.id, reason),
      t("scenariosPage.errors.unexpected"),
      () => setLastResult(t("scenariosPage.result.baselineSet", { name: s.name })),
    );

  const handleCreateBase = () =>
    void runMutation(
      () => create(),
      t("scenariosPage.errors.unexpected"),
      (createdId) => {
        const created = useScenarioStore.getState().scenarios.find((s) => s.id === createdId);
        setLastResult(t("scenariosPage.result.created", { name: created?.name ?? "Base" }));
      },
    );

  /* ── Render states ─────────────────────────────────────────────────────────── */

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t("scenariosPage.title")}</h1>
        <StatePanel state="loading" message={t("common.loading")} />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t("scenariosPage.title")}</h1>
        <StatePanel
          state="error"
          message={storeError?.userMessage ?? t("scenariosPage.errors.load")}
          errorCode={storeError?.code}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  if (status === "empty") {
    const noCompany = !companyId;
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t("scenariosPage.title")}</h1>
        {noCompany ? (
          <StatePanel state="empty" message={t("scenariosPage.empty.noCompany")} />
        ) : (
          <StatePanel
            state="empty"
            message={t("scenariosPage.empty.noScenarios")}
            actionLabel={t("scenariosPage.empty.createBase")}
            onAction={() => void handleCreateBase()}
          />
        )}
      </div>
    );
  }

  const showsList = status === "success" || status === "populated";
  if (!showsList) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("scenariosPage.title")}</h1>
          <p className="mt-1 text-sm text-[var(--color-onetextsecondary)]">
            {t("scenariosPage.lead")}
          </p>
        </div>
        <Button size="sm" onClick={() => openDialog("create")}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          {t("scenariosPage.newScenario")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            window.location.href = "/app/plan/compare";
          }}
        >
          {t("scenariosPage.compareScenarios")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            window.location.href = "/app/plan/whatif";
          }}
        >
          What-If & Sensitivity
        </Button>
      </div>

      {lastResult && (
        <p role="status" className="text-sm text-[var(--color-onefavorable)]">
          {lastResult}
        </p>
      )}
      {dialogError && !dialog && (
        <p
          role="alert"
          className="rounded-md border border-[var(--color-oneerror)] bg-[var(--color-onesurfacealt)] px-3 py-2 text-xs text-[var(--color-onerror)]"
        >
          {dialogError}
        </p>
      )}

      {activeModel && (
        <div
          role="status"
          className="rounded-lg border border-[var(--color-oneborder)] px-3 py-2 text-xs text-[var(--color-onetextsecondary)]"
        >
          {t("scenariosPage.modelLabel")}: <span className="font-medium">{activeModel.name}</span>
          <span className="mx-2">·</span>
          {t("scenariosPage.horizonYears", { count: activeModel.horizon })}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-[var(--color-oneborder)]">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t("scenariosPage.tableCaption")}</caption>
          <thead>
            <tr className="bg-[var(--color-onesurfacealt)] text-left">
              <th scope="col" className="px-3 py-2 font-medium">
                {t("scenariosPage.col.name")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("scenariosPage.col.kind")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("scenariosPage.col.state")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("scenariosPage.col.base")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("scenariosPage.col.versions")}
              </th>
              {/* S-050 lists a "Created" column, but `scenarios.created_at` is not in the DB
                  schema (DATABASE-SCHEMA §`scenarios`) — Tier-3 migration decision recorded in
                  TASKBOARD/DECISIONS; the column lands with the field, never faked. */}
              <th scope="col" className="px-3 py-2 text-right">
                <span className="sr-only">{t("scenariosPage.col.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => {
              const actions = scenarioActions(s.state, {
                state: s.state,
                hasVersions: s.versions.length > 0,
                isBaseline: s.baseline,
              });
              return (
                <tr key={s.id} className="border-t border-[var(--color-oneborder)] align-top">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      {s.baseline && (
                        <span className="rounded bg-[var(--color-oneinfo)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                          {t("scenariosPage.baselineBadge")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-[var(--color-onesurfacealt)] px-2 py-0.5 text-xs text-[var(--color-onetextsecondary)]">
                      {t(`scenariosPage.kinds.${s.kind}`)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${STATE_TONE[s.state]}`}
                    >
                      {t(`scenariosPage.states.${s.state}`)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-onetextsecondary)]">
                    {s.parent_scenario_id ? (nameById.get(s.parent_scenario_id) ?? "—") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {s.versions.length === 0 ? (
                      <span className="text-[var(--color-onetextmuted)]">—</span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-1">
                        {s.versions.slice(0, 3).map((v) => (
                          <span
                            key={v.id}
                            title={t("scenariosPage.versionTitle", {
                              label: v.label,
                              date: fmtDate(v.created_at),
                            })}
                            className="rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-onetextsecondary)]"
                          >
                            {v.label}
                          </span>
                        ))}
                        {s.versions.length > 3 && (
                          <span
                            title={s.versions.map((v) => v.label).join(", ")}
                            className="rounded border border-[var(--color-oneborder)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-onetextmuted)]"
                          >
                            {t("scenariosPage.moreVersions", { count: s.versions.length - 3 })}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <RowActions
                        actions={actions}
                        disabled={busy}
                        onAction={(a) => {
                          // Non-destructive transitions run immediately; the rest open a dialog.
                          if (a === "submit") void handleSubmit(s);
                          else if (a === "approve") void handleApprove(s);
                          else openDialog(a, s.id);
                        }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {dialog === "create" && (
        <CreateScenarioDialog
          scenarios={scenarios}
          busy={busy}
          error={dialogError}
          onClose={closeDialog}
          onSubmit={handleCreate}
        />
      )}

      {dialog === "duplicate" && target && (
        <DuplicateScenarioDialog
          source={target}
          busy={busy}
          error={dialogError}
          onClose={closeDialog}
          onSubmit={handleDuplicate}
        />
      )}

      {dialog === "reopen" && target && (
        <ReopenScenarioDialog
          scenario={target}
          busy={busy}
          error={dialogError}
          onClose={closeDialog}
          onSubmit={(reason) => handleReopen(target, reason)}
        />
      )}

      {dialog === "lock" && target && (
        <LockScenarioDialog
          scenario={target}
          busy={busy}
          error={dialogError}
          onClose={closeDialog}
          onSubmit={() => handleLock(target)}
        />
      )}

      {dialog === "delete" && target && (
        <DeleteScenarioDialog
          scenario={target}
          busy={busy}
          error={dialogError}
          onClose={closeDialog}
          onSubmit={() => handleDelete(target)}
        />
      )}

      {dialog === "baseline" && target && (
        <BaselineScenarioDialog
          scenario={target}
          currentBaseline={baselineReplacingTarget(target.id)}
          busy={busy}
          error={dialogError}
          onClose={closeDialog}
          onSubmit={(reason) => handleSetBaseline(target, reason)}
        />
      )}
    </div>
  );
}

/** Row action buttons for one Scenario (labels come from `scenariosPage.actions.*`). */
function RowActions({
  actions,
  disabled,
  onAction,
}: {
  actions: ScenarioLifecycleAction[];
  /** Disable while any mutation is in flight (no double-submits). */
  disabled: boolean;
  onAction: (a: ScenarioLifecycleAction) => void;
}) {
  const { t } = useTranslation();
  const tone: Partial<Record<ScenarioLifecycleAction, "danger" | "secondary" | "ghost">> = {
    delete: "danger",
    submit: "secondary",
    approve: "secondary",
    lock: "secondary",
    baseline: "secondary",
    duplicate: "ghost",
    reopen: "ghost",
  };
  return (
    <>
      {actions.map((a) => (
        <Button
          key={a}
          variant={tone[a] ?? "secondary"}
          size="sm"
          disabled={disabled}
          onClick={() => onAction(a)}
          title={t(`scenariosPage.actionHints.${a}`)}
        >
          {t(`scenariosPage.actions.${a}`)}
        </Button>
      ))}
    </>
  );
}
