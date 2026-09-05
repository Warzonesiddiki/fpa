/**
 * S-056 Alerts Center (F-026 · M5-4 · SCREENS-SPEC S-056 · WIREFRAMES-ANALYTICS §S-056).
 *
 * Layout per the wireframe: alert list (left, grouped by severity, trigger chain as an
 * expandable first-class row) and the rule manager (right: create threshold per KPI/line,
 * digest + retention POLICY shown as engine facts — not fake toggles, B18).
 *
 * Honest-state boundaries of the M5-4 slice:
 *   * Dismiss / mute-rule buttons are DISABLED with an explanatory title: the locked API
 *     catalog has `alerts.list` + `alerts.create_rule` only — no alerts.dismiss /
 *     alerts.mute_rule row (adding one is Tier-3). A local-only dismiss would fabricate
 *     persistence (B18), so we do not ship it.
 *   * KPI-target rules persist and validate but never fire before the M6-4/5 KPI engine —
 *     stated in the panel copy, no fabricated evaluations.
 *   * Threshold + trigger values are exact decimal strings rendered verbatim (money rule:
 *     nothing here parses floats; the list is not a currency statement, so MoneyCell —
 *     which requires currency — is deliberately not applied to raw decimal strings).
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, ChevronDown, ChevronRight } from "lucide-react";
import { StatePanel } from "@/components/ui/StatePanel";
import { useAlertsStore } from "@/stores/alerts";
import type { AlertRecord, AlertSeverity, AlertThresholdOperator } from "@/api/schema";

const SEVERITIES: AlertSeverity[] = ["critical", "warning", "info"];
const OPERATORS: AlertThresholdOperator[] = ["lt", "lte", "gt", "gte", "eq"];

function formatFired(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/** One alert log row with the expandable trigger chain (wireframe: chain is first-class). */
function AlertItem({ alert }: { alert: AlertRecord }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const chain = alert.trigger_chain;
  const dismissed = alert.dismissed_at !== null;

  return (
    <li className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rounded border border-current px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
          {t(`alertsPage.severity.${alert.severity}`)}
        </span>
        <span className="text-sm font-medium text-[var(--color-onetext)]">{alert.rule_name}</span>
        <time
          dateTime={alert.fired_at}
          className="ml-auto text-xs text-[var(--color-onetextmuted)]"
        >
          {formatFired(alert.fired_at)}
        </time>
        {dismissed && (
          <span className="text-xs italic text-[var(--color-onetextmuted)]">
            {t("alertsPage.dismissedTag")}
          </span>
        )}
      </div>

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-oneprimary)]"
      >
        {open ? (
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        {open ? t("alertsPage.chain.hide") : t("alertsPage.chain.show")}
      </button>
      {open && (
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-[var(--color-onetextsecondary)]">
          <dt className="font-medium">{t("alertsPage.chain.rule")}</dt>
          <dd>{chain.rule}</dd>
          {chain.line !== undefined && (
            <>
              <dt className="font-medium">{t("alertsPage.chain.line")}</dt>
              <dd>{chain.line}</dd>
            </>
          )}
          {chain.driver !== undefined && (
            <>
              <dt className="font-medium">{t("alertsPage.chain.driver")}</dt>
              <dd>{chain.driver}</dd>
            </>
          )}
          {chain.period_id !== undefined && chain.period_id !== null && (
            <>
              <dt className="font-medium">{t("alertsPage.chain.period")}</dt>
              <dd className="font-mono">{chain.period_id}</dd>
            </>
          )}
          <dt className="font-medium">{t("alertsPage.chain.value")}</dt>
          <dd>
            <code className="font-mono">{chain.value}</code>
          </dd>
          <dt className="font-medium">{t("alertsPage.chain.threshold")}</dt>
          <dd>
            <code className="font-mono">{chain.threshold}</code>
          </dd>
        </dl>
      )}

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled
          title={t("alertsPage.pendingDismiss")}
          className="cursor-not-allowed rounded border border-[var(--color-oneborder)] px-2 py-0.5 text-xs text-[var(--color-onetextmuted)]"
        >
          {t("alertsPage.dismiss")}
        </button>
        <button
          type="button"
          disabled
          title={t("alertsPage.pendingMute")}
          className="cursor-not-allowed rounded border border-[var(--color-oneborder)] px-2 py-0.5 text-xs text-[var(--color-onetextmuted)]"
        >
          {t("alertsPage.muteRule")}
        </button>
      </div>
    </li>
  );
}

