/**
 * S-071 Model Health Check (F-032 · US-033 · SCREENS-SPEC S-071 · WIREFRAMES-ANALYTICS §S-071).
 *
 * Geometry per the wireframe:
 *   CATEGORY ROWS: tie-outs · references · rounding · driver feeds · anomalies, each with
 *                  its own count and verdict (counted by the engine, never by this screen)
 *   FINDING TABLE: severity · message · [→ cell] — the jump target is offered ONLY when the
 *                  engine's `entity_ref` actually names a cell
 *   FOOTSTRIP:     "N blocking · M warnings" + [Waive ▸ reason required (D-010)]
 *
 * Deliberate frictions and honest-state boundaries, all carried from the spec:
 *   * **The waiver is never on the finding row.** Waiving is a governance decision, so it
 *     happens in an explicit panel that demands a reason before the button enables (D-010 /
 *     US-033). The engine's `HEALTH_WAIVER_REASON_REQUIRED` remains the authority.
 *   * **Waived findings stay visible**, with the reason and the author next to them. Nothing
 *     is hidden once it has been raised.
 *   * **Nothing is auto-fixed.** There is no "fix this" control anywhere on this screen: the
 *     engine reports, the modeller decides (GLOSSARY "Anomaly").
 *   * **No fake progress percentage.** A run in flight shows an indeterminate indicator and
 *     the categories it is working through — the command answers once, so a percentage would
 *     be invented (WIREFRAMES-ANALYTICS S-071: "streaming partial results, no fake %").
 *   * A failing Health Check is a REPORT, not an error screen. The error state is reserved
 *     for a genuine transport/session failure.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { StatePanel } from "@/components/ui/StatePanel";
import { Button } from "@/components/ui/Button";
import { useHealthStore, parseEntityRef } from "@/stores/health";
import { useSessionStore } from "@/stores/session";
import { HEALTH_CATEGORIES, type HealthFindingRecord } from "@/api/schema";

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function FindingRow({
  finding,
  onWaive,
}: {
  finding: HealthFindingRecord;
  onWaive: (findingId: string) => void;
}) {
  const { t } = useTranslation();
  const target = parseEntityRef(finding.entity_ref);
  const blocking = finding.severity === "hard" && finding.waiver === null;

  return (
    <li
      data-testid="health-finding"
      data-severity={finding.severity}
      data-waived={finding.waiver !== null}
      className="grid grid-cols-[6rem_1fr_auto] items-start gap-3 border-b border-[var(--color-oneborder)]/60 px-3 py-2 text-sm last:border-b-0"
    >
      <span
        className={[
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
          blocking
            ? "bg-[var(--color-oneunfavorable)]/10 text-[var(--color-oneunfavorable)]"
            : "bg-[var(--color-onewarning)]/10 text-[var(--color-onewarning)]",
        ].join(" ")}
      >
        {blocking ? (
          <XCircle aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        {finding.severity === "hard"
          ? t("healthPage.severity.hard")
          : t("healthPage.severity.warn")}
      </span>

      <div className="space-y-1">
        <p className="text-[var(--color-onetext)]">{finding.message}</p>
        {finding.entity_ref && (
          <p className="font-mono text-xs text-[var(--color-onetextmuted)]">{finding.entity_ref}</p>
        )}
        {finding.waiver && (
          <p
            data-testid="health-waiver-note"
            className="rounded bg-[var(--color-onesurfacealt)]/60 px-2 py-1 text-xs text-[var(--color-onetextsecondary)]"
          >
            {t("healthPage.waiver.recorded", {
              actor: finding.waiver.actor,
              at: formatTimestamp(finding.waiver.created_at),
            })}{" "}
            <span className="italic">“{finding.waiver.reason}”</span>
          </p>
        )}
      </div>

      <span className="flex items-center gap-2">
        {/* "→ cell" only when the engine actually named a cell; other refs get no
            fabricated navigation target. */}
        {target?.kind === "cell" && (
          <a
            href={`/app/model/grid?line=${encodeURIComponent(target.lineId)}&scenario=${encodeURIComponent(target.scenarioId)}&period=${encodeURIComponent(target.periodId)}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-oneprimary)] underline"
          >
            {t("healthPage.goToCell")}
            <ArrowRight aria-hidden="true" className="h-3 w-3" />
          </a>
        )}
        {finding.waiver === null && (
          <Button variant="secondary" size="sm" onClick={() => onWaive(finding.id)}>
            {t("healthPage.waiver.open")}
          </Button>
        )}
      </span>
    </li>
  );
}

export function HealthCheckPage() {
  const { t } = useTranslation();
  const sessionModelId = useSessionStore((s) => s.modelId);
  const readOnly = useSessionStore((s) => s.readOnly);

  const status = useHealthStore((s) => s.status);
  const error = useHealthStore((s) => s.error);
  const waiveError = useHealthStore((s) => s.waiveError);
  const findings = useHealthStore((s) => s.findings);
  const categories = useHealthStore((s) => s.categories);
  const blockingCount = useHealthStore((s) => s.blockingCount);
  const warningCount = useHealthStore((s) => s.warningCount);
  const waivedCount = useHealthStore((s) => s.waivedCount);
  const runAt = useHealthStore((s) => s.runAt);
  const history = useHealthStore((s) => s.history);
  const waivingFindingId = useHealthStore((s) => s.waivingFindingId);
  const waiveInFlight = useHealthStore((s) => s.waiveInFlight);

  const run = useHealthStore((s) => s.run);
  const retry = useHealthStore((s) => s.retry);
  const openWaiver = useHealthStore((s) => s.openWaiver);
  const waive = useHealthStore((s) => s.waive);

  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!sessionModelId) return;
    void run(sessionModelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionModelId]);

  const waivingFinding = findings.find((f) => f.id === waivingFindingId) ?? null;
  const reasonValid = reason.trim().length > 0;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-oneapp)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-onetext)]">
            {t("healthPage.title")}
          </h1>
          <p className="mt-0.5 text-sm text-[var(--color-onetextmuted)]">
            {runAt
              ? t("healthPage.lastRun", { at: formatTimestamp(runAt) })
              : t("healthPage.subtitle")}
          </p>
        </div>
        <Button
          className="ml-auto"
          variant="secondary"
          size="sm"
          disabled={status === "loading" || !sessionModelId}
          onClick={() => void run()}
        >
          <RefreshCw aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
          {t("healthPage.rerun")}
        </Button>
      </header>

      <main className="flex flex-1 flex-col gap-4 p-6">
        {status === "loading" && (
          // Indeterminate by design: the command answers once, so any percentage here would
          // be fabricated (WIREFRAMES-ANALYTICS S-071).
          <div role="status" aria-label={t("healthPage.runningLabel")} className="space-y-2">
            <p className="text-sm text-[var(--color-onetextsecondary)]">
              {t("healthPage.running")}
            </p>
            {HEALTH_CATEGORIES.map((category) => (
              <div
                key={category}
                className="flex items-center gap-3 rounded-md border border-[var(--color-oneborder)] px-3 py-2 text-sm"
              >
                <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-oneprimary)]" />
                <span className="text-[var(--color-onetextsecondary)]">
                  {t(`healthPage.category.${category}`)}
                </span>
              </div>
            ))}
          </div>
        )}

        {status === "error" && error && (
          <StatePanel
            state="error"
            message={error.userMessage}
            errorCode={error.code}
            onRetry={error.retryable ? () => void retry() : undefined}
          />
        )}

        {status === "empty" && !sessionModelId && (
          <StatePanel state="empty" message={t("healthPage.noModel")} />
        )}

        {status === "empty" && sessionModelId && (
          <StatePanel
            state="empty"
            message={t("healthPage.neverRun")}
            actionLabel={t("healthPage.runNow")}
            onAction={() => void run()}
          />
        )}

        {(status === "success" || status === "populated") && (
          <>
            <section
              aria-label={t("healthPage.categoriesLabel")}
              className="grid gap-2 md:grid-cols-5"
            >
              {categories.map((category) => (
                <div
                  key={category.category}
                  data-testid="health-category"
                  data-status={category.status}
                  className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-3 py-2"
                >
                  <p className="text-xs uppercase tracking-wide text-[var(--color-onetextsecondary)]">
                    {t(`healthPage.category.${category.category}`)}
                  </p>
                  <p
                    className={[
                      "mt-1 inline-flex items-center gap-1 text-sm font-semibold",
                      category.status === "failed"
                        ? "text-[var(--color-oneunfavorable)]"
                        : category.status === "warnings"
                          ? "text-[var(--color-onewarning)]"
                          : "text-[var(--color-onefavorable)]",
                    ].join(" ")}
                  >
                    {category.status === "passed" ? (
                      <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                    ) : (
                      <AlertTriangle aria-hidden="true" className="h-4 w-4" />
                    )}
                    {t("healthPage.categoryCount", { count: category.finding_count })}
                  </p>
                </div>
              ))}
            </section>

            {status === "success" && (
              <StatePanel state="success" message={t("healthPage.allClear")} />
            )}

            {status === "populated" && (
              <section
                aria-label={t("healthPage.findingsLabel")}
                className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)]"
              >
                <h2 className="sr-only">{t("healthPage.findingsLabel")}</h2>
                <div className="grid grid-cols-[6rem_1fr_auto] gap-3 border-b border-[var(--color-oneborder)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-onetextsecondary)]">
                  <span>{t("healthPage.columns.severity")}</span>
                  <span>{t("healthPage.columns.message")}</span>
                  <span>{t("healthPage.columns.actions")}</span>
                </div>
                <ul>
                  {findings.map((finding) => (
                    <FindingRow
                      key={finding.id}
                      finding={finding}
                      onWaive={(id) => {
                        setReason("");
                        openWaiver(id);
                      }}
                    />
                  ))}
                </ul>
              </section>
            )}

            {waivingFinding && (
              <section
                aria-label={t("healthPage.waiver.panelLabel")}
                className="rounded-md border border-[var(--color-onewarning)] bg-[var(--color-onewarning)]/5 p-4"
              >
                <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-onetext)]">
                  <ShieldAlert aria-hidden="true" className="h-4 w-4" />
                  {t("healthPage.waiver.title")}
                </h2>
                <p className="mt-1 text-sm text-[var(--color-onetextsecondary)]">
                  {waivingFinding.message}
                </p>
                <p className="mt-2 text-xs text-[var(--color-onetextmuted)]">
                  {t("healthPage.waiver.policy")}
                </p>
                <label
                  htmlFor="health-waiver-reason"
                  className="mt-3 block text-xs text-[var(--color-onetextsecondary)]"
                >
                  {t("healthPage.waiver.reasonLabel")}
                </label>
                <textarea
                  id="health-waiver-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1.5 text-sm text-[var(--color-onetext)]"
                />
                {waiveError && (
                  <p role="alert" className="mt-2 text-xs text-[var(--color-oneunfavorable)]">
                    {waiveError.userMessage}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    // Disabled until a reason exists AND the Company is writable — a waiver
                    // is an audited mutation, so read-only mode refuses it.
                    disabled={!reasonValid || waiveInFlight || readOnly}
                    title={readOnly ? t("healthPage.waiver.readOnly") : undefined}
                    onClick={() => void waive(waivingFinding.id, reason)}
                  >
                    {t("healthPage.waiver.confirm")}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => openWaiver(null)}>
                    {t("healthPage.waiver.cancel")}
                  </Button>
                </div>
              </section>
            )}

            {history.length > 1 && (
              <section
                aria-label={t("healthPage.historyLabel")}
                className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-3 py-2"
              >
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-onetextsecondary)]">
                  {t("healthPage.historyLabel")}
                </h2>
                <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-onetextmuted)]">
                  {history.map((entry) => (
                    <li key={entry.check_id}>
                      {formatTimestamp(entry.run_at)} ·{" "}
                      {entry.status === "passed"
                        ? t("healthPage.runPassed")
                        : t("healthPage.runFailed")}{" "}
                      · {t("healthPage.categoryCount", { count: entry.finding_count })}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>

      <footer className="flex flex-wrap items-center gap-3 border-t border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-6 py-2 text-xs text-[var(--color-onetextmuted)]">
        <span data-testid="health-footstrip">
          {t("healthPage.footstrip", { blocking: blockingCount, warnings: warningCount })}
        </span>
        {waivedCount > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span>{t("healthPage.footWaived", { count: waivedCount })}</span>
          </>
        )}
        <span className="ml-auto">
          {blockingCount > 0 ? t("healthPage.exportBlocked") : t("healthPage.exportAllowed")}
        </span>
      </footer>
    </div>
  );
}

export default HealthCheckPage;
