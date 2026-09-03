import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModelSectionNav } from "@/components/domain/ModelSectionNav";
import { Button, Input, StatePanel } from "@/components/ui";
import type { AssumptionDef } from "@/api/schema";
import { diffAssumptionValues, hardcodeFindingKey, useAssumptionStore } from "@/stores/assumptions";
import type { HardcodedFinding, HardcodedLiteral } from "@/workers/modelEngine";

interface AssumptionDraft {
  name: string;
  unit: string;
  owner: string;
  source: string;
  boundsLow: string;
  boundsHigh: string;
  effectiveFrom: string;
  effectiveTo: string;
  values: string;
}

const EMPTY_DRAFT: AssumptionDraft = {
  name: "",
  unit: "",
  owner: "",
  source: "",
  boundsLow: "",
  boundsHigh: "",
  effectiveFrom: "",
  effectiveTo: "",
  values: "",
};

function draftFromAssumption(assumption: AssumptionDef): AssumptionDraft {
  return {
    name: assumption.name,
    unit: assumption.unit ?? "",
    owner: assumption.owner,
    source: assumption.source ?? "",
    boundsLow: assumption.bounds_low ?? "",
    boundsHigh: assumption.bounds_high ?? "",
    effectiveFrom: assumption.effective_from ?? "",
    effectiveTo: assumption.effective_to ?? "",
    values: Object.entries(assumption.values)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, value]) => `${period}=${value}`)
      .join("\n"),
  };
}

/** Parse exact decimal register values without coercing them through a JavaScript number. */
function parseValueEntries(text: string): Record<string, string> | null {
  const values: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) return null;
    const period = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!/^fp-[^=\s]+$/.test(period) || !/^-?\d+(\.\d+)?$/.test(value)) return null;
    if (Object.prototype.hasOwnProperty.call(values, period)) return null;
    values[period] = value;
  }
  return values;
}

function displayValues(assumption: AssumptionDef, emptyLabel: string): string {
  const entries = Object.entries(assumption.values).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return emptyLabel;
  return entries.map(([period, value]) => `${period}: ${value}`).join(" · ");
}

function displayRange(
  low: string | null | undefined,
  high: string | null | undefined,
  emptyLabel: string,
) {
  if (low == null && high == null) return emptyLabel;
  return `${low ?? emptyLabel} – ${high ?? emptyLabel}`;
}