/** Right pane: rule creation form + engine policy facts (digest/retention are NOT toggles). */
function RuleManager() {
  const { t } = useTranslation();
  const creating = useAlertsStore((s) => s.creating);
  const createError = useAlertsStore((s) => s.createError);
  const lastCreatedRuleId = useAlertsStore((s) => s.lastCreatedRuleId);
  const createRule = useAlertsStore((s) => s.createRule);

  const [name, setName] = useState("");
  const [targetKind, setTargetKind] = useState<"line" | "kpi">("line");
  const [lineRef, setLineRef] = useState("");
  const [kpiId, setKpiId] = useState("");
  const [operator, setOperator] = useState<AlertThresholdOperator>("lt");
  const [threshold, setThreshold] = useState("");
  const [severity, setSeverity] = useState<AlertSeverity>("warning");

  return (
    <aside
      aria-labelledby="alerts-rule-manager-heading"
      className="w-full space-y-3 rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-4 lg:w-80 lg:shrink-0"
    >
      <h2 id="alerts-rule-manager-heading" className="text-sm font-semibold">
        {t("alertsPage.rule.heading")}
      </h2>
      <p className="text-xs text-[var(--color-onetextmuted)]">{t("alertsPage.policy")}</p>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void createRule({
            name,
            kpi_id: targetKind === "kpi" ? kpiId : null,
            line_ref: targetKind === "line" ? lineRef : null,
            threshold_operator: operator,
            threshold_value: threshold,
            severity,
            active: true,
          });
        }}
      >
        <div>
          <label htmlFor="alert-rule-name" className="text-xs font-medium">
            {t("alertsPage.rule.name")}
          </label>
          <input
            id="alert-rule-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
            className="mt-1 w-full rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1 text-sm"
          />
        </div>

        <fieldset>
          <legend className="text-xs font-medium">{t("alertsPage.rule.target")}</legend>
          <div className="mt-1 flex gap-3 text-sm">
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                name="alert-rule-target"
                value="line"
                checked={targetKind === "line"}
                onChange={() => setTargetKind("line")}
              />
              {t("alertsPage.rule.targetLine")}
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                name="alert-rule-target"
                value="kpi"
                checked={targetKind === "kpi"}
                onChange={() => setTargetKind("kpi")}
              />
              {t("alertsPage.rule.targetKpi")}
            </label>
          </div>
          {targetKind === "line" ? (
            <label className="mt-1 block text-xs">
              <span className="font-medium">{t("alertsPage.rule.lineRef")}</span>
              <input
                value={lineRef}
                onChange={(e) => setLineRef(e.target.value)}
                required
                className="mt-0.5 w-full rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1 text-sm"
              />
            </label>
          ) : (
            <label className="mt-1 block text-xs">
              <span className="font-medium">{t("alertsPage.rule.kpiId")}</span>
              <input
                value={kpiId}
                onChange={(e) => setKpiId(e.target.value)}
                required
                className="mt-0.5 w-full rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1 text-sm"
              />
            </label>
          )}
        </fieldset>

        <div className="flex gap-2">
          <label className="block flex-1 text-xs">
            <span className="font-medium">{t("alertsPage.rule.operator")}</span>
            <select
              value={operator}
              onChange={(e) => setOperator(e.target.value as AlertThresholdOperator)}
              className="mt-0.5 w-full rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1 text-sm"
            >
              {OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {t(`alertsPage.operators.${op}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block flex-1 text-xs">
            <span className="font-medium">{t("alertsPage.rule.severity")}</span>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as AlertSeverity)}
              className="mt-0.5 w-full rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1 text-sm"
            >
              {SEVERITIES.map((sv) => (
                <option key={sv} value={sv}>
                  {t(`alertsPage.severity.${sv}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-xs">
          <span className="font-medium">{t("alertsPage.rule.threshold")}</span>
          <input
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            required
            inputMode="decimal"
            placeholder="2500000000"
            aria-describedby="alerts-threshold-hint"
            className="mt-0.5 w-full rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1 font-mono text-sm"
          />
          <span
            id="alerts-threshold-hint"
            className="mt-0.5 block text-[10px] text-[var(--color-onetextmuted)]"
          >
            {t("alertsPage.rule.thresholdHint")}
          </span>
        </label>

        <button
          type="submit"
          disabled={creating}
          className="w-full rounded-md bg-[var(--color-oneprimary)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {creating ? t("alertsPage.rule.creating") : t("alertsPage.rule.create")}
        </button>

        {createError && (
          <p role="alert" className="text-xs text-[var(--color-oneerror)]">
            {createError.userMessage} <code className="font-mono">[{createError.code}]</code>
          </p>
        )}
        {lastCreatedRuleId && !createError && (
          <p role="status" className="text-xs text-[var(--color-onefavorable)]">
            {t("alertsPage.rule.created")}{" "}
            <code className="font-mono text-[10px]">{lastCreatedRuleId.slice(0, 8)}…</code>
          </p>
        )}
      </form>

      <p className="text-[10px] text-[var(--color-onetextmuted)]">
        {t("alertsPage.rule.kpiPending")}
      </p>
    </aside>
  );
}

export function AlertsPage() {
  const { t } = useTranslation();
  const status = useAlertsStore((s) => s.status);
  const error = useAlertsStore((s) => s.error);
  const alerts = useAlertsStore((s) => s.alerts);
  const filter = useAlertsStore((s) => s.filter);
  const loadAlerts = useAlertsStore((s) => s.loadAlerts);
  const setSeverityFilter = useAlertsStore((s) => s.setSeverityFilter);
  const setIncludeDismissed = useAlertsStore((s) => s.setIncludeDismissed);
  const retry = useAlertsStore((s) => s.retry);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  const grouped = SEVERITIES.map((sev) => ({
    severity: sev,
    items: alerts.filter((a) => a.severity === sev),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--color-oneborder)] px-6 py-3">
        <Bell aria-hidden="true" className="h-5 w-5 text-[var(--color-oneprimary)]" />
        <div>
          <h1 className="text-lg font-semibold">{t("alertsPage.title")}</h1>
          <p className="text-xs text-[var(--color-onetextmuted)]">{t("alertsPage.subtitle")}</p>
        </div>
        <div
          className="ml-auto flex items-center gap-2"
          role="group"
          aria-label={t("alertsPage.filtersLabel")}
        >
          <button
            type="button"
            aria-pressed={filter.severity === null}
            onClick={() => void setSeverityFilter(null)}
            className={[
              "rounded border px-2 py-1 text-xs",
              filter.severity === null
                ? "border-[var(--color-oneprimary)] text-[var(--color-oneprimary)]"
                : "border-[var(--color-oneborder)] text-[var(--color-onetextsecondary)]",
            ].join(" ")}
          >
            {t("alertsPage.filters.all")}
          </button>
          {SEVERITIES.map((sev) => (
            <button
              key={sev}
              type="button"
              aria-pressed={filter.severity === sev}
              onClick={() => void setSeverityFilter(sev)}
              className={[
                "rounded border px-2 py-1 text-xs",
                filter.severity === sev
                  ? "border-[var(--color-oneprimary)] text-[var(--color-oneprimary)]"
                  : "border-[var(--color-oneborder)] text-[var(--color-onetextsecondary)]",
              ].join(" ")}
            >
              {t(`alertsPage.severity.${sev}`)}
            </button>
          ))}
          <label className="ml-2 inline-flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={filter.includeDismissed}
              onChange={(e) => void setIncludeDismissed(e.target.checked)}
            />
            {t("alertsPage.filters.showDismissed")}
          </label>
          <button
            type="button"
            onClick={() => void loadAlerts()}
            className="rounded border border-[var(--color-oneborder)] px-2 py-1 text-xs"
          >
            {t("alertsPage.reload")}
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 p-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          <StatePanel
            state={status}
            message={
              status === "empty"
                ? t("alertsPage.allClear")
                : status === "error" && error
                  ? error.userMessage
                  : status === "populated"
                    ? t("alertsPage.listSummary", { count: alerts.length })
                    : undefined
            }
            onRetry={status === "error" && error?.retryable ? () => void retry() : undefined}
          >
            {status === "populated" && (
              <div className="w-full space-y-4 text-left">
                {grouped.map((g) => (
                  <section key={g.severity} aria-labelledby={`alerts-group-${g.severity}`}>
                    <h2 id={`alerts-group-${g.severity}`} className="text-sm font-semibold">
                      {t(`alertsPage.severity.${g.severity}`)}{" "}
                      <span className="text-xs font-normal text-[var(--color-onetextmuted)]">
                        ({g.items.length})
                      </span>
                    </h2>
                    <ul className="mt-2 space-y-2">
                      {g.items.map((a) => (
                        <AlertItem key={a.id} alert={a} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
            {status === "error" && error && (
              <p className="rounded bg-[var(--color-onesurfacealt)] px-2 py-1 font-mono text-xs text-[var(--color-onetextsecondary)]">
                {error.code}
              </p>
            )}
          </StatePanel>
        </div>
        <RuleManager />
      </main>
    </div>
  );
}

export default AlertsPage;
