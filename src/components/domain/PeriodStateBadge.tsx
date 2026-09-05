/**
 * S-041 Period State Badge (M4-1 · F-021 · GLOSSARY §11b · MODELING-METHODS-SPEC §5).
 *
 * Renders the period classification: ACTUAL, FORECAST, PLAN_ONLY, or
 * HYBRID (Actual P01–P04, Forecast P05–P12) next to ScenarioPicker.
 * Adheres to WCAG 2.2 AA contrast and ARIA status role.
 */
import { useTranslation } from "react-i18next";
import { useModelGridStore, type PeriodState } from "@/stores/model";

const PERIOD_STATE_TONE: Record<PeriodState, string> = {
  ACTUAL:
    "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200 border-sky-300 dark:border-sky-800",
  FORECAST:
    "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200 border-indigo-300 dark:border-indigo-800",
  PLAN_ONLY:
    "bg-[var(--color-onesurfacealt)] text-[var(--color-onetextsecondary)] border-[var(--color-oneborder)]",
  HYBRID:
    "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200 border-amber-300 dark:border-amber-800",
};

export function PeriodStateBadge() {
  const { t } = useTranslation();
  const periodState = useModelGridStore((s) => s.periodState);
  const hybridLabel = useModelGridStore((s) => s.hybridLabel);

  const displayLabel = periodState === "HYBRID" && hybridLabel ? hybridLabel : periodState;
  const spokenLabel = displayLabel.replace(/–/g, " to ");

  return (
    <span
      role="status"
      aria-label={t("gridPage.periodStateAriaLabel", {
        defaultValue: `Period state: ${spokenLabel}`,
        label: spokenLabel,
      })}
      data-period-status={periodState}
      data-testid="period-state-badge"
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium period-badge period-badge-${periodState.toLowerCase()} ${PERIOD_STATE_TONE[periodState]}`}
    >
      <span>{displayLabel}</span>
    </span>
  );
}