/** S-044 Assumption Register — versioned metadata and exact period values (F-014). */
export function AssumptionsPage() {
  const { t } = useTranslation();
  const status = useAssumptionStore((state) => state.status);
  const error = useAssumptionStore((state) => state.error);
  const usageError = useAssumptionStore((state) => state.usageError);
  const assumptions = useAssumptionStore((state) => state.assumptions);
  const usages = useAssumptionStore((state) => state.usages);
  const history = useAssumptionStore((state) => state.history);
  const load = useAssumptionStore((state) => state.load);
  const upsert = useAssumptionStore((state) => state.upsert);
  const findUsages = useAssumptionStore((state) => state.findUsages);
  const hardcodeStatus = useAssumptionStore((state) => state.hardcodeStatus);
  const hardcodeError = useAssumptionStore((state) => state.hardcodeError);
  const findings = useAssumptionStore((state) => state.findings);
  const waived = useAssumptionStore((state) => state.waived);
  const scanHardcoded = useAssumptionStore((state) => state.scanHardcoded);
  const convertHardcoded = useAssumptionStore((state) => state.convertHardcoded);
  const waiveHardcoded = useAssumptionStore((state) => state.waiveHardcoded);
  const unwaiveHardcoded = useAssumptionStore((state) => state.unwaiveHardcoded);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AssumptionDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeUsageId, setActiveUsageId] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [convertSelections, setConvertSelections] = useState<Record<string, string>>({});
  const [waivingKey, setWaivingKey] = useState<string | null>(null);
  const [waiveReason, setWaiveReason] = useState("");
  const [waiveError, setWaiveError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const activeUsage = activeUsageId ? (usages[activeUsageId] ?? null) : null;
  const activeAssumption = useMemo(
    () => assumptions.find((assumption) => assumption.id === activeUsageId) ?? null,
    [activeUsageId, assumptions],
  );

  const openAddForm = useCallback(() => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setFormError(null);
    setFormOpen(true);
  }, []);

  const openEditForm = useCallback((assumption: AssumptionDef) => {
    setEditingId(assumption.id ?? null);
    setDraft(draftFromAssumption(assumption));
    setFormError(null);
    setFormOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setFormError(null);
  }, []);

  const updateDraft = useCallback((field: keyof AssumptionDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const submitForm = useCallback(async () => {
    const values = parseValueEntries(draft.values);
    if (!draft.name.trim() || !/^[a-z_][a-z0-9_]*$/.test(draft.name.trim())) {
      setFormError(t("assumptionsPage.form.nameRequired"));
      return;
    }
    if (!draft.owner.trim()) {
      setFormError(t("assumptionsPage.form.ownerRequired"));
      return;
    }
    if (values === null) {
      setFormError(t("assumptionsPage.form.valuesInvalid"));
      return;
    }

    const assumption: AssumptionDef = {
      ...(editingId ? { id: editingId } : {}),
      name: draft.name.trim(),
      unit: draft.unit.trim() || null,
      owner: draft.owner.trim(),
      source: draft.source.trim() || null,
      bounds_low: draft.boundsLow.trim() || null,
      bounds_high: draft.boundsHigh.trim() || null,
      effective_from: draft.effectiveFrom.trim() || null,
      effective_to: draft.effectiveTo.trim() || null,
      values,
    };
    setSaving(true);
    setFormError(null);
    const ok = await upsert(assumption);
    setSaving(false);
    if (ok) closeForm();
    else setFormError(t("assumptionsPage.form.saveFailed"));
  }, [closeForm, draft, editingId, t, upsert]);

  const loadUsages = useCallback(
    async (assumptionId: string) => {
      setActiveUsageId(assumptionId);
      setUsageLoading(true);
      await findUsages(assumptionId);
      setUsageLoading(false);
    },
    [findUsages],
  );

  const editingAssumption = useMemo(
    () => assumptions.find((assumption) => assumption.id === editingId) ?? null,
    [assumptions, editingId],
  );

  const draftDiff = useMemo(() => {
    if (!editingAssumption) return [];
    const parsed = parseValueEntries(draft.values);
    if (parsed === null) return [];
    return diffAssumptionValues(editingAssumption.values, parsed);
  }, [draft.values, editingAssumption]);

  const runScan = useCallback(async () => {
    setScanned(true);
    setWaiveError(null);
    await scanHardcoded();
  }, [scanHardcoded]);

  const startWaive = useCallback((key: string) => {
    setWaivingKey(key);
    setWaiveReason("");
    setWaiveError(null);
  }, []);

  const confirmWaive = useCallback(
    (finding: HardcodedFinding, literal: HardcodedLiteral) => {
      if (!waiveReason.trim()) {
        setWaiveError(t("assumptionsPage.hardcode.waiveReasonRequired"));
        return;
      }
      const ok = waiveHardcoded(finding, literal, waiveReason);
      if (ok) {
        setWaivingKey(null);
        setWaiveReason("");
        setWaiveError(null);
      }
    },
    [t, waiveHardcoded, waiveReason],
  );

  const convertLiteral = useCallback(
    async (finding: HardcodedFinding, literal: HardcodedLiteral) => {
      const key = hardcodeFindingKey(finding, literal);
      const name = convertSelections[key];
      if (!name) return;
      setWaiveError(null);
      const ok = await convertHardcoded(finding, literal, name);
      if (ok) {
        const next = { ...convertSelections };
        delete next[key];
        setConvertSelections(next);
      }
    },
    [convertHardcoded, convertSelections],
  );

  const assumptionNameOptions = useMemo(
    () => assumptions.map((assumption) => assumption.name),
    [assumptions],
  );

  const renderForm = () => (
    <section
      aria-label={t("assumptionsPage.form.title")}
      className="flex flex-col gap-4 rounded-lg border border-[var(--color-oneborder)] p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">
          {t(editingId ? "assumptionsPage.form.editTitle" : "assumptionsPage.form.addTitle")}
        </h2>
        <Button variant="ghost" size="sm" onClick={closeForm}>
          {t("common.cancel")}
        </Button>
      </div>
      {formError && (
        <p role="alert" className="rounded-md border border-[var(--color-oneerror)] p-3 text-sm">
          {formError}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Input
          id="assumption-name"
          label={t("assumptionsPage.form.name")}
          hint={t("assumptionsPage.form.nameHint")}
          value={draft.name}
          onChange={(event) => updateDraft("name", event.target.value)}
          autoComplete="off"
        />
        <Input
          id="assumption-owner"
          label={t("assumptionsPage.form.owner")}
          value={draft.owner}
          onChange={(event) => updateDraft("owner", event.target.value)}
          autoComplete="organization"
        />
        <Input
          id="assumption-unit"
          label={t("assumptionsPage.form.unit")}
          hint={t("assumptionsPage.form.unitHint")}
          value={draft.unit}
          onChange={(event) => updateDraft("unit", event.target.value)}
        />
        <Input
          id="assumption-source"
          label={t("assumptionsPage.form.source")}
          value={draft.source}
          onChange={(event) => updateDraft("source", event.target.value)}
        />
        <Input
          id="assumption-bounds-low"
          label={t("assumptionsPage.form.boundsLow")}
          value={draft.boundsLow}
          onChange={(event) => updateDraft("boundsLow", event.target.value)}
          inputMode="decimal"
        />
        <Input
          id="assumption-bounds-high"
          label={t("assumptionsPage.form.boundsHigh")}
          value={draft.boundsHigh}
          onChange={(event) => updateDraft("boundsHigh", event.target.value)}
          inputMode="decimal"
        />
        <Input
          id="assumption-effective-from"
          label={t("assumptionsPage.form.effectiveFrom")}
          hint={t("assumptionsPage.form.periodHint")}
          value={draft.effectiveFrom}
          onChange={(event) => updateDraft("effectiveFrom", event.target.value)}
        />
        <Input
          id="assumption-effective-to"
          label={t("assumptionsPage.form.effectiveTo")}
          hint={t("assumptionsPage.form.periodHint")}
          value={draft.effectiveTo}
          onChange={(event) => updateDraft("effectiveTo", event.target.value)}
        />
      </div>
      <label htmlFor="assumption-values" className="flex flex-col gap-1.5 text-sm font-medium">
        {t("assumptionsPage.form.values")}
        <span className="text-xs font-normal text-[var(--color-onetextmuted)]">
          {t("assumptionsPage.form.valuesHint")}
        </span>
        <textarea
          id="assumption-values"
          value={draft.values}
          onChange={(event) => updateDraft("values", event.target.value)}
          rows={4}
          className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-3 font-mono text-sm text-[var(--color-onetext)]"
        />
      </label>
      {editingAssumption && (
        <section aria-label={t("assumptionsPage.diff.title")} className="text-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-onetextmuted)]">
            {t("assumptionsPage.diff.title")}
          </h3>
          {draftDiff.length === 0 ? (
            <p className="mt-1 text-[var(--color-onetextmuted)]">
              {t("assumptionsPage.diff.none")}
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1 font-mono text-xs">
              {draftDiff.map((row) => (
                <li key={row.period_id}>
                  {row.period_id}: {row.before ?? t("assumptionsPage.notSet")} →{" "}
                  {row.after ?? t("assumptionsPage.notSet")}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={closeForm} disabled={saving}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => void submitForm()} disabled={saving}>
          {t(saving ? "assumptionsPage.form.saving" : "assumptionsPage.form.save")}
        </Button>
      </div>
    </section>
  );

  const pageHeader = (
    <>
      <h1 id="assumptions-page-title" className="text-xl font-semibold">
        {t("assumptionsPage.title")}
      </h1>
      <ModelSectionNav />
    </>
  );

  if (status === "loading") {
    return (
      <main className="flex flex-col gap-4" aria-labelledby="assumptions-page-title">
        {pageHeader}
        <div role="status" aria-label={t("common.loading")} className="space-y-2">
          {["one", "two", "three", "four"].map((row) => (
            <div key={row} className="h-12 animate-pulse rounded bg-[var(--color-onesurfacealt)]" />
          ))}
        </div>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="flex flex-col gap-4" aria-labelledby="assumptions-page-title">
        {pageHeader}
        <StatePanel
          state="error"
          message={error?.userMessage ?? t("assumptionsPage.error.load")}
          errorCode={error?.code}
          onRetry={() => void load()}
        />
      </main>
    );
  }

  if (status === "empty") {
    return (
      <main className="flex flex-col gap-4" aria-labelledby="assumptions-page-title">
        {pageHeader}
        {!formOpen && (
          <StatePanel
            state="empty"
            message={t("assumptionsPage.empty")}
            actionLabel={t("assumptionsPage.add")}
            onAction={openAddForm}
          />
        )}
        {formOpen && renderForm()}
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-4" aria-labelledby="assumptions-page-title">
      {pageHeader}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-onetextsecondary)]">
          {t("assumptionsPage.count", { count: assumptions.length })}
        </p>
        <Button onClick={openAddForm}>{t("assumptionsPage.add")}</Button>
      </div>
      {formOpen && renderForm()}

      <div className="overflow-x-auto rounded-lg border border-[var(--color-oneborder)]">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <caption className="sr-only">{t("assumptionsPage.tableCaption")}</caption>
          <thead className="bg-[var(--color-onesurfacealt)] text-left">
            <tr>
              {[
                "name",
                "unit",
                "value",
                "source",
                "owner",
                "usages",
                "effective",
                "bounds",
                "lastChange",
                "actions",
              ].map((column) => (
                <th key={column} scope="col" className="px-3 py-2 font-medium">
                  {t(`assumptionsPage.columns.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {assumptions.map((assumption) => {
              const assumptionId = assumption.id ?? `as-${assumption.name}`;
              const versions = history[assumptionId] ?? [];
              const versionCount = Math.max(
                assumption.version ?? 0,
                ...versions.map((item) => item.version),
              );
              const lastChanged =
                versions[versions.length - 1]?.changed_at ?? assumption.last_changed_at;
              return (
                <tr
                  key={assumptionId}
                  className="border-t border-[var(--color-oneborder)] align-top"
                >
                  <th scope="row" className="px-3 py-3 text-left font-mono font-medium">
                    {assumption.name}
                  </th>
                  <td className="px-3 py-3">{assumption.unit ?? t("assumptionsPage.notSet")}</td>
                  <td className="max-w-64 px-3 py-3 font-mono text-xs">
                    {displayValues(assumption, t("assumptionsPage.notSet"))}
                  </td>
                  <td className="px-3 py-3">{assumption.source ?? t("assumptionsPage.notSet")}</td>
                  <td className="px-3 py-3">{assumption.owner}</td>
                  <td className="px-3 py-3 text-center">
                    {usages[assumptionId]
                      ? usages[assumptionId].length
                      : t("assumptionsPage.notSet")}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">
                    {assumption.effective_from ?? t("assumptionsPage.notSet")} →{" "}
                    {assumption.effective_to ?? t("assumptionsPage.notSet")}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">
                    {displayRange(
                      assumption.bounds_low,
                      assumption.bounds_high,
                      t("assumptionsPage.notSet"),
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {lastChanged
                      ? new Date(lastChanged).toLocaleString()
                      : t("assumptionsPage.notSet")}
                    {versionCount > 0 && (
                      <span className="ml-1 text-[var(--color-onetextmuted)]">
                        {t("assumptionsPage.version", { count: versionCount })}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={t("assumptionsPage.editAria", { name: assumption.name })}
                        onClick={() => openEditForm(assumption)}
                      >
                        {t("assumptionsPage.edit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void loadUsages(assumptionId)}
                      >
                        {t("assumptionsPage.findUsages")}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section
        aria-label={t("assumptionsPage.hardcode.title")}
        className="rounded-lg border border-[var(--color-oneborder)] p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{t("assumptionsPage.hardcode.title")}</h2>
            <p className="text-sm text-[var(--color-onetextsecondary)]">
              {t("assumptionsPage.hardcode.hint")}
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => void runScan()}
            disabled={hardcodeStatus === "loading"}
          >
            {t(
              hardcodeStatus === "loading"
                ? "assumptionsPage.hardcode.scanning"
                : "assumptionsPage.hardcode.scan",
            )}
          </Button>
        </div>

        {hardcodeStatus === "error" && (
          <div className="mt-3">
            <StatePanel
              state="error"
              message={hardcodeError?.userMessage ?? t("assumptionsPage.hardcode.error")}
              errorCode={hardcodeError?.code}
              onRetry={() => void runScan()}
            />
          </div>
        )}

        {scanned && hardcodeStatus !== "error" && findings.length === 0 && (
          <StatePanel state="success" message={t("assumptionsPage.hardcode.none")} />
        )}

        {findings.length > 0 && (
          <ul className="mt-3 flex flex-col gap-3">
            {findings.map((finding) => (
              <li
                key={`${finding.line_id}:${finding.period_id}`}
                className="rounded border border-[var(--color-oneborder)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono font-medium">
                    {finding.line_id} · {finding.period_id}
                  </span>
                  <code className="whitespace-pre-wrap break-all font-mono text-xs text-[var(--color-onetextsecondary)]">
                    {finding.formula}
                  </code>
                </div>
                <ul className="mt-2 flex flex-col gap-2">
                  {finding.literals.map((literal) => {
                    const key = hardcodeFindingKey(finding, literal);
                    const isWaived = Boolean(waived[key]);
                    const isWaiving = waivingKey === key;
                    return (
                      <li
                        key={key}
                        className={`flex flex-wrap items-center gap-2 rounded border p-2 text-sm ${
                          isWaived
                            ? "border-[var(--color-oneborder)] opacity-70"
                            : "border-[var(--color-oneborder)]"
                        }`}
                      >
                        <code className="rounded bg-[var(--color-onesurfacealt)] px-1.5 py-0.5 font-mono text-xs">
                          {literal.literal}
                        </code>
                        {isWaived ? (
                          <span className="text-xs text-[var(--color-onetextmuted)]">
                            {t("assumptionsPage.hardcode.waivedBadge", {
                              reason: waived[key]?.reason ?? "",
                            })}
                            <Button variant="ghost" size="sm" onClick={() => unwaiveHardcoded(key)}>
                              {t("assumptionsPage.hardcode.unwaive")}
                            </Button>
                          </span>
                        ) : isWaiving ? (
                          <>
                            <Input
                              id={`waive-reason-${key}`}
                              label={t("assumptionsPage.hardcode.waiveReasonLabel")}
                              value={waiveReason}
                              onChange={(event) => setWaiveReason(event.target.value)}
                              className="min-w-56"
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => confirmWaive(finding, literal)}
                            >
                              {t("assumptionsPage.hardcode.waiveConfirm")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setWaivingKey(null);
                                setWaiveError(null);
                              }}
                            >
                              {t("common.cancel")}
                            </Button>
                          </>
                        ) : (
                          <>
                            <label className="flex items-center gap-2">
                              <span className="sr-only">
                                {t("assumptionsPage.hardcode.convertLabel")}
                              </span>
                              <select
                                aria-label={t("assumptionsPage.hardcode.convertAria", {
                                  literal: literal.literal,
                                })}
                                value={convertSelections[key] ?? ""}
                                onChange={(event) =>
                                  setConvertSelections((current) => ({
                                    ...current,
                                    [key]: event.target.value,
                                  }))
                                }
                                className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1.5 text-sm"
                              >
                                <option value="" disabled>
                                  {t("assumptionsPage.hardcode.chooseAssumption")}
                                </option>
                                {assumptionNameOptions.map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={!convertSelections[key]}
                              onClick={() => void convertLiteral(finding, literal)}
                            >
                              {t("assumptionsPage.hardcode.convert")}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => startWaive(key)}>
                              {t("assumptionsPage.hardcode.waive")}
                            </Button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {waiveError && (
          <p
            role="alert"
            className="mt-3 rounded-md border border-[var(--color-oneerror)] p-3 text-sm"
          >
            {waiveError}
          </p>
        )}
      </section>

      {activeUsageId && (
        <section
          aria-label={t("assumptionsPage.usageTitle")}
          className="rounded-lg border border-[var(--color-oneborder)] p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">
              {t("assumptionsPage.usageTitle")} · {activeAssumption?.name ?? activeUsageId}
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setActiveUsageId(null)}>
              {t("common.close")}
            </Button>
          </div>
          {usageLoading && (
            <StatePanel state="loading" message={t("assumptionsPage.usageLoading")} />
          )}
          {!usageLoading && usageError && (
            <StatePanel
              state="error"
              message={usageError.userMessage}
              errorCode={usageError.code}
              onRetry={() => void loadUsages(activeUsageId)}
            />
          )}
          {!usageLoading && !usageError && activeUsage && activeUsage.length === 0 && (
            <StatePanel state="success" message={t("assumptionsPage.noUsages")} />
          )}
          {!usageLoading && !usageError && activeUsage && activeUsage.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {activeUsage.map((usage) => (
                <li
                  key={`${usage.line_id}:${usage.period_id}`}
                  className="rounded border border-[var(--color-oneborder)] p-2"
                >
                  <span className="font-mono">
                    {usage.line_id} · {usage.period_id}
                  </span>
                  <code className="mt-1 block whitespace-pre-wrap font-mono text-xs text-[var(--color-onetextsecondary)]">
                    {usage.formula}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
