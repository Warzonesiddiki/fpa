/**
 * S-060 Statements screen (F-027 · M6-1 · SCREENS-SPEC S-060).
 *
 * Purpose: F-027 statement suite; **type** ∈ `pl|bs|cf|soce|segment`.
 * M6-1 slice: P&L + Balance Sheet rendered from the Rust statement engine
 * (`statement.get.v1`); CF / SoCE / Segment tabs are shown as pending (later
 * milestones — M6-2/M6-3/CF-landing) and are never fabricated.
 *
 * Elements in this slice:
 *   - statement tabs (P&L / Balance Sheet enabled; CF / SoCE / Segment pending)
 *   - presentation preset (US GAAP / IFRS) — labels only, engine owns the numbers
 *   - display rounding: mode (2 decimals / major units / 000s) + largest-remainder
 *     toggle; the request goes to the engine, the screen never rounds a value
 *   - rows grouped by section with the engine's exact per-period values
 *   - totals block, tie-out chip and rounding-integrity chip (engine-computed)
 *   - error state renders the canonical error copy + retry
 *   - loading skeleton + empty "no data for period" / "no Company open" states
 *
 * Money rule (B6/MONEY-ROUNDING-SPEC): this screen renders engine values verbatim via
 * MoneyCell (format-only). It performs NO money arithmetic — section/total figures are
 * never recomputed in the browser; only the engine's `rows`/`totals` are shown.
 *
 * All 5 states + axe covered by index.test.tsx.
 */

import { useEffect, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  useStatementStore,
  type StatementTypeValue,
  type StatementPresetValue,
  type RoundingModeValue,
} from "@/stores/statements";
import type { StatementLine, StatementSection } from "@/api/schema";
import { MoneyCell } from "@/components/domain/MoneyCell";
import { StatePanel } from "@/components/ui/StatePanel";
import { useSessionStore } from "@/stores/session";
import { currencyScale } from "@/utils/money";

interface StatementTypeDef {
  value: StatementTypeValue;
  enabled: boolean;
}

const STATEMENT_TYPES: StatementTypeDef[] = [
  { value: "pl", enabled: true },
  { value: "bs", enabled: true },
  { value: "cf", enabled: false },
  { value: "soce", enabled: false },
  { value: "segment", enabled: false },
];

const ROUNDING_MODES: RoundingModeValue[] = ["two_decimals", "major_units", "thousands"];

/** Column period ids present in the loaded rows, in first-seen order. */
function periodColumns(rows: StatementSection[]): string[] {
  const seen: string[] = [];
  for (const section of rows) {
    for (const line of section.lines) {
      for (const periodId of Object.keys(line.values)) {
        if (!seen.includes(periodId)) seen.push(periodId);
      }
    }
  }
  return seen;
}

function LineRow({
  line,
  columns,
  currency,
  showInThousands,
  displayDecimals,
}: {
  line: StatementLine;
  columns: string[];
  currency: string;
  showInThousands: boolean;
  displayDecimals?: number;
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 border-b border-[var(--color-oneborder)]/60 py-1.5 text-sm"
      data-testid={`stmt-line-${line.account_id}`}
    >
      <span className="min-w-0 flex-1 truncate text-[var(--color-onetext)]" title={line.label}>
        {line.label}
      </span>
      <span className="flex shrink-0 items-baseline gap-6">
        {columns.map((periodId) => {
          const minor = line.values[periodId];
          if (minor === undefined)
            return (
              <span key={periodId} className="w-28 text-right text-[var(--color-onetextmuted)]">
                —
              </span>
            );
          return (
            <span key={periodId} className="w-28 text-right">
              <MoneyCell
                minor={minor}
                currency={currency}
                showInThousands={showInThousands}
                displayDecimals={displayDecimals}
              />
            </span>
          );
        })}
      </span>
    </div>
  );
}

