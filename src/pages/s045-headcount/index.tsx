/**
 * S-045 Headcount Plan (F-016 · M3-6 · SCREENS-SPEC S-045).
 *
 * The page exposes the workforce schedule, an org-by-cost-center tree, exact day-count proration,
 * and period cost rollups. The store writes the complete schedule through the catalogued
 * `model.schedule.upsert` command before updating the preview. Native persistence/calculation is a
 * follow-on because cargo is unavailable in this sandbox; this page must remain marked PARTIAL.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, StatePanel } from "@/components/ui";
import { ModelSectionNav } from "@/components/domain/ModelSectionNav";
import { useHeadcountStore } from "@/stores/headcount";
import type { HeadcountScheduleRow } from "@/model/headcount";

const EMPTY_FORM: HeadcountScheduleRow = {
  role: "",
  cost_center: "",
  start_date: "",
  termination_date: null,
  base_comp_decimal: "",
  bonus_pct: "0",
  benefits_pct: "0",
  employer_load_pct: "0",
  ramp_months: 0,
};

function displayDate(value: string): string {
  if (!value) return "—";
  return value;
}

/** S-045 Headcount Plan — all five screen states plus populated schedule interactions. */
export function HeadcountPage() {
  const { t } = useTranslation();
  const status = useHeadcountStore((s) => s.status);
  const error = useHeadcountStore((s) => s.error);
  const rows = useHeadcountStore((s) => s.rows);
  const periods = useHeadcountStore((s) => s.periods);
  const rollups = useHeadcountStore((s) => s.rollups);
  const importedBatchId = useHeadcountStore((s) => s.importedBatchId);
  const load = useHeadcountStore((s) => s.load);
  const saveRow = useHeadcountStore((s) => s.saveRow);
  const removeRow = useHeadcountStore((s) => s.removeRow);
  const importDriverData = useHeadcountStore((s) => s.importDriverData);
  const retry = useHeadcountStore((s) => s.retry);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<HeadcountScheduleRow>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [importPath, setImportPath] = useState("");
  const [importMapping, setImportMapping] = useState("canonical");
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    // Loading is the store's explicit initial state; an error stays visible until the user chooses
    // Retry so a failed request cannot trigger an unbounded automatic retry loop.
    if (status === "loading") void load();
  }, [status, load]);

  const beginAdd = useCallback(() => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setFormError(null);
    setFormOpen(true);
  }, []);

  const beginEdit = useCallback((row: HeadcountScheduleRow) => {
    setEditingId(row.id ?? null);
    setForm({ ...row });
    setFormError(null);
    setFormOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setFormError(null);
  }, []);

  const submitRow = useCallback(async () => {
    if (!form.role.trim() || !form.cost_center.trim() || !form.start_date) {
      setFormError(t("headcountPage.form.required"));
      return;
    }
    if (!form.base_comp_decimal.trim()) {
      setFormError(t("headcountPage.form.compRequired"));
      return;
    }
    setFormError(null);
    const ok = await saveRow({ ...form, id: editingId ?? form.id });
    if (ok) closeForm();
    else setFormError(t("headcountPage.form.saveFailed"));
  }, [closeForm, editingId, form, saveRow, t]);

  const submitImport = useCallback(async () => {
    setImportError(null);
    const ok = await importDriverData(importPath, importMapping);
    if (!ok) setImportError(t("headcountPage.import.failed"));
  }, [importDriverData, importMapping, importPath, t]);

  const orgTree = useMemo(() => {
    const groups = new Map<string, HeadcountScheduleRow[]>();
    for (const row of rows) {
      const group = groups.get(row.cost_center) ?? [];
      group.push(row);
      groups.set(row.cost_center, group);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const prorationByRow = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const rollup of rollups) {
      for (const member of rollup.members) {
        const values = map.get(member.row_id) ?? [];
        values.push(`${rollup.code}: ${member.active_days}/${member.period_days}`);
        map.set(member.row_id, values);
      }
    }
    return map;
  }, [rollups]);

  const plan = (
    <div className="flex flex-col gap-4">
      {status === "success" && <StatePanel state="success" message={t("headcountPage.saved")} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t("headcountPage.scheduleTitle")}</h2>
          <p className="text-sm text-[var(--color-onetextsecondary)]">
            {t("headcountPage.scheduleHint")}
          </p>
        </div>
        <Button onClick={beginAdd}>{t("headcountPage.addRole")}</Button>
      </div>

      {formOpen && (
        <form
          aria-label={t("headcountPage.form.label")}
          className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--color-oneborder)] p-4 md:grid-cols-2 lg:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submitRow();
          }}
        >
          <h2 className="md:col-span-2 lg:col-span-3 text-base font-semibold">
            {t(editingId ? "headcountPage.form.editTitle" : "headcountPage.form.newTitle")}
          </h2>
          <Input
            label={t("headcountPage.form.role")}
            value={form.role}
            onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}
          />
          <Input
            label={t("headcountPage.form.costCenter")}
            value={form.cost_center}
            onChange={(event) =>
              setForm((current) => ({ ...current, cost_center: event.target.value }))
            }
          />
          <Input
            label={t("headcountPage.form.start")}
            type="date"
            value={form.start_date}
            onChange={(event) =>
              setForm((current) => ({ ...current, start_date: event.target.value }))
            }
          />
          <Input
            label={t("headcountPage.form.termination")}
            type="date"
            value={form.termination_date ?? ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                termination_date: event.target.value || null,
              }))
            }
            hint={t("headcountPage.form.terminationHint")}
          />
          <Input
            label={t("headcountPage.form.comp")}
            value={form.base_comp_decimal}
            onChange={(event) =>
              setForm((current) => ({ ...current, base_comp_decimal: event.target.value }))
            }
            inputMode="decimal"
            hint={t("headcountPage.form.compHint")}
          />
          <Input
            label={t("headcountPage.form.bonus")}
            value={form.bonus_pct}
            onChange={(event) =>
              setForm((current) => ({ ...current, bonus_pct: event.target.value }))
            }
            inputMode="decimal"
          />
          <Input
            label={t("headcountPage.form.benefits")}
            value={form.benefits_pct}
            onChange={(event) =>
              setForm((current) => ({ ...current, benefits_pct: event.target.value }))
            }
            inputMode="decimal"
          />
          <Input
            label={t("headcountPage.form.load")}
            value={form.employer_load_pct}
            onChange={(event) =>
              setForm((current) => ({ ...current, employer_load_pct: event.target.value }))
            }
            inputMode="decimal"
          />
          <Input
            label={t("headcountPage.form.ramp")}
            type="number"
            min={0}
            max={120}
            value={String(form.ramp_months)}
            onChange={(event) =>
              setForm((current) => ({ ...current, ramp_months: event.target.valueAsNumber || 0 }))
            }
            hint={t("headcountPage.form.rampHint")}
          />
          {formError && (
            <p
              role="alert"
              className="md:col-span-2 lg:col-span-3 text-sm text-[var(--color-onerror)]"
            >
              {formError}
            </p>
          )}
          <div className="flex gap-2 md:col-span-2 lg:col-span-3">
            <Button type="submit">
              {t(editingId ? "headcountPage.form.save" : "headcountPage.form.add")}
            </Button>
            <Button type="button" variant="ghost" onClick={closeForm}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-[var(--color-oneborder)]">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t("headcountPage.scheduleCaption")}</caption>
          <thead>
            <tr className="bg-[var(--color-onesurfacealt)] text-left">
              <th scope="col" className="px-3 py-2">
                {t("headcountPage.columns.role")}
              </th>
              <th scope="col" className="px-3 py-2">
                {t("headcountPage.columns.costCenter")}
              </th>
              <th scope="col" className="px-3 py-2">
                {t("headcountPage.columns.start")}
              </th>
              <th scope="col" className="px-3 py-2">
                {t("headcountPage.columns.termination")}
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                {t("headcountPage.columns.comp")}
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                {t("headcountPage.columns.benefits")}
              </th>
              <th scope="col" className="px-3 py-2">
                {t("headcountPage.columns.proration")}
              </th>
              <th scope="col" className="px-3 py-2">
                {t("headcountPage.columns.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id ?? row.role} className="border-t border-[var(--color-oneborder)]">
                <td className="px-3 py-2 font-medium">{row.role}</td>
                <td className="px-3 py-2 text-[var(--color-onetextsecondary)]">
                  {row.cost_center}
                </td>
                <td className="px-3 py-2 font-mono">{displayDate(row.start_date)}</td>
                <td className="px-3 py-2 font-mono">{displayDate(row.termination_date ?? "")}</td>
                <td className="px-3 py-2 text-right font-mono">{row.base_comp_decimal}</td>
                <td className="px-3 py-2 text-right font-mono">{row.benefits_pct}%</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {(prorationByRow.get(row.id ?? "") ?? []).join(" · ") || "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("headcountPage.form.editAria", { role: row.role })}
                      onClick={() => beginEdit(row)}
                    >
                      {t("headcountPage.edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("headcountPage.removeAria", { role: row.role })}
                      onClick={() => void removeRow(row.id ?? "")}
                    >
                      {t("common.remove")}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section
          aria-label={t("headcountPage.orgLabel")}
          className="rounded-lg border border-[var(--color-oneborder)] p-4"
        >
          <h2 className="mb-2 text-base font-semibold">{t("headcountPage.orgTitle")}</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {orgTree.map(([costCenter, members]) => (
              <li key={costCenter}>
                <span className="font-medium">{costCenter}</span>
                <ul className="ml-4 mt-1 list-disc text-[var(--color-onetextsecondary)]">
                  {members.map((member) => (
                    <li key={member.id ?? member.role}>{member.role}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        <ImportPanel
          path={importPath}
          mapping={importMapping}
          setPath={setImportPath}
          setMapping={setImportMapping}
          onImport={() => void submitImport()}
          error={importError}
          t={t}
        />
      </div>

      <section
        aria-label={t("headcountPage.rollupLabel")}
        className="overflow-x-auto rounded-lg border border-[var(--color-oneborder)] p-4"
      >
        <h2 className="mb-1 text-base font-semibold">{t("headcountPage.rollupTitle")}</h2>
        <p className="mb-3 text-sm text-[var(--color-onetextsecondary)]">
          {t("headcountPage.rollupHint")}
        </p>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t("headcountPage.rollupCaption")}</caption>
          <thead>
            <tr className="border-b border-[var(--color-oneborder)] text-left">
              <th scope="col" className="px-2 py-2">
                {t("headcountPage.rollup.period")}
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                {t("headcountPage.rollup.active")}
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                {t("headcountPage.rollup.cost")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rollups.map((rollup) => (
              <tr key={rollup.period_id} className="border-t border-[var(--color-oneborder)]">
                <td className="px-2 py-2 font-mono">{rollup.code}</td>
                <td className="px-2 py-2 text-right font-mono">{rollup.active_headcount}</td>
                <td className="px-2 py-2 text-right font-mono">{rollup.total_cost_decimal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {importedBatchId && (
        <p role="status" className="text-sm text-[var(--color-onefavorable)]">
          {t("headcountPage.import.success", { batch: importedBatchId })}
        </p>
      )}
    </div>
  );

  return (
    <main className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-xl font-semibold">{t("headcountPage.title")}</h1>
        <p className="text-sm text-[var(--color-onetextsecondary)]">{t("headcountPage.lead")}</p>
      </header>
      <ModelSectionNav />

      {status === "loading" && <StatePanel state="loading" message={t("headcountPage.loading")} />}
      {status === "error" && (
        <>
          <StatePanel
            state="error"
            message={error?.userMessage ?? t("headcountPage.error.load")}
            errorCode={error?.code}
            onRetry={error?.retryable ? () => void retry() : undefined}
          />
          {/* Mutation errors keep the open form and existing preview visible; load errors do not
              fabricate an empty schedule before the calendar has been fetched. */}
          {(formOpen || rows.length > 0 || periods.length > 0) && plan}
        </>
      )}
      {status === "empty" && (
        <>
          <StatePanel
            state="empty"
            message={t("headcountPage.empty")}
            actionLabel={t("headcountPage.addRole")}
            onAction={beginAdd}
          />
          {formOpen && plan}
          {!formOpen && (
            <ImportPanel
              path={importPath}
              mapping={importMapping}
              setPath={setImportPath}
              setMapping={setImportMapping}
              onImport={() => void submitImport()}
              error={importError}
              t={t}
            />
          )}
          {importedBatchId && (
            <p role="status" className="text-sm text-[var(--color-onefavorable)]">
              {t("headcountPage.import.success", { batch: importedBatchId })}
            </p>
          )}
        </>
      )}
      {(status === "success" || status === "populated") && plan}
    </main>
  );
}

function ImportPanel({
  path,
  mapping,
  setPath,
  setMapping,
  onImport,
  error,
  t,
}: {
  path: string;
  mapping: string;
  setPath: (value: string) => void;
  setMapping: (value: string) => void;
  onImport: () => void;
  error: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <section
      aria-label={t("headcountPage.import.label")}
      className="flex flex-col gap-3 rounded-lg border border-[var(--color-oneborder)] p-4"
    >
      <h2 className="text-base font-semibold">{t("headcountPage.import.title")}</h2>
      <p className="text-sm text-[var(--color-onetextsecondary)]">
        {t("headcountPage.import.hint")}
      </p>
      <Input
        label={t("headcountPage.import.path")}
        value={path}
        onChange={(event) => setPath(event.target.value)}
        placeholder="/path/to/headcount.xlsx"
      />
      <Input
        label={t("headcountPage.import.mapping")}
        value={mapping}
        onChange={(event) => setMapping(event.target.value)}
        placeholder="canonical"
      />
      {error && (
        <p role="alert" className="text-sm text-[var(--color-onerror)]">
          {error}
        </p>
      )}
      <Button variant="secondary" onClick={onImport}>
        {t("headcountPage.import.button")}
      </Button>
    </section>
  );
}
