import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, StatePanel } from "@/components/ui";
import { ModelSectionNav } from "@/components/domain/ModelSectionNav";
import { useDriverStore, CORE_DRIVER_ADVISORY_MAX } from "@/stores/drivers";
import type { DriverDef as SchemaDriverDef } from "@/api/schema";
import type { DriverDef as EngineDriverDef } from "@/workers/modelEngine";

const DRIVER_TYPES: { value: EngineDriverDef["driver_type"]; label: string }[] = [
  { value: "volume_x_rate", label: "Volume × Rate" },
  { value: "headcount", label: "Headcount" },
  { value: "growth", label: "Growth" },
  { value: "seasonal", label: "Seasonal" },
  { value: "spread", label: "Spread" },
  { value: "ratio", label: "Ratio" },
  { value: "manual", label: "Manual" },
];

const DRIVER_SOURCES: { value: EngineDriverDef["source"]; label: string }[] = [
  { value: "global", label: "Global" },
  { value: "bu_override", label: "BU" },
  { value: "collection", label: "Collection" },
  { value: "imported", label: "Imported" },
];

/** S-043 Driver Tables — driver definition & values (F-013 · M3-3 · SCREENS-SPEC S-043). */
export function DriverTablesPage() {
  const { t } = useTranslation();
  const status = useDriverStore((s) => s.status);
  const storeError = useDriverStore((s) => s.error);
  const drivers = useDriverStore((s) => s.drivers);
  const values = useDriverStore((s) => s.values);
  const periods = useDriverStore((s) => s.periods);
  const impact = useDriverStore((s) => s.impact);
  const coreDriverCount = useDriverStore((s) => s.coreDriverCount);
  const load = useDriverStore((s) => s.load);
  const upsertDriver = useDriverStore((s) => s.upsertDriver);
  const setValue = useDriverStore((s) => s.setValue);
  const importDrivers = useDriverStore((s) => s.importDrivers);

  const [activeDriverId, setActiveDriverId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  // Auto-load once on mount / on a failed state (never re-load a successfully-rendered empty state
  // — that would loop; the S-041/S-042 pattern re-triggers on `empty`, but the Driver table is
  // session-scoped and its empty state is a terminal render with the "create first" affordance).
  useEffect(() => {
    if (status === "loading" || status === "error") {
      void load();
    }
  }, [status, load]);

  // Add / edit form fields.
  const [name, setName] = useState("");
  const [driverType, setDriverType] = useState<SchemaDriverDef["driver_type"]>("volume_x_rate");
  const [unit, setUnit] = useState("");
  const [source, setSource] = useState<SchemaDriverDef["source"]>("global");
  const [isCore, setIsCore] = useState(false);
  const [boundsLow, setBoundsLow] = useState("");
  const [boundsHigh, setBoundsHigh] = useState("");

  const beginEdit = useCallback((d: EngineDriverDef) => {
    setEditingId(d.id);
    setFormOpen(true);
    setFormError(null);
    setName(d.name);
    setDriverType(d.driver_type);
    setUnit(d.unit ?? "");
    setSource(d.source);
    setIsCore(d.is_core);
    setBoundsLow(d.bounds_low ?? "");
    setBoundsHigh(d.bounds_high ?? "");
  }, []);

  const resetForm = useCallback(() => {
    setFormOpen(false);
    setEditingId(null);
    setFormError(null);
    setName("");
    setDriverType("volume_x_rate");
    setUnit("");
    setSource("global");
    setIsCore(false);
    setBoundsLow("");
    setBoundsHigh("");
  }, []);

  const submitForm = useCallback(async () => {
    if (!name.trim()) {
      setFormError(t("driversPage.form.nameRequired"));
      return;
    }
    const def: SchemaDriverDef = {
      id: editingId ?? undefined,
      name: name.trim(),
      driver_type: driverType,
      unit: unit.trim() || null,
      source,
      is_core: isCore,
      bounds_low: boundsLow.trim() || null,
      bounds_high: boundsHigh.trim() || null,
    };
    setFormError(null);
    const ok = await upsertDriver(def);
    if (ok) {
      resetForm();
      setActiveDriverId(editingId ?? `dr-${name.trim().toLowerCase()}`);
    } else {
      setFormError(t("driversPage.form.saveFailed"));
    }
  }, [
    boundsHigh,
    boundsLow,
    driverType,
    editingId,
    isCore,
    name,
    resetForm,
    source,
    t,
    unit,
    upsertDriver,
  ]);

  const commitValue = useCallback(
    async (driverId: string, periodId: string, text: string) => {
      if (text.trim() === "") return;
      await setValue(driverId, periodId, text.trim());
    },
    [setValue],
  );

  const [importPath, setImportPath] = useState("");
  const [importMapping, setImportMapping] = useState("canonical");
  const submitImport = useCallback(async () => {
    if (!importPath.trim()) return;
    await importDrivers(importPath.trim(), importMapping);
  }, [importDrivers, importMapping, importPath]);

  const activeImpact = activeDriverId ? (impact[activeDriverId] ?? []) : [];
  const activeDriver = drivers.find((d) => d.id === activeDriverId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("driversPage.title")}</h1>
      <ModelSectionNav />

      {status === "loading" && <StatePanel state="loading" message={t("common.loading")} />}

      {status === "error" && (
        <StatePanel
          state="error"
          message={storeError?.userMessage ?? t("driversPage.error.load")}
          onRetry={() => void load()}
        />
      )}

      {status === "empty" && (
        <div className="flex flex-col gap-4">
          <StatePanel state="empty" message={t("driversPage.empty")} />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                resetForm();
                setFormOpen((v) => !v);
              }}
            >
              {t(formOpen ? "driversPage.form.cancel" : "driversPage.addDriver")}
            </Button>
          </div>
          <DriverForm
            open={formOpen}
            onToggle={() => {
              setFormOpen((v) => !v);
              setFormError(null);
            }}
            name={name}
            driverType={driverType}
            unit={unit}
            source={source}
            isCore={isCore}
            boundsLow={boundsLow}
            boundsHigh={boundsHigh}
            formError={formError}
            isEditing={editingId !== null}
            setName={setName}
            setDriverType={setDriverType}
            setUnit={setUnit}
            setSource={setSource}
            setIsCore={setIsCore}
            setBoundsLow={setBoundsLow}
            setBoundsHigh={setBoundsHigh}
            onSubmit={() => void submitForm()}
          />
        </div>
      )}

      {(status === "success" || status === "populated") && (
        <div className="flex flex-col gap-4">
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-oneborder)] p-3 text-sm"
          >
            <span className="font-medium">{t("driversPage.coreCount")}</span>
            <span
              className={`rounded-md px-2 py-0.5 font-mono ${
                coreDriverCount > CORE_DRIVER_ADVISORY_MAX
                  ? "bg-[var(--color-oneerror)] text-white"
                  : "bg-[var(--color-onesurfacealt)] text-[var(--color-onetextsecondary)]"
              }`}
            >
              {coreDriverCount}
            </span>
            <span className="text-[var(--color-onetextmuted)]">
              (≤ {CORE_DRIVER_ADVISORY_MAX} {t("driversPage.coreAdvisory")})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                resetForm();
                setFormOpen((v) => !v);
              }}
            >
              {t(formOpen ? "driversPage.form.cancel" : "driversPage.addDriver")}
            </Button>
          </div>

          {formOpen && (
            <DriverForm
              open
              onToggle={() => {
                setFormOpen(false);
                setFormError(null);
              }}
              name={name}
              driverType={driverType}
              unit={unit}
              source={source}
              isCore={isCore}
              boundsLow={boundsLow}
              boundsHigh={boundsHigh}
              formError={formError}
              isEditing={editingId !== null}
              setName={setName}
              setDriverType={setDriverType}
              setUnit={setUnit}
              setSource={setSource}
              setIsCore={setIsCore}
              setBoundsLow={setBoundsLow}
              setBoundsHigh={setBoundsHigh}
              onSubmit={() => void submitForm()}
            />
          )}

          <div className="overflow-x-auto rounded-lg border border-[var(--color-oneborder)]">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{t("driversPage.tableCaption")}</caption>
              <thead>
                <tr className="bg-[var(--color-onesurfacealt)] text-left">
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("driversPage.colDriver")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("driversPage.colType")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("driversPage.colSource")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("driversPage.colUnit")}
                  </th>
                  {periods.map((p) => (
                    <th scope="col" key={p.id} className="px-2 py-2 text-right font-medium">
                      {p.code}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.id} className="border-t border-[var(--color-oneborder)]">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveDriverId(d.id);
                          beginEdit(d);
                        }}
                        className={`font-medium underline-offset-2 hover:underline ${
                          activeDriverId === d.id ? "text-[var(--color-oneprimary)]" : ""
                        }`}
                        aria-current={activeDriverId === d.id ? "true" : undefined}
                      >
                        {d.name}
                      </button>
                      {d.is_core && (
                        <span className="ml-1 rounded bg-[var(--color-onesurfacealt)] px-1.5 py-0.5 text-xs text-[var(--color-oneprimary)]">
                          {t("driversPage.coreBadge")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-onetextsecondary)]">
                      {driverTypeLabel(d.driver_type)}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-onetextsecondary)]">{d.source}</td>
                    <td className="px-3 py-2 text-[var(--color-onetextsecondary)]">
                      {d.unit ?? t("driversPage.noUnit")}
                    </td>
                    {periods.map((p) => (
                      <td key={p.id} className="px-2 py-2">
                        <DriverValueCell
                          driverId={d.id}
                          periodId={p.id}
                          current={values[`${d.id}:${p.id}`] ?? ""}
                          onCommit={(text) => void commitValue(d.id, p.id, text)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <DriverImpactPanel driverName={activeDriver?.name ?? ""} rows={activeImpact} t={t} />
            <ImportPanel
              importPath={importPath}
              importMapping={importMapping}
              setImportPath={setImportPath}
              setImportMapping={setImportMapping}
              onImport={() => void submitImport()}
              t={t}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function driverTypeLabel(type: SchemaDriverDef["driver_type"]): string {
  return DRIVER_TYPES.find((d) => d.value === type)?.label ?? type;
}

/** A single driver period-value cell — commits the exact decimal string on blur/Enter. */
function DriverValueCell({
  driverId,
  periodId,
  current,
  onCommit,
}: {
  driverId: string;
  periodId: string;
  current: string;
  onCommit: (text: string) => void;
}) {
  const [text, setText] = useState(current);
  const focused = useRef(false);
  // Re-sync from the authoritative stored value only when not mid-edit (so a bounds failure that
  // keeps the row honest is reflected without clobbering a focused edit).
  useEffect(() => {
    if (!focused.current) setText(current);
  }, [current]);
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(text);
      }}
      aria-label={`${driverId} ${periodId}`}
      className="h-8 w-24 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 text-right text-sm font-mono"
      inputMode="decimal"
      placeholder="—"
    />
  );
}

function DriverImpactPanel({
  driverName,
  rows,
  t,
}: {
  driverName: string;
  rows: { line_id: string; period_id: string; formula: string | null }[];
  t: (key: string) => string;
}) {
  return (
    <section
      aria-label={t("driversPage.impactLabel")}
      className="rounded-lg border border-[var(--color-oneborder)] p-4"
    >
      <h2 className="mb-2 text-base font-semibold">
        {t("driversPage.impactTitle")} {driverName ? `· ${driverName}` : ""}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-onetextmuted)]">{t("driversPage.noImpact")}</p>
      ) : (
        <ul className="flex list-inside list-disc flex-col gap-1 text-sm font-mono text-[var(--color-onetextsecondary)]">
          {rows.map((r, i) => (
            <li key={i}>
              {r.line_id} · {r.period_id}
              {r.formula ? ` — ${r.formula}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ImportPanel({
  importPath,
  importMapping,
  setImportPath,
  setImportMapping,
  onImport,
  t,
}: {
  importPath: string;
  importMapping: string;
  setImportPath: (v: string) => void;
  setImportMapping: (v: string) => void;
  onImport: () => void;
  t: (key: string) => string;
}) {
  return (
    <section
      aria-label={t("driversPage.importLabel")}
      className="flex flex-col gap-3 rounded-lg border border-[var(--color-oneborder)] p-4"
    >
      <h2 className="text-base font-semibold">{t("driversPage.importTitle")}</h2>
      <Input
        label={t("driversPage.importPath")}
        value={importPath}
        onChange={(e) => setImportPath(e.target.value)}
        placeholder="/path/to/drivers.xlsx"
      />
      <Input
        label={t("driversPage.importMapping")}
        value={importMapping}
        onChange={(e) => setImportMapping(e.target.value)}
        placeholder="canonical"
      />
      <Button variant="secondary" onClick={onImport}>
        {t("driversPage.importButton")}
      </Button>
    </section>
  );
}

function DriverForm(props: {
  open: boolean;
  onToggle: () => void;
  name: string;
  driverType: SchemaDriverDef["driver_type"];
  unit: string;
  source: SchemaDriverDef["source"];
  isCore: boolean;
  boundsLow: string;
  boundsHigh: string;
  formError: string | null;
  isEditing: boolean;
  setName: (v: string) => void;
  setDriverType: (v: SchemaDriverDef["driver_type"]) => void;
  setUnit: (v: string) => void;
  setSource: (v: SchemaDriverDef["source"]) => void;
  setIsCore: (v: boolean) => void;
  setBoundsLow: (v: string) => void;
  setBoundsHigh: (v: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  if (!props.open) return null;
  return (
    <section
      aria-label={t("driversPage.formLabel")}
      className="flex flex-col gap-3 rounded-lg border border-[var(--color-oneborder)] p-4"
    >
      <h2 className="text-base font-semibold">
        {props.isEditing ? t("driversPage.editDriver") : t("driversPage.newDriver")}
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Input
          label={t("driversPage.form.name")}
          value={props.name}
          onChange={(e) => props.setName(e.target.value)}
          hint={t("driversPage.form.nameHint")}
        />
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("driversPage.form.type")}
          <select
            value={props.driverType}
            onChange={(e) => props.setDriverType(e.target.value as SchemaDriverDef["driver_type"])}
            className="h-10 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 text-sm"
            aria-label={t("driversPage.form.type")}
          >
            {DRIVER_TYPES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("driversPage.form.source")}
          <select
            value={props.source}
            onChange={(e) => props.setSource(e.target.value as SchemaDriverDef["source"])}
            className="h-10 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 text-sm"
            aria-label={t("driversPage.form.source")}
          >
            {DRIVER_SOURCES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <Input
          label={t("driversPage.form.unit")}
          value={props.unit}
          onChange={(e) => props.setUnit(e.target.value)}
          hint={t("driversPage.form.unitHint")}
        />
        <Input
          label={t("driversPage.form.boundsLow")}
          value={props.boundsLow}
          onChange={(e) => props.setBoundsLow(e.target.value)}
          inputMode="decimal"
        />
        <Input
          label={t("driversPage.form.boundsHigh")}
          value={props.boundsHigh}
          onChange={(e) => props.setBoundsHigh(e.target.value)}
          inputMode="decimal"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={props.isCore}
          onChange={(e) => props.setIsCore(e.target.checked)}
          className="h-4 w-4 accent-[var(--color-oneprimary)]"
        />
        {t("driversPage.form.isCore")}
      </label>
      {props.formError && (
        <p role="alert" className="text-sm text-[var(--color-onerror)]">
          {props.formError}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={props.onSubmit} disabled={!props.name.trim()}>
          {props.isEditing ? t("driversPage.form.save") : t("driversPage.form.create")}
        </Button>
        <Button variant="secondary" onClick={props.onToggle}>
          {t("driversPage.form.cancel")}
        </Button>
      </div>
    </section>
  );
}