export function StatementsPage() {
  const { t } = useTranslation();
  const { type: routeType } = useParams<{ type?: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionCompanyId = useSessionStore((s) => s.companyId);

  const status = useStatementStore((s) => s.status);
  const storeError = useStatementStore((s) => s.error);
  const rows = useStatementStore((s) => s.rows);
  const totals = useStatementStore((s) => s.totals);
  const tieoutStatus = useStatementStore((s) => s.tieoutStatus);
  const roundingStatus = useStatementStore((s) => s.roundingStatus);
  const findings = useStatementStore((s) => s.findings);
  const currency = useStatementStore((s) => s.currency) ?? "USD";
  const storeRounding = useStatementStore((s) => s.rounding);
  const storeCompanyId = useStatementStore((s) => s.companyId);
  const storePreset = useStatementStore((s) => s.preset);

  const setType = useStatementStore((s) => s.setType);
  const setPresetAction = useStatementStore((s) => s.setPreset);
  const setRounding = useStatementStore((s) => s.setRounding);
  const setCompanyId = useStatementStore((s) => s.setCompanyId);
  const loadStatement = useStatementStore((s) => s.loadStatement);
  const retry = useStatementStore((s) => s.retry);

  const activeType: StatementTypeValue =
    (routeType && STATEMENT_TYPES.find((s) => s.value === routeType && s.enabled)?.value) || "pl";

  // Company identity: the store is scoped to the session's open Company.
  const companyId = storeCompanyId ?? sessionCompanyId;

  const presetFromSearch = searchParams.get("preset");
  const preset: StatementPresetValue =
    presetFromSearch === "ifrs" || presetFromSearch === "us_gaap" ? presetFromSearch : storePreset;

  const roundingMode = storeRounding.mode;
  const largestRemainder = storeRounding.largest_remainder;

  // Mirror route/URL state into the store only when it actually differs (guards against
  // set → re-render loops — the zustand actions are stable references).
  useEffect(() => {
    if (useStatementStore.getState().type !== activeType) setType(activeType);
  }, [activeType, setType]);

  useEffect(() => {
    if (useStatementStore.getState().preset !== preset) setPresetAction(preset);
  }, [preset, setPresetAction]);

  // (Re)load whenever the statement identity or display request changes.
  useEffect(() => {
    if (!companyId) {
      setCompanyId(null);
      return;
    }
    setCompanyId(companyId);
    loadStatement({
      companyId,
      type: activeType,
      preset,
      rounding: useStatementStore.getState().rounding,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, activeType, preset, roundingMode, largestRemainder]);

  const setPreset = (next: StatementPresetValue) => {
    setPresetAction(next);
    setSearchParams(next === "us_gaap" ? {} : { preset: next });
  };

  const setRoundingMode = (mode: RoundingModeValue) => {
    setRounding({
      mode,
      largest_remainder: useStatementStore.getState().rounding.largest_remainder,
    });
  };

  const toggleLargestRemainder = () => {
    setRounding({
      mode: useStatementStore.getState().rounding.mode,
      largest_remainder: !largestRemainder,
    });
  };

  const columns = useMemo(() => periodColumns(rows), [rows]);
  const showInThousands = roundingMode === "thousands";
  const displayDecimals =
    roundingMode === "major_units"
      ? 0
      : roundingMode === "two_decimals"
        ? currencyScale(currency)
        : undefined;

  const totalRows = useMemo(
    () => rows.reduce((acc, section) => acc + section.lines.length, 0),
    [rows],
  );

  const populated = status === "populated" || (status === "success" && rows.length > 0);

  // Engine-provided totals only — the screen never recomputes a money figure (B6).
  // Null/undefined slots (e.g. BS totals on a P&L statement) are simply not rendered.
  const totalsEntries = useMemo<Array<[string, number]>>(() => {
    if (!totals) return [];
    const entries: Array<[string, number | null]> = [
      ["revenue", totals.revenue],
      ["gross_profit", totals.gross_profit],
      ["operating_income", totals.operating_income],
      ["net_income", totals.net_income],
      ["total_assets", totals.total_assets],
      ["total_liabilities", totals.total_liabilities],
      ["total_equity", totals.total_equity],
      ["net_cash_change", totals.net_cash_change],
      ["ending_cash", totals.ending_cash],
    ];
    return entries.filter(
      (entry): entry is [string, number] => entry[1] !== null && entry[1] !== undefined,
    );
  }, [totals]);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-oneapp)]">
      <header className="border-b border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-6 py-4">
        <h1 className="text-lg font-semibold text-[var(--color-onetext)]">
          {t("statementsPage.title")}
        </h1>
        <p className="mt-0.5 text-sm text-[var(--color-onetextmuted)]">
          {t("statementsPage.subtitle")}
        </p>
        <nav className="mt-3 flex flex-wrap gap-2" aria-label={t("statementsPage.tabsNav")}>
          {STATEMENT_TYPES.map((def) => {
            const label = t(`statementsPage.types.${def.value}`);
            return (
              <button
                key={def.value}
                type="button"
                disabled={!def.enabled}
                aria-pressed={activeType === def.value && def.enabled}
                onClick={() => navigate(`/app/reports/statements/${def.value}`, { replace: true })}
                className={[
                  "rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50",
                  activeType === def.value && def.enabled
                    ? "border-[var(--color-oneprimary)] bg-[var(--color-oneprimary)] text-white"
                    : "border-[var(--color-oneborder)] bg-[var(--color-onesurface)] text-[var(--color-onetextsecondary)] hover:border-[var(--color-oneprimary)]",
                ].join(" ")}
              >
                {label}
                {!def.enabled && (
                  <span className="ml-1 text-xs text-[var(--color-onetextmuted)]">
                    {t("statementsPage.pending")}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="flex flex-wrap items-center gap-4 border-b border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-6 py-3">
        <div className="flex items-center gap-2">
          <label htmlFor="stmt-preset" className="text-sm text-[var(--color-onetextsecondary)]">
            {t("statementsPage.presetLabel")}
          </label>
          <select
            id="stmt-preset"
            value={preset}
            aria-label={t("statementsPage.presetSelectAria")}
            onChange={(e) => setPreset(e.target.value as StatementPresetValue)}
            className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1.5 text-sm text-[var(--color-onetext)] focus:outline-none focus:ring-2 focus:ring-[var(--color-oneprimary)]"
          >
            <option value="us_gaap">{t("statementsPage.presets.us_gaap")}</option>
            <option value="ifrs">{t("statementsPage.presets.ifrs")}</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="stmt-rounding" className="text-sm text-[var(--color-onetextsecondary)]">
            {t("statementsPage.roundingLabel")}
          </label>
          <select
            id="stmt-rounding"
            value={roundingMode}
            aria-label={t("statementsPage.roundingSelectAria")}
            onChange={(e) => setRoundingMode(e.target.value as RoundingModeValue)}
            className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1.5 text-sm text-[var(--color-onetext)] focus:outline-none focus:ring-2 focus:ring-[var(--color-oneprimary)]"
          >
            {ROUNDING_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`statementsPage.roundingModes.${mode}`)}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={largestRemainder}
          aria-label={t("statementsPage.largestRemainderAria")}
          onClick={toggleLargestRemainder}
          className={[
            "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
            largestRemainder
              ? "border-[var(--color-oneprimary)] bg-[var(--color-oneprimary)]/5 text-[var(--color-oneprimary)]"
              : "border-[var(--color-oneborder)] bg-[var(--color-onesurface)] text-[var(--color-onetextsecondary)]",
          ].join(" ")}
        >
          <span
            className={[
              "inline-block h-4 w-7 rounded-full transition-colors",
              largestRemainder ? "bg-[var(--color-oneprimary)]" : "bg-[var(--color-oneborder)]",
            ].join(" ")}
            aria-hidden="true"
          />
          <span className="text-xs font-medium">
            {t(
              largestRemainder
                ? "statementsPage.largestRemainderOn"
                : "statementsPage.largestRemainderOff",
            )}
          </span>
        </button>
      </div>

      <main className="flex-1 space-y-4 p-6">
        {storeError && (
          <StatePanel
            state="error"
            message={storeError.userMessage || t("statementsPage.errorTitle")}
            onRetry={storeError.retryable ? () => void retry() : undefined}
          >
            <p className="rounded bg-[var(--color-onesurfacealt)] px-2 py-1 font-mono text-xs text-[var(--color-onetextsecondary)]">
              {storeError.code}
            </p>
            {findings.length > 0 && (
              <ul
                className="mt-1 w-full space-y-1 text-left"
                aria-label={t("statementsPage.findingsLabel")}
              >
                {findings.map((f, i) => (
                  <li key={`${f.code}-${i}`} className="text-sm text-[var(--color-onetextmuted)]">
                    {f.detail || f.message}
                  </li>
                ))}
              </ul>
            )}
          </StatePanel>
        )}

        {status === "loading" && (
          <div role="status" aria-label={t("statementsPage.loadingLabel")} className="space-y-4">
            <div className="h-6 w-48 animate-pulse rounded-md bg-[var(--color-onesurfacealt)]" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-10 w-full animate-pulse rounded-md bg-[var(--color-onesurfacealt)]"
              />
            ))}
          </div>
        )}

        {status === "empty" && !companyId && (
          <StatePanel state="empty">
            <h2 className="text-base font-semibold text-[var(--color-onetext)]">
              {t("statementsPage.noCompanyTitle")}
            </h2>
            <p className="text-sm text-[var(--color-onetextmuted)]">
              {t("statementsPage.noCompanyBody")}
            </p>
          </StatePanel>
        )}

        {status === "empty" && companyId && (
          <StatePanel state="empty">
            <h2 className="text-base font-semibold text-[var(--color-onetext)]">
              {t("statementsPage.emptyTitle")}
            </h2>
            <p className="text-sm text-[var(--color-onetextmuted)]">
              {t("statementsPage.emptyBody")}
            </p>
          </StatePanel>
        )}

        {populated && (
          <div aria-label={t("statementsPage.bodyLabel")}>
            <p
              className="mb-2 text-xs text-[var(--color-onetextmuted)]"
              aria-label={t("statementsPage.metaLabel")}
            >
              {t("statementsPage.meta", {
                type: t(`statementsPage.typeShort.${activeType}`),
                preset: t(`statementsPage.presets.${preset}`),
                count: columns.length,
                currency,
              })}
            </p>

            <div className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)]">
              {columns.length > 1 && (
                <div className="flex justify-end gap-6 border-b border-[var(--color-oneborder)] px-4 py-2 text-xs text-[var(--color-onetextmuted)]">
                  {columns.map((periodId) => (
                    <span key={periodId} className="w-28 text-right font-mono">
                      {periodId}
                    </span>
                  ))}
                </div>
              )}
              <div className="px-4 py-2">
                {rows.map((section) => (
                  <section key={section.section} className="py-2" aria-label={section.section}>
                    <h2 className="border-b border-[var(--color-oneborder)] pb-1 text-sm font-medium text-[var(--color-onetext)]">
                      {section.section}
                    </h2>
                    <div className="mt-1 space-y-1">
                      {section.lines.map((line) => (
                        <LineRow
                          key={line.account_id}
                          line={line}
                          columns={columns}
                          currency={currency}
                          showInThousands={showInThousands}
                          displayDecimals={displayDecimals}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              {totalsEntries.length > 0 && (
                <section
                  aria-label={t("statementsPage.totalsLabel")}
                  className="border-t border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)]/50 px-4 py-2"
                >
                  {totalsEntries.map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-baseline justify-between gap-3 py-1 text-sm"
                    >
                      <span className="text-[var(--color-onetext)]">
                        {t(`statementsPage.totals.${key}`)}
                      </span>
                      <span className="w-28 text-right font-medium">
                        <MoneyCell
                          minor={value}
                          currency={currency}
                          showInThousands={showInThousands}
                          displayDecimals={displayDecimals}
                        />
                      </span>
                    </div>
                  ))}
                </section>
              )}
            </div>

            <div
              className="mt-3 flex flex-wrap items-center gap-2"
              aria-label={t("statementsPage.integrityLabel")}
            >
              <span
                className={[
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                  tieoutStatus === "pass"
                    ? "border-transparent bg-[var(--color-onefavorable)]/10 text-[var(--color-onefavorable)]"
                    : "border-transparent bg-[var(--color-oneunfavorable)]/10 text-[var(--color-oneunfavorable)]",
                ].join(" ")}
              >
                {tieoutStatus === "pass"
                  ? t("statementsPage.tieout.pass")
                  : t("statementsPage.tieout.fail")}
              </span>
              <span
                className={[
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                  roundingStatus === "exact"
                    ? "border-transparent bg-[var(--color-onefavorable)]/10 text-[var(--color-onefavorable)]"
                    : "border-transparent bg-[var(--color-onewarning)]/10 text-[var(--color-onewarning)]",
                ].join(" ")}
              >
                {roundingStatus === "exact"
                  ? t("statementsPage.rounding.exact")
                  : t("statementsPage.rounding.approximate")}
              </span>
              <span className="text-xs text-[var(--color-onetextmuted)]">
                {totalRows} {totalRows === 1 ? "line" : "lines"}
              </span>
            </div>
          </div>
        )}

        {status === "success" && rows.length === 0 && companyId && (
          <StatePanel state="empty">
            <h2 className="text-base font-semibold text-[var(--color-onetext)]">
              {t("statementsPage.emptyTitle")}
            </h2>
            <p className="text-sm text-[var(--color-onetextmuted)]">
              {t("statementsPage.emptyBody")}
            </p>
          </StatePanel>
        )}
      </main>

      <footer className="border-t border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-6 py-2 text-xs text-[var(--color-onetextmuted)]">
        {t("statementsPage.footer")}
      </footer>
    </div>
  );
}

export default StatementsPage;
