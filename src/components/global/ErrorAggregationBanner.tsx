import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronDown, ChevronUp, X } from "lucide-react";
import { useErrorLogStore, selectAggregated, type ErrorLogGroup } from "@/stores/errorLog";

/**
 * ERROR-HANDLING §3 rule 7: 5+ identical errors in 1 min → collapsed banner with a
 * link to the error log. Mounted once in the S-004 shell; fed by the API bridge.
 * Collapsed by default (never steals focus); "View error log" expands the in-session
 * log (code, catalog copy, count, last-seen time) with per-group dismiss.
 */
export function ErrorAggregationBanner() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const groups = useErrorLogStore((s) => s.groups);
  const dismiss = useErrorLogStore((s) => s.dismiss);
  const aggregated = selectAggregated(groups);

  if (aggregated.length === 0) return null;

  const timeOf = (at: number) =>
    new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="error-aggregation-banner"
      className="shrink-0 border-b border-[var(--color-oneerror)]/30 bg-[var(--color-onesurface)] px-4 py-2"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <AlertTriangle
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-[var(--color-oneerror)]"
        />
        <span className="font-medium text-[var(--color-onetext)]">
          {t("shell.errorLog.bannerTitle")}
        </span>
        {aggregated.slice(0, 3).map((g) => (
          <span
            key={g.key}
            className="rounded-full bg-[var(--color-onesurfacealt)] px-2 py-0.5 font-mono text-xs text-[var(--color-onetextsecondary)]"
          >
            {g.code} ×{g.count}
          </span>
        ))}
        {aggregated.length > 3 && (
          <span className="text-xs text-[var(--color-onetextmuted)]">
            {t("shell.errorLog.moreGroups", { count: aggregated.length - 3 })}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[var(--color-oneprimary)] hover:bg-[var(--color-onesurfacealt)]"
        >
          {open ? (
            <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {open ? t("shell.errorLog.hideLog") : t("shell.errorLog.viewLog")}
        </button>
      </div>

      {open && (
        <div className="mt-2 overflow-x-auto" data-testid="error-log">
          <table className="w-full text-left text-sm" role="table">
            <caption className="sr-only">{t("shell.errorLog.logCaption")}</caption>
            <thead>
              <tr className="border-b border-[var(--color-oneborder)] text-xs font-semibold text-[var(--color-onetextmuted)]">
                <th scope="col" className="pb-2 pr-4 font-semibold">
                  {t("shell.errorLog.colCode")}
                </th>
                <th scope="col" className="pb-2 px-4 font-semibold">
                  {t("shell.errorLog.colMeaning")}
                </th>
                <th scope="col" className="pb-2 px-4 font-semibold">
                  {t("shell.errorLog.colCount")}
                </th>
                <th scope="col" className="pb-2 px-4 font-semibold">
                  {t("shell.errorLog.colLastSeen")}
                </th>
                <th scope="col" className="pb-2 pl-4 font-semibold">
                  <span className="sr-only">{t("shell.errorLog.dismiss")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-oneborder)]">
              {aggregated.map((g: ErrorLogGroup) => (
                <tr key={g.key} data-testid={`error-log-row-${g.code}`}>
                  <td className="py-2 pr-4 align-top">
                    <code className="rounded bg-[var(--color-onesurfacealt)] px-1.5 py-0.5 font-mono text-xs">
                      {g.code}
                    </code>
                  </td>
                  <td className="py-2 px-4 align-top text-[var(--color-onetext)]">
                    {g.userMessage}
                  </td>
                  <td className="py-2 px-4 align-top text-xs text-[var(--color-onetextsecondary)]">
                    {t("shell.errorLog.timesInLastMinute", { count: g.count })}
                  </td>
                  <td className="py-2 px-4 align-top text-xs text-[var(--color-onetextmuted)]">
                    {timeOf(g.lastAt)}
                  </td>
                  <td className="py-2 pl-4 text-right align-top">
                    <button
                      type="button"
                      onClick={() => dismiss(g.key)}
                      aria-label={t("shell.errorLog.dismissGroup", { code: g.code })}
                      className="rounded p-1 text-[var(--color-onetextmuted)] hover:bg-[var(--color-onesurfacealt)] hover:text-[var(--color-onetext)]"
                    >
                      <X aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
