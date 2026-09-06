/**
 * S-061 Segment Report screen (F-028 · M6-2 · SCREENS-SPEC S-061).
 *
 * Purpose: F-028 ASC 280-style BU × lines segment reporting.
 * Elements:
 *   - BU columns (own currency + translated)
 *   - Eliminations column
 *   - Group total
 *   - Period selector
 *   - Drill to BU statement (scoped to /app/reports/statements/pl?bu_id=...)
 *   - Column-level error chips for IC_UNMATCHED and SEGMENT_TRANSLATION_PENDING
 *   - All 5 canonical states: loading / empty / error / success / populated
 *
 * Money rule (B6/MONEY-ROUNDING-SPEC): renders exact minor units via MoneyCell.
 */

import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MoneyCell } from "@/components/domain/MoneyCell";
import { StatePanel } from "@/components/ui/StatePanel";
import { useSessionStore } from "@/stores/session";
import { useStatementStore } from "@/stores/statements";

interface SegmentBuColumn {
  id: string;
  name: string;
  currency: string;
  calendarChip: string;
  localKey: string;
  translatedKey: string;
}

const DEFAULT_BUS: SegmentBuColumn[] = [
  {
    id: "bu-us",
    name: "US Operating Unit",
    currency: "USD",
    calendarChip: "FY2026 · Std 12M",
    localKey: "bu-us-local",
    translatedKey: "bu-us-translated",
  },
  {
    id: "bu-uk",
    name: "UK International",
    currency: "GBP",
    calendarChip: "FY2026 · 4-5-4 Retail",
    localKey: "bu-uk-local",
    translatedKey: "bu-uk-translated",
  },
];

