/**
 * S-070 Audit Trail (F-033 · US-034 · SCREENS-SPEC S-070 · WIREFRAMES-ANALYTICS §S-070).
 *
 * Geometry per the wireframe:
 *   TOOLBAR: date range · actor ▾ · action ▾ · object ▾ · [verified ⛓ ✓] chip
 *   MAIN:    ts · actor · action · object · before → after (two-value cell, mono);
 *            row expand → full event payload + hash link to the previous event
 *   FOOTSTRIP: N events · chain verified · [Auditor Data-Room Export] [Export log]
 *
 * Honest-state boundaries of this slice:
 *   * There is NO edit/delete control anywhere on this screen — by design, not omission
 *     (B7: the log is append-only; the wireframe has no such geometry).
 *   * "Auditor Data-Room Export" and "Export log" map to `audit.export_dataroom` and
 *     `export.excel` with loading, success feedback, and error banner handling
 *     (AUDIT_CHAIN_BREAK, HEALTH_CHECK_BLOCKED).
 *   * A broken chain is rendered as a persistent banner + ✗ chip with the failing `seq`,
 *     and the events stay readable (US-034: the tamper is shown, never hidden).
 *   * Event payloads (`before_json` / `after_json`) are the exact hashed bytes and are
 *     printed verbatim in a mono block — the screen never parses, rounds or reformats
 *     money out of them (B3/B6).
 */

import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Link2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { StatePanel } from "@/components/ui/StatePanel";
import { Button } from "@/components/ui/Button";
import { call, toBridgeError, type BridgeError } from "@/api/bridge";
import { useAuditStore } from "@/stores/audit";
import { useSessionStore } from "@/stores/session";
import type { AuditEventRecord } from "@/api/schema";

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(parsed);
}

