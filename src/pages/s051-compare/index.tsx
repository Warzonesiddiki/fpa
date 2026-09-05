/**
 * S-051 Model Compare (F-022 · M4-3 · SCREENS-SPEC S-051 · SCENARIO-VERSION-SPEC §4).
 *
 * Two-way cell diff between Scenarios/Versions: A/B selectors, diff table with
 * highlighting, "only changed" filter, and CSV export.
 *
 * All 5 screen states are driven by `useCompareStore.status`.
 * Money values are formatted from i64 minor units — never float (B3/B18-2).
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, Download, Filter } from "lucide-react";
import { Button, StatePanel } from "@/components/ui";
import { useCompareStore } from "@/stores/compare";
import { useScenarioStore } from "@/stores/scenarios";
import { formatPercent } from "@/utils/money";
import type { ScenarioRow, ModelDiffRow } from "@/api/schema";

/** Format i64 minor units as a display string with thousands separators. */
function fmtMoney(minor: number | null): string {
  if (minor == null) return "\u2014";
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 100);
  const frac = abs % 100;
  const majorStr = major.toLocaleString("en-US");
  return `${sign}${majorStr}.${String(frac).padStart(2, "0")}`;
}

/** Scenario selector dropdown. */
function ScenarioSelect({
  label,
  scenarios,
  value,
  onChange,
  disabled,
}: {
  label: string;
  scenarios: ScenarioRow[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--color-onetextsecondary)]">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label}
        className="rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1.5 text-sm text-[var(--color-onetext)] focus:outline-none focus:ring-2 focus:ring-[var(--color-oneprimary)]"
      >
        <option value="">Select Scenario</option>
        {scenarios.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.kind})
          </option>
        ))}
      </select>
    </label>
  );
}