export function SegmentReportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionCompanyId = useSessionStore((s) => s.companyId);

  const store = useStatementStore();
  const state = store.status;
  const error = store.error;
  const rows = store.rows;
  const totals = store.totals;
  const tieoutStatus = store.tieoutStatus ?? "pass";
  const currency = store.currency ?? "USD";

  const [period, setPeriod] = useState<string>(searchParams.get("period") || "fp_2026_p01");
  const [bus] = useState<SegmentBuColumn[]>(DEFAULT_BUS);

  useEffect(() => {
    if (!sessionCompanyId) {
      store.setCompanyId(null);
      return;
    }
    void store.loadStatement({
      companyId: sessionCompanyId,
      type: "segment",
      periodScope: [period],
      preset: "us_gaap",
      rounding: { mode: "two_decimals", largest_remainder: true },
      buScope: { kind: "all", bu_id: null },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCompanyId, period]);

  const triggerReload = () => {
    if (sessionCompanyId) {
      void store.loadStatement({
        companyId: sessionCompanyId,
        type: "segment",
        periodScope: [period],
        preset: "us_gaap",
        rounding: { mode: "two_decimals", largest_remainder: true },
        buScope: { kind: "all", bu_id: null },
      });
    }
  };

  const handlePeriodChange = (newPeriod: string) => {
    setPeriod(newPeriod);
    setSearchParams({ period: newPeriod });
  };

  const drillToBu = (buId: string) => {
    navigate(`/app/reports/statements/pl?bu_id=${buId}`);
  };

  const isIcUnmatched = error?.code === "IC_UNMATCHED";
  const isFxPending = error?.code === "SEGMENT_TRANSLATION_PENDING";

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-oneapp)]" data-testid="segment-page">
      <header className="border-b border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-[var(--color-onetext)]">
              {t("segmentPage.title")}
            </h1>
            <p className="mt-0.5 text-sm text-[var(--color-onetextmuted)]">
              {t("segmentPage.subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={triggerReload}
              className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-3 py-1.5 text-sm font-medium text-[var(--color-onetext)] hover:bg-[var(--color-oneapp)]"
            >
              {t("segmentPage.runConsolidation")}
            </button>
            <button
              type="button"
              disabled={tieoutStatus === "fail"}
              className="rounded-md bg-[var(--color-oneprimary)] px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("segmentPage.export")}
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label
              htmlFor="segment-period-select"
              className="text-sm text-[var(--color-onetextsecondary)]"
            >
              {t("segmentPage.periodLabel")}
            </label>
            <select
              id="segment-period-select"
              aria-label={t("segmentPage.periodSelectAria")}
              value={period}
              onChange={(e) => handlePeriodChange(e.target.value)}
              className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2.5 py-1 text-sm text-[var(--color-onetext)]"
            >
              <option value="fp_2026_p01">2026-P01 (Jan 2026)</option>
              <option value="fp_2026_p02">2026-P02 (Feb 2026)</option>
            </select>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6">
        {state === "loading" && (
          <div role="status" aria-label={t("segmentPage.loadingLabel")} className="p-8 text-center">
            <StatePanel state="loading" message={t("segmentPage.loadingLabel")} />
          </div>
        )}

        {state === "empty" && (
          <StatePanel
            state="empty"
            message={t("segmentPage.emptyNoBus")}
            actionLabel={t("segmentPage.retry")}
            onAction={triggerReload}
          />
        )}

        {state === "error" && (
          <StatePanel
            state="error"
            message={error?.userMessage || t("segmentPage.errorGeneric")}
            errorCode={error?.code}
            onRetry={triggerReload}
          />
        )}

        {(state === "populated" || (state === "success" && rows.length > 0)) && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={[
                    "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    tieoutStatus === "pass"
                      ? "bg-emerald-500/10 text-emerald-600"
                      : "bg-rose-500/10 text-rose-600",
                  ].join(" ")}
                >
                  {tieoutStatus === "pass"
                    ? t("segmentPage.groupTiePass")
                    : t("segmentPage.groupTieFail")}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)]">
              <table
                className="w-full border-collapse text-left text-sm"
                aria-label={t("segmentPage.tableAria")}
              >
                <thead>
                  <tr className="border-b border-[var(--color-oneborder)] bg-[var(--color-oneapp)]/50">
                    <th scope="col" className="px-4 py-3 font-semibold text-[var(--color-onetext)]">
                      {t("segmentPage.line")}
                    </th>
                    {bus.map((bu) => (
                      <th
                        key={bu.id}
                        scope="col"
                        colSpan={2}
                        className="border-l border-[var(--color-oneborder)] px-4 py-3 text-center"
                      >
                        <div className="flex items-center justify-center gap-2 font-semibold text-[var(--color-onetext)]">
                          <span>{bu.name}</span>
                          <button
                            type="button"
                            onClick={() => drillToBu(bu.id)}
                            className="text-xs text-[var(--color-oneprimary)] hover:underline"
                            title={t("segmentPage.drillToBu")}
                          >
                            ↗
                          </button>
                        </div>
                        <div className="mt-1 flex items-center justify-center gap-2">
                          <span className="rounded bg-[var(--color-oneborder)]/40 px-1.5 py-0.5 text-xs text-[var(--color-onetextmuted)]">
                            {bu.calendarChip}
                          </span>
                          {isIcUnmatched && (
                            <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-xs font-medium text-rose-600">
                              IC_UNMATCHED
                            </span>
                          )}
                          {isFxPending && (
                            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-600">
                              FX_PENDING
                            </span>
                          )}
                        </div>
                      </th>
                    ))}
                    <th
                      scope="col"
                      className="border-l border-[var(--color-oneborder)] px-4 py-3 text-right font-semibold text-[var(--color-onetext)]"
                    >
                      {t("segmentPage.eliminations")}
                    </th>
                    <th
                      scope="col"
                      className="border-l border-[var(--color-oneborder)] px-4 py-3 text-right font-semibold text-[var(--color-onetext)]"
                    >
                      {t("segmentPage.groupTotal")}
                    </th>
                  </tr>
                  <tr className="border-b border-[var(--color-oneborder)] bg-[var(--color-oneapp)]/30 text-xs text-[var(--color-onetextsecondary)]">
                    <th scope="col" className="px-4 py-1.5">
                      <span className="sr-only">{t("segmentPage.line")}</span>
                    </th>
                    {bus.map((bu) => (
                      <React.Fragment key={bu.id}>
                        <th
                          scope="col"
                          className="border-l border-[var(--color-oneborder)] px-3 py-1.5 text-right font-normal"
                        >
                          {t("segmentPage.localCcy")} ({bu.currency})
                        </th>
                        <th scope="col" className="px-3 py-1.5 text-right font-normal">
                          {t("segmentPage.translated")} ({currency})
                        </th>
                      </React.Fragment>
                    ))}
                    <th
                      scope="col"
                      className="border-l border-[var(--color-oneborder)] px-4 py-1.5 text-right font-normal"
                    >
                      ({currency})
                    </th>
                    <th
                      scope="col"
                      className="border-l border-[var(--color-oneborder)] px-4 py-1.5 text-right font-normal"
                    >
                      ({currency})
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-oneborder)]/50">
                  {rows.map((sec) => (
                    <React.Fragment key={sec.section}>
                      <tr>
                        <td
                          colSpan={2 + bus.length * 2}
                          className="bg-[var(--color-oneapp)]/20 px-4 py-2 font-semibold text-[var(--color-onetext)]"
                        >
                          {sec.section}
                        </td>
                      </tr>
                      {sec.lines.map((line) => (
                        <tr
                          key={line.account_id}
                          className="hover:bg-[var(--color-oneapp)]/40"
                          data-testid={`segment-line-${line.account_id}`}
                        >
                          <td className="px-4 py-2 text-[var(--color-onetext)]">{line.label}</td>
                          {bus.map((bu) => (
                            <React.Fragment key={bu.id}>
                              <td className="border-l border-[var(--color-oneborder)] px-3 py-2 text-right">
                                <MoneyCell
                                  minor={line.values[bu.localKey] ?? 0}
                                  currency={bu.currency}
                                />
                              </td>
                              <td className="px-3 py-2 text-right">
                                <MoneyCell
                                  minor={line.values[bu.translatedKey] ?? 0}
                                  currency={currency}
                                />
                              </td>
                            </React.Fragment>
                          ))}
                          <td className="border-l border-[var(--color-oneborder)] px-4 py-2 text-right text-rose-600">
                            <MoneyCell
                              minor={line.values["eliminations"] ?? 0}
                              currency={currency}
                            />
                          </td>
                          <td className="border-l border-[var(--color-oneborder)] px-4 py-2 text-right font-medium text-[var(--color-onetext)]">
                            <MoneyCell minor={line.values["group"] ?? 0} currency={currency} />
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                  {totals && (
                    <tr className="border-t-2 border-[var(--color-oneborder)] bg-[var(--color-oneapp)]/30 font-bold">
                      <td className="px-4 py-3 text-[var(--color-onetext)]">
                        {t("segmentPage.groupTotal")}
                      </td>
                      {bus.map((bu) => (
                        <React.Fragment key={bu.id}>
                          <td className="border-l border-[var(--color-oneborder)] px-3 py-3 text-right">
                            —
                          </td>
                          <td className="px-3 py-3 text-right">—</td>
                        </React.Fragment>
                      ))}
                      <td className="border-l border-[var(--color-oneborder)] px-4 py-3 text-right">
                        —
                      </td>
                      <td className="border-l border-[var(--color-oneborder)] px-4 py-3 text-right">
                        <MoneyCell
                          minor={totals.operating_income ?? totals.revenue ?? 0}
                          currency={currency}
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default SegmentReportPage;