/** Short hash form for the chain link cell; the full value is in the expanded payload. */
function shortHash(hash: string): string {
  return hash.length <= 16 ? hash : `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

function EventRow({ event }: { event: AuditEventRecord }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <li className="border-b border-[var(--color-oneborder)]/60 last:border-b-0">
      <div className="grid grid-cols-[auto_10rem_7rem_11rem_1fr] items-baseline gap-3 px-3 py-2 text-sm">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-oneprimary)]"
        >
          {open ? (
            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {t("auditPage.row.expand", { seq: event.seq })}
        </button>
        <time dateTime={event.created_at} className="text-[var(--color-onetextsecondary)]">
          {formatTimestamp(event.created_at)}
        </time>
        <span className="truncate text-[var(--color-onetextsecondary)]" title={event.actor}>
          {event.actor}
        </span>
        <span className="truncate font-medium text-[var(--color-onetext)]" title={event.action}>
          {event.action}
        </span>
        <span
          className="truncate font-mono text-xs text-[var(--color-onetextmuted)]"
          title={`${event.object_type} · ${event.object_id}`}
        >
          {event.object_type} · {event.object_id}
        </span>
      </div>

      {open && (
        <div
          id={panelId}
          className="space-y-3 border-t border-dashed border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)]/40 px-3 py-3"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-onetextsecondary)]">
                {t("auditPage.row.before")}
              </h3>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-[var(--color-onesurface)] p-2 font-mono text-xs text-[var(--color-onetext)]">
                {event.before_json ?? t("auditPage.row.noPayload")}
              </pre>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-onetextsecondary)]">
                {t("auditPage.row.after")}
              </h3>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-[var(--color-onesurface)] p-2 font-mono text-xs text-[var(--color-onetext)]">
                {event.after_json ?? t("auditPage.row.noPayload")}
              </pre>
            </div>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="font-medium text-[var(--color-onetextsecondary)]">
              {t("auditPage.row.prevHash")}
            </dt>
            <dd className="inline-flex items-center gap-1 font-mono text-[var(--color-onetextmuted)]">
              <Link2 aria-hidden="true" className="h-3 w-3" />
              {shortHash(event.prev_hash)}
            </dd>
            <dt className="font-medium text-[var(--color-onetextsecondary)]">
              {t("auditPage.row.hash")}
            </dt>
            <dd className="font-mono text-[var(--color-onetextmuted)]">{shortHash(event.hash)}</dd>
          </dl>
        </div>
      )}
    </li>
  );
}

export function AuditTrailPage() {
  const { t } = useTranslation();
  const sessionCompanyId = useSessionStore((s) => s.companyId);

  const status = useAuditStore((s) => s.status);
  const error = useAuditStore((s) => s.error);
  const events = useAuditStore((s) => s.events);
  const chainStatus = useAuditStore((s) => s.chainStatus);
  const meta = useAuditStore((s) => s.meta);
  const facets = useAuditStore((s) => s.facets);
  const filters = useAuditStore((s) => s.filters);
  const page = useAuditStore((s) => s.page);

  const load = useAuditStore((s) => s.load);
  const setFilter = useAuditStore((s) => s.setFilter);
  const clearFilters = useAuditStore((s) => s.clearFilters);
  const goToPage = useAuditStore((s) => s.goToPage);
  const retry = useAuditStore((s) => s.retry);
  const hasActiveFilter = useAuditStore((s) => s.hasActiveFilter);

  const [exportLoading, setExportLoading] = useState<"dataroom" | "log" | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
  const [exportError, setExportError] = useState<BridgeError | null>(null);

  useEffect(() => {
    if (!sessionCompanyId) return;
    void load({ companyId: sessionCompanyId, page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCompanyId]);

  const chainBroken = chainStatus !== null && !chainStatus.verified;
  const totalPages = meta?.total_pages ?? 0;
  const filtered = hasActiveFilter();

  const handleExportDataRoom = async () => {
    if (!sessionCompanyId) return;
    setExportLoading("dataroom");
    setExportSuccess(null);
    setExportError(null);
    try {
      await call("audit.export_dataroom", {
        company_id: sessionCompanyId,
        period_scope: [],
      });
      setExportSuccess(
        t("auditPage.exportDataRoomSuccess", "Auditor data-room package exported successfully."),
      );
    } catch (e) {
      setExportError(toBridgeError(e));
    } finally {
      setExportLoading(null);
    }
  };

  const handleExportLog = async () => {
    if (!sessionCompanyId) return;
    setExportLoading("log");
    setExportSuccess(null);
    setExportError(null);
    try {
      await call("export.excel", {
        scope: { company_id: sessionCompanyId, type: "audit_log" },
      });
      setExportSuccess(
        t("auditPage.exportLogSuccess", "Audit log exported to Excel successfully."),
      );
    } catch (e) {
      setExportError(toBridgeError(e));
    } finally {
      setExportLoading(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-oneapp)]">
      <header className="border-b border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-6 py-4">
        <h1 className="text-lg font-semibold text-[var(--color-onetext)]">
          {t("auditPage.title")}
        </h1>
        <p className="mt-0.5 text-sm text-[var(--color-onetextmuted)]">{t("auditPage.subtitle")}</p>
      </header>

      {chainBroken && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-[var(--color-oneunfavorable)] bg-[var(--color-oneunfavorable)]/10 px-6 py-3 text-sm text-[var(--color-oneunfavorable)]"
        >
          <ShieldAlert aria-hidden="true" className="h-4 w-4" />
          <span className="font-medium">
            {t("auditPage.chainBrokenBanner", { seq: chainStatus?.broken_at_seq ?? 0 })}
          </span>
          <span className="text-[var(--color-onetextsecondary)]">
            {t("auditPage.chainBrokenHint")}
          </span>
        </div>
      )}

      {exportError && (
        <div
          role="alert"
          data-testid="audit-export-error-banner"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-oneunfavorable)] bg-[var(--color-oneunfavorable)]/10 px-6 py-3 text-sm text-[var(--color-oneunfavorable)]"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="font-semibold">{exportError.code}:</span>
            <span>{exportError.userMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setExportError(null)}
            className="rounded px-2 py-1 text-xs font-medium text-[var(--color-oneunfavorable)] hover:bg-[var(--color-oneunfavorable)]/10"
          >
            {t("auditPage.dismiss", "Dismiss")}
          </button>
        </div>
      )}

      {exportSuccess && (
        <div
          role="status"
          data-testid="audit-export-success-banner"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-onefavorable)] bg-[var(--color-onefavorable)]/10 px-6 py-2.5 text-sm text-[var(--color-onefavorable)]"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>{exportSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setExportSuccess(null)}
            className="rounded px-2 py-1 text-xs font-medium text-[var(--color-onefavorable)] hover:bg-[var(--color-onefavorable)]/10"
          >
            {t("auditPage.dismiss", "Dismiss")}
          </button>
        </div>
      )}

      {exportLoading && (
        <div
          role="status"
          aria-live="polite"
          data-testid="audit-export-loading-banner"
          className="flex items-center gap-2 border-b border-[var(--color-oneprimary)] bg-[var(--color-oneprimary)]/10 px-6 py-2 text-xs text-[var(--color-oneprimary)]"
        >
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin shrink-0" />
          <span>
            {exportLoading === "dataroom"
              ? t("auditPage.exportingDataRoom", "Exporting Auditor Data-Room package...")
              : t("auditPage.exportingLog", "Exporting audit log...")}
          </span>
        </div>
      )}

      <section
        aria-label={t("auditPage.filtersLabel")}
        className="flex flex-wrap items-end gap-4 border-b border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-6 py-3"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-from" className="text-xs text-[var(--color-onetextsecondary)]">
            {t("auditPage.filters.from")}
          </label>
          <input
            id="audit-from"
            type="date"
            value={filters.from ? filters.from.slice(0, 10) : ""}
            onChange={(e) =>
              void setFilter("from", e.target.value ? `${e.target.value}T00:00:00Z` : null)
            }
            className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1.5 text-sm text-[var(--color-onetext)]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-to" className="text-xs text-[var(--color-onetextsecondary)]">
            {t("auditPage.filters.to")}
          </label>
          <input
            id="audit-to"
            type="date"
            value={filters.to ? filters.to.slice(0, 10) : ""}
            onChange={(e) =>
              void setFilter("to", e.target.value ? `${e.target.value}T23:59:59Z` : null)
            }
            className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1.5 text-sm text-[var(--color-onetext)]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-actor" className="text-xs text-[var(--color-onetextsecondary)]">
            {t("auditPage.filters.actor")}
          </label>
          <select
            id="audit-actor"
            value={filters.actor ?? ""}
            onChange={(e) => void setFilter("actor", e.target.value || null)}
            className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1.5 text-sm text-[var(--color-onetext)]"
          >
            <option value="">{t("auditPage.filters.any")}</option>
            {facets.actors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-action" className="text-xs text-[var(--color-onetextsecondary)]">
            {t("auditPage.filters.action")}
          </label>
          <select
            id="audit-action"
            value={filters.action ?? ""}
            onChange={(e) => void setFilter("action", e.target.value || null)}
            className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1.5 text-sm text-[var(--color-onetext)]"
          >
            <option value="">{t("auditPage.filters.any")}</option>
            {facets.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-object" className="text-xs text-[var(--color-onetextsecondary)]">
            {t("auditPage.filters.objectType")}
          </label>
          <select
            id="audit-object"
            value={filters.objectType ?? ""}
            onChange={(e) => void setFilter("objectType", e.target.value || null)}
            className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1.5 text-sm text-[var(--color-onetext)]"
          >
            <option value="">{t("auditPage.filters.any")}</option>
            {facets.objectTypes.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        {filtered && (
          <Button variant="secondary" size="sm" onClick={() => void clearFilters()}>
            {t("auditPage.filters.clear")}
          </Button>
        )}

        <span
          data-testid="audit-chain-chip"
          className={[
            "ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
            chainBroken
              ? "bg-[var(--color-oneunfavorable)]/10 text-[var(--color-oneunfavorable)]"
              : "bg-[var(--color-onefavorable)]/10 text-[var(--color-onefavorable)]",
          ].join(" ")}
        >
          {chainBroken ? (
            <ShieldAlert aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {chainBroken ? t("auditPage.chain.broken") : t("auditPage.chain.verified")}
        </span>
      </section>

      <main className="flex flex-1 flex-col p-6">
        {status === "loading" && (
          <div role="status" aria-label={t("auditPage.loadingLabel")} className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-9 w-full animate-pulse rounded-md bg-[var(--color-onesurfacealt)]"
              />
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

        {status === "empty" && !sessionCompanyId && (
          <StatePanel state="empty" message={t("auditPage.noCompany")} />
        )}

        {status === "empty" && sessionCompanyId && (
          <StatePanel
            state="empty"
            message={filtered ? t("auditPage.emptyFiltered") : t("auditPage.empty")}
            actionLabel={filtered ? t("auditPage.filters.clear") : undefined}
            onAction={filtered ? () => void clearFilters() : undefined}
          />
        )}

        {status === "populated" && (
          <section
            aria-label={t("auditPage.tableLabel")}
            className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)]"
          >
            <h2 className="sr-only">{t("auditPage.tableLabel")}</h2>
            <div className="grid grid-cols-[auto_10rem_7rem_11rem_1fr] gap-3 border-b border-[var(--color-oneborder)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-onetextsecondary)]">
              <span>{t("auditPage.columns.event")}</span>
              <span>{t("auditPage.columns.timestamp")}</span>
              <span>{t("auditPage.columns.actor")}</span>
              <span>{t("auditPage.columns.action")}</span>
              <span>{t("auditPage.columns.object")}</span>
            </div>
            <ul>
              {events.map((event) => (
                <EventRow key={event.seq} event={event} />
              ))}
            </ul>
          </section>
        )}

        {totalPages > 1 && (
          <nav
            aria-label={t("auditPage.paginationLabel")}
            className="mt-3 flex items-center gap-3 text-sm"
          >
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => void goToPage(page - 1)}
            >
              {t("auditPage.previous")}
            </Button>
            <span className="text-[var(--color-onetextsecondary)]">
              {t("auditPage.pageOf", { page, totalPages })}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => void goToPage(page + 1)}
            >
              {t("auditPage.next")}
            </Button>
          </nav>
        )}
      </main>

      <footer className="flex flex-wrap items-center gap-3 border-t border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-6 py-2 text-xs text-[var(--color-onetextmuted)]">
        <span>{t("auditPage.footerCount", { count: chainStatus?.event_count ?? 0 })}</span>
        <span aria-hidden="true">·</span>
        <span>{chainBroken ? t("auditPage.chain.broken") : t("auditPage.chain.verified")}</span>
        <span className="ml-auto flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!sessionCompanyId || exportLoading !== null}
            onClick={() => void handleExportDataRoom()}
            title={t("auditPage.exportDataRoom")}
          >
            {exportLoading === "dataroom" ? (
              <Loader2 aria-hidden="true" className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
            )}
            {exportLoading === "dataroom"
              ? t("auditPage.exporting", "Exporting...")
              : t("auditPage.exportDataRoom")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!sessionCompanyId || exportLoading !== null}
            onClick={() => void handleExportLog()}
            title={t("auditPage.exportLog")}
          >
            {exportLoading === "log" ? (
              <Loader2 aria-hidden="true" className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
            )}
            {exportLoading === "log"
              ? t("auditPage.exporting", "Exporting...")
              : t("auditPage.exportLog")}
          </Button>
        </span>
      </footer>
    </div>
  );
}

export default AuditTrailPage;