/** Version selector dropdown (populated when a scenario has versions). */
function VersionSelect({
  label,
  versions,
  value,
  onChange,
  disabled,
}: {
  label: string;
  versions: { id: string; label: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--color-onetextsecondary)]">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled || versions.length === 0}
        aria-label={label}
        className="rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1.5 text-sm text-[var(--color-onetext)] focus:outline-none focus:ring-2 focus:ring-[var(--color-oneprimary)]"
      >
        <option value="">Latest (active)</option>
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Export diff rows as CSV. */
function exportCsv(rows: ModelDiffRow[]): void {
  const header = [
    "Sheet",
    "Line",
    "Period",
    "Value A",
    "Value A (minor)",
    "Formula A",
    "Value B",
    "Value B (minor)",
    "Formula B",
    "Delta (minor)",
    "Delta %",
    "Changed",
  ];
  const csvRows = rows.map((r) => [
    r.sheet_name,
    r.line_name,
    r.period_label,
    r.value_a ?? "",
    String(r.value_a_minor ?? ""),
    r.formula_a ?? "",
    r.value_b ?? "",
    String(r.value_b_minor ?? ""),
    r.formula_b ?? "",
    String(r.delta_minor),
    formatPercent(r.delta_pct),
    r.is_changed ? "Y" : "N",
  ]);
  const csv = [header, ...csvRows].map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "model-diff.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function ComparePage() {
  const { t } = useTranslation();
  const status = useCompareStore((s) => s.status);
  const storeError = useCompareStore((s) => s.error);
  const filterOnlyChanged = useCompareStore((s) => s.filterOnlyChanged);
  const diffRows = useCompareStore((s) => s.diffRows);
  const loadDiff = useCompareStore((s) => s.loadDiff);
  const retry = useCompareStore((s) => s.retry);
  const setFilterOnlyChanged = useCompareStore((s) => s.setFilterOnlyChanged);
  const getFilteredRows = useCompareStore((s) => s.getFilteredRows);

  const scenarios = useScenarioStore((s) => s.scenarios);

  // Local selection state before the user triggers Compare.
  const [localA, setLocalA] = useState<string | null>(null);
  const [localB, setLocalB] = useState<string | null>(null);
  const [localVersionA, setLocalVersionA] = useState<string | null>(null);
  const [localVersionB, setLocalVersionB] = useState<string | null>(null);

  // Versions for each selected scenario.
  const versionsA = useMemo(
    () => scenarios.find((s) => s.id === localA)?.versions ?? [],
    [scenarios, localA],
  );
  const versionsB = useMemo(
    () => scenarios.find((s) => s.id === localB)?.versions ?? [],
    [scenarios, localB],
  );

  const canCompare = localA !== null && localB !== null && localA !== localB;

  const handleCompare = useCallback(() => {
    if (!localA || !localB) return;
    void loadDiff(localA, localVersionA, localB, localVersionB);
  }, [localA, localB, localVersionA, localVersionB, loadDiff]);

  const handleSwap = useCallback(() => {
    const tmpA = localA;
    const tmpVA = localVersionA;
    setLocalA(localB);
    setLocalVersionA(localVersionB);
    setLocalB(tmpA);
    setLocalVersionB(tmpVA);
  }, [localA, localB, localVersionA, localVersionB]);

  const filteredRows = getFilteredRows();
  const changedCount = useMemo(() => diffRows.filter((r) => r.is_changed).length, [diffRows]);

  /* ── Render states ─────────────────────────────────────────────────────────── */

  if (status === "loading") {
    return (
      <main className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t("comparePage.title")}</h1>
        <StatePanel state="loading" message={t("common.loading")} />
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t("comparePage.title")}</h1>
        <StatePanel
          state="error"
          message={storeError?.userMessage ?? t("comparePage.errors.load")}
          errorCode={storeError?.code}
          onRetry={retry}
        />
      </main>
    );
  }

  if (status === "empty") {
    return (
      <main className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t("comparePage.title")}</h1>
        <p className="text-sm text-[var(--color-onetextsecondary)]">
          {t("comparePage.lead")}
        </p>

        {/* Scenario selectors */}
        <div className="flex flex-wrap items-end gap-3">
          <ScenarioSelect
            label={t("comparePage.scenarioA")}
            scenarios={scenarios}
            value={localA}
            onChange={(id) => { setLocalA(id); setLocalVersionA(null); }}
          />
          <VersionSelect
            label={t("comparePage.versionA")}
            versions={versionsA}
            value={localVersionA}
            onChange={setLocalVersionA}
          />

          <Button
            variant="ghost"
            size="sm"
            onClick={handleSwap}
            disabled={!canCompare}
            aria-label={t("comparePage.swap")}
          >
            <ArrowLeftRight aria-hidden="true" className="h-4 w-4" />
          </Button>

          <ScenarioSelect
            label={t("comparePage.scenarioB")}
            scenarios={scenarios}
            value={localB}
            onChange={(id) => { setLocalB(id); setLocalVersionB(null); }}
          />
          <VersionSelect
            label={t("comparePage.versionB")}
            versions={versionsB}
            value={localVersionB}
            onChange={setLocalVersionB}
          />

          <Button size="sm" disabled={!canCompare} onClick={handleCompare}>
            {t("comparePage.compare")}
          </Button>
        </div>

        <StatePanel
          state="empty"
          message={t("comparePage.empty")}
          actionLabel={canCompare ? t("comparePage.compare") : undefined}
          onAction={canCompare ? handleCompare : undefined}
        />
      </main>
    );
  }

  // success or populated
  return (
    <main className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("comparePage.title")}</h1>
          <p className="mt-1 text-sm text-[var(--color-onetextsecondary)]">
            {t("comparePage.lead")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilterOnlyChanged(!filterOnlyChanged)}
            aria-pressed={filterOnlyChanged}
          >
            <Filter aria-hidden="true" className="h-4 w-4" />
            {t("comparePage.onlyChanged")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => exportCsv(filteredRows)}
            disabled={filteredRows.length === 0}
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            {t("comparePage.exportCsv")}
          </Button>
        </div>
      </div>

      {/* Re-selectors */}
      <div className="flex flex-wrap items-end gap-3">
        <ScenarioSelect
          label={t("comparePage.scenarioA")}
          scenarios={scenarios}
          value={localA}
          onChange={(id) => { setLocalA(id); setLocalVersionA(null); }}
        />
        <VersionSelect
          label={t("comparePage.versionA")}
          versions={versionsA}
          value={localVersionA}
          onChange={setLocalVersionA}
        />
        <Button variant="ghost" size="sm" onClick={handleSwap} aria-label={t("comparePage.swap")}>
          <ArrowLeftRight aria-hidden="true" className="h-4 w-4" />
        </Button>
        <ScenarioSelect
          label={t("comparePage.scenarioB")}
          scenarios={scenarios}
          value={localB}
          onChange={(id) => { setLocalB(id); setLocalVersionB(null); }}
        />
        <VersionSelect
          label={t("comparePage.versionB")}
          versions={versionsB}
          value={localVersionB}
          onChange={setLocalVersionB}
        />
        <Button size="sm" disabled={!canCompare} onClick={handleCompare}>
          {t("comparePage.compare")}
        </Button>
      </div>

      {status === "success" && (
        <StatePanel state="success" message={t("comparePage.identical")} />
      )}

      {status === "populated" && (
        <>
          <p className="text-xs text-[var(--color-onetextsecondary)]">
            {t("comparePage.summary", {
              total: diffRows.length,
              changed: changedCount,
            })}
          </p>

          <div className="overflow-x-auto rounded-lg border border-[var(--color-oneborder)]">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{t("comparePage.tableCaption")}</caption>
              <thead>
                <tr className="bg-[var(--color-onesurfacealt)] text-left">
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("comparePage.col.sheet")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("comparePage.col.line")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("comparePage.col.period")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t("comparePage.col.valueA")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t("comparePage.col.valueB")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t("comparePage.col.delta")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t("comparePage.col.deltaPct")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, idx) => (
                  <tr
                    key={`${row.line_id}:${row.period_id}:${idx}`}
                    className={`border-t border-[var(--color-oneborder)] ${
                      row.is_changed ? "bg-[var(--color-oneinfo)]/5" : ""
                    }`}
                  >
                    <td className="px-3 py-2 text-[var(--color-onetextsecondary)]">
                      {row.sheet_name}
                    </td>
                    <td className="px-3 py-2 font-medium">{row.line_name}</td>
                    <td className="px-3 py-2">{row.period_label}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {fmtMoney(row.value_a_minor)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {fmtMoney(row.value_b_minor)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono text-xs ${
                        row.delta_minor > 0
                          ? "text-[var(--color-onefavorable)]"
                          : row.delta_minor < 0
                            ? "text-[var(--color-oneerror)]"
                            : ""
                      }`}
                    >
                      {row.delta_minor === 0 ? "\u2014" : fmtMoney(row.delta_minor)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {formatPercent(row.delta_pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
