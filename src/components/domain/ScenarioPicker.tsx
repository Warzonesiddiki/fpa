/**
 * S-041/S-040 Scenario switcher (F-022 · M4-2 PR B · SCREENS-SPEC S-040 "Scenario switcher
 * (dropdown + state badge)", wired into the S-041 grid toolbar).
 *
 * Controlled by the S-050 scenario store (shared read side — the page and the picker never keep
 * two copies of the list) and the model grid store's `scenarioId`/`setScenario`. Switching a
 * Scenario rebuilds the HyperFormula worker and reloads the grid through the audited path
 * (STATE-MANAGEMENT §2). Editing a Locked Scenario stays possible as an *attempt* — the core
 * answers MODEL_CELL_LOCKED (ERROR-HANDLING row) instead of a silent bypass, and the badge tells
 * the user the active Scenario is locked before they try.
 */
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GitBranch, RotateCw } from "lucide-react";
import { Button } from "@/components/ui";
import { useScenarioStore } from "@/stores/scenarios";
import { useModelGridStore } from "@/stores/model";
import type { ScenarioRow } from "@/api/schema";

const STATE_TONE: Record<ScenarioRow["state"], string> = {
  draft: "bg-[var(--color-onesurfacealt)] text-[var(--color-onetextsecondary)]",
  review: "bg-[var(--color-onewarning)] text-white",
  approved: "bg-[var(--color-onefavorable)] text-white",
  locked: "bg-[var(--color-oneprimary)] text-white",
};

/** Scenario dropdown + state badge for the model grid toolbar (S-041/S-040). */
export function ScenarioPicker() {
  const { t } = useTranslation();
  const status = useScenarioStore((s) => s.status);
  const scenarios = useScenarioStore((s) => s.scenarios);
  const load = useScenarioStore((s) => s.load);
  const scenarioId = useModelGridStore((s) => s.scenarioId);
  const setScenario = useModelGridStore((s) => s.setScenario);

  // Populate the dropdown on first mount (idempotent — the store stays populated afterwards).
  useEffect(() => {
    if (status === "loading") void load();
  }, [status, load]);

  const active = scenarios.find((s) => s.id === scenarioId) ?? null;

  return (
    <span className="flex items-center gap-1.5 rounded-md border border-[var(--color-oneborder)] px-2 py-1">
      <label htmlFor="scenario-picker" className="sr-only">
        {t("scenarioPicker.label")}
      </label>
      <select
        id="scenario-picker"
        aria-label={t("scenarioPicker.label")}
        value={active ? scenarioId : ""}
        disabled={scenarios.length === 0}
        onChange={(e) => {
          const id = e.target.value;
          if (id && id !== scenarioId) void setScenario(id);
        }}
        className="h-7 max-w-[11rem] bg-transparent text-sm outline-none"
      >
        {scenarios.length === 0 && <option value="">{t("scenarioPicker.empty")}</option>}
        {scenarios.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {active && (
        <span
          title={t("scenarioPicker.stateTitle", {
            state: t(`scenariosPage.states.${active.state}`),
          })}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATE_TONE[active.state]}`}
        >
          {t(`scenariosPage.states.${active.state}`)}
        </span>
      )}
      {status === "error" && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("common.retry")}
          title={t("common.retry")}
          onClick={() => void load()}
          className="h-6 px-1"
        >
          <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
        </Button>
      )}
      <Link
        to="/app/plan/scenarios"
        aria-label={t("scenarioPicker.manage")}
        title={t("scenarioPicker.manage")}
        className="rounded p-1 text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurfacealt)]"
      >
        <GitBranch aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    </span>
  );
}
