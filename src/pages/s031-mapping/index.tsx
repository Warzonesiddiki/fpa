import { useLayoutEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  FileSpreadsheet,
  Link2,
  Loader2,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import {
  IMPORT_MAPPING_TARGETS,
  type AccountCodeNormalization,
  type DimensionValueNormalization,
  type ImportMappingTarget,
  type ImportMappingTemplate,
  type ImportParseData,
  type ImportSignConvention,
  type PeriodNormalization,
} from "@/api/schema";
import { Button, Card, Input, StatePanel, type ScreenState } from "@/components/ui";
import { useImportStore } from "@/stores/import";
import { useSessionStore } from "@/stores/session";
import { useSettingsStore } from "@/stores/settings";
import { ValidationPanel } from "./ValidationPanel";

interface ColumnDraft {
  sourcePattern: string;
  semanticTarget: ImportMappingTarget | "";
}

const PIPELINE_STEPS = [
  "parse",
  "normalize",
  "map",
  "validate",
  "preview",
  "tieout",
  "commit",
] as const;

const HEADER_ALIASES: Record<string, ImportMappingTarget> = {
  date: "period",
  period: "period",
  posting_date: "period",
  fiscal_period: "period",
  account: "account_code",
  account_code: "account_code",
  account_number: "account_code",
  acct: "account_code",
  gl_account: "account_code",
  ledger: "account_code",
  ledger_code: "account_code",
  account_name: "account_name",
  account_description: "account_name",
  description: "account_name",
  debit: "debit",
  debit_amount: "debit",
  dr: "debit",
  credit: "credit",
  credit_amount: "credit",
  cr: "credit",
  amount: "amount",
  net_amount: "amount",
  value: "amount",
  cost_center: "cost_center",
  cost_centre: "cost_center",
  project: "project",
  product: "product",
  customer: "customer",
  business_unit: "business_unit",
  bu: "business_unit",
  intercompany_tag: "intercompany_tag",
  currency: "currency",
  currency_code: "currency",
  posting_ref: "posting_ref",
  reference: "posting_ref",
  document_number: "posting_ref",
  doc_type: "doc_type",
  document_type: "doc_type",
};

const SELECT_CLASS =
  "h-10 w-full rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-3 text-sm text-[var(--color-onetext)] disabled:cursor-not-allowed disabled:opacity-50";

function headerKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s./-]+/g, "_");
}

function suggestedColumns(headers: string[]): ColumnDraft[] {
  const used = new Set<ImportMappingTarget>();
  return headers.map((header) => {
    const suggested = HEADER_ALIASES[headerKey(header)] ?? "";
    if (!suggested || used.has(suggested)) {
      return { sourcePattern: header, semanticTarget: "" };
    }
    used.add(suggested);
    return { sourcePattern: header, semanticTarget: suggested };
  });
}

function hasDuplicateSources(columns: ColumnDraft[]): boolean {
  const sources = new Set<string>();
  for (const column of columns) {
    const source = column.sourcePattern.trim().toLowerCase();
    if (sources.has(source)) return true;
    sources.add(source);
  }
  return false;
}

function mappingTargetsReady(columns: ColumnDraft[]): boolean {
  const targets = new Set(
    columns
      .map((column) => column.semanticTarget)
      .filter((target): target is ImportMappingTarget => target !== ""),
  );
  return (
    targets.has("period") &&
    targets.has("account_code") &&
    (targets.has("amount") || (targets.has("debit") && targets.has("credit")))
  );
}

type PipelineStage = "map" | "validate" | "preview";

function PipelineSteps({ stage }: { stage: PipelineStage }) {
  const { t } = useTranslation();
  const currentIndex = stage === "map" ? 2 : stage === "validate" ? 3 : 4;
  return (
    <nav aria-label={t("mappingWizard.steps.aria")}>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {PIPELINE_STEPS.map((step, index) => {
          const complete = index < currentIndex;
          const active =
            stage === "map" ? step === "normalize" || step === "map" : index === currentIndex;
          return (
            <li
              key={step}
              aria-current={index === currentIndex ? "step" : undefined}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
                active
                  ? "border-[var(--color-oneprimary)] bg-[var(--color-oneprimary)]/5 text-[var(--color-onetext)]"
                  : "border-[var(--color-oneborder)] text-[var(--color-onetextmuted)]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                  complete
                    ? "bg-[var(--color-onefavorable)] text-white"
                    : active
                      ? "bg-[var(--color-oneprimary)] text-white"
                      : "bg-[var(--color-onesurfacealt)]"
                }`}
              >
                {complete ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              {t(`mappingWizard.steps.${step}`)}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SourceFacts({ parsed }: { parsed: ImportParseData }) {
  const { t } = useTranslation();
  const locale = useSettingsStore((state) => state.preferences.locale);
  const count = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  return (
    <Card title={t("mappingWizard.source.title")}>
      <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-[var(--color-onetextmuted)]">{t("mappingWizard.source.file")}</dt>
          <dd className="mt-1 break-all font-medium text-[var(--color-onetext)]">
            {parsed.source_name}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-onetextmuted)]">{t("mappingWizard.source.rows")}</dt>
          <dd className="mt-1 font-medium tabular-nums text-[var(--color-onetext)]">
            {count.format(parsed.sheets.reduce((total, sheet) => total + sheet.row_count, 0))}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-onetextmuted)]">{t("mappingWizard.source.encoding")}</dt>
          <dd className="mt-1 font-medium text-[var(--color-onetext)]">
            {parsed.encodings.map((encoding) => encoding.encoding).join(", ") || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-onetextmuted)]">
            {t("mappingWizard.source.delimiter")}
          </dt>
          <dd className="mt-1 text-[var(--color-onetextsecondary)]">
            {t("mappingWizard.source.delimiterGate")}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function MappingWorkspace({ parsed, readOnly }: { parsed: ImportParseData; readOnly: boolean }) {
  const { t } = useTranslation();
  const mappingStatus = useImportStore((state) => state.mappingStatus);
  const mappingError = useImportStore((state) => state.mappingError);
  const mappingId = useImportStore((state) => state.mappingId);
  const mappingVersion = useImportStore((state) => state.mappingVersion);
  const saveMapping = useImportStore((state) => state.saveMapping);
  const chooseCanonicalMapping = useImportStore((state) => state.chooseCanonicalMapping);
  const clearMapping = useImportStore((state) => state.clearMapping);
  const [columns, setColumns] = useState<ColumnDraft[]>(() => suggestedColumns(parsed.headers));
  const [name, setName] = useState("");
  const [signConvention, setSignConvention] = useState<ImportSignConvention>("debit_positive");
  const [accountNormalization, setAccountNormalization] =
    useState<AccountCodeNormalization>("trim");
  const [dimensionNormalization, setDimensionNormalization] =
    useState<DimensionValueNormalization>("trim");
  const [periodNormalization, setPeriodNormalization] = useState<PeriodNormalization>("documented");

  const mappedColumns = columns.filter(
    (column): column is ColumnDraft & { semanticTarget: ImportMappingTarget } =>
      column.semanticTarget !== "",
  );
  const duplicateSources = hasDuplicateSources(columns);
  const invalidSource = mappedColumns.some((column) => {
    const source = column.sourcePattern.trim();
    const normalized = source.toLowerCase();
    return (
      !source ||
      [...source].length > 120 ||
      /\p{Cc}/u.test(source) ||
      normalized === "sign_convention" ||
      normalized.startsWith("__onefpa_")
    );
  });
  const targetsReady = mappingTargetsReady(columns);
  const allMapped = columns.length > 0 && mappedColumns.length === columns.length;
  const canonicalEligible =
    targetsReady &&
    mappedColumns.every(
      (column) => column.sourcePattern.trim().toLowerCase() === column.semanticTarget,
    );
  const templateReady =
    targetsReady &&
    !duplicateSources &&
    !invalidSource &&
    mappedColumns.length >= 3 &&
    name.trim().length > 0;
  const busy = mappingStatus === "loading";

  function updateTarget(index: number, target: ImportMappingTarget | "") {
    setColumns((current) =>
      current.map((column, columnIndex) =>
        columnIndex === index ? { ...column, semanticTarget: target } : column,
      ),
    );
    if (mappingStatus === "error") clearMapping();
  }

  function currentTemplate(): ImportMappingTemplate {
    return {
      name: name.trim(),
      columns: mappedColumns.map((column) => ({
        source_pattern: column.sourcePattern,
        semantic_target: column.semanticTarget,
      })),
      sign_convention: signConvention,
      normalization: {
        account_code: accountNormalization,
        dimension_values: dimensionNormalization,
        period: periodNormalization,
      },
    };
  }

  function save() {
    if (!templateReady || readOnly || busy) return;
    void saveMapping(currentTemplate());
  }

  if (mappingStatus === "success" && mappingId && mappingVersion) {
    return (
      <ValidationPanel
        parsed={parsed}
        mappingId={mappingId}
        mappingVersion={mappingVersion}
        readOnly={readOnly}
        onEditMapping={clearMapping}
      />
    );
  }

  if (busy) {
    return (
      <Card title={t("mappingWizard.editor.title")}>
        <StatePanel state="loading" message={t("mappingWizard.loading")}>
          <p className="text-xs text-[var(--color-onetextmuted)]">
            {t("mappingWizard.loadingHint")}
          </p>
        </StatePanel>
      </Card>
    );
  }

  const usedTargets = new Set(mappedColumns.map((column) => column.semanticTarget));

  return (
    <>
      {mappingStatus === "error" && (
        <Card title={t("mappingWizard.error.title")}>
          <StatePanel
            state="error"
            message={mappingError?.userMessage ?? t("mappingWizard.error.fallback")}
            errorCode={mappingError?.code ?? "INTERNAL"}
            onRetry={mappingError?.retryable && templateReady && !readOnly ? save : undefined}
          >
            <p className="text-xs text-[var(--color-onetextmuted)]">
              {t("mappingWizard.error.editHint")}
            </p>
          </StatePanel>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card title={t("mappingWizard.editor.title")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[var(--color-onetextsecondary)]">
              {t("mappingWizard.editor.coverage", {
                mapped: mappedColumns.length,
                total: columns.length,
              })}
            </p>
            {allMapped && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-onefavorable)]/10 px-2 py-1 text-xs font-medium text-[var(--color-onefavorable)]">
                <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
                {t("mappingWizard.editor.allMapped")}
              </span>
            )}
          </div>

          {columns.length === 0 ? (
            <StatePanel state="empty" message={t("mappingWizard.editor.noHeaders")} />
          ) : (
            <div className="mt-4 space-y-3">
              {columns.map((column, index) => (
                <div
                  key={`${column.sourcePattern}-${index}`}
                  className="grid items-center gap-2 rounded-md border border-[var(--color-oneborder)] p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-onetextmuted)]">
                      {t("mappingWizard.editor.source")}
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-[var(--color-onetext)]">
                      {column.sourcePattern || t("mappingWizard.editor.blankHeader")}
                    </p>
                  </div>
                  <Link2
                    aria-hidden="true"
                    className="hidden h-4 w-4 text-[var(--color-onetextmuted)] sm:block"
                  />
                  <div>
                    <label
                      htmlFor={`mapping-target-${index}`}
                      className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-onetextmuted)]"
                    >
                      {t("mappingWizard.editor.target")}
                    </label>
                    <select
                      id={`mapping-target-${index}`}
                      aria-label={t("mappingWizard.editor.mapAria", {
                        source: column.sourcePattern || t("mappingWizard.editor.blankHeader"),
                      })}
                      className={`${SELECT_CLASS} mt-1`}
                      value={column.semanticTarget}
                      onChange={(event) =>
                        updateTarget(index, event.target.value as ImportMappingTarget | "")
                      }
                    >
                      <option value="">{t("mappingWizard.editor.unmapped")}</option>
                      {IMPORT_MAPPING_TARGETS.map((target) => (
                        <option
                          key={target}
                          value={target}
                          disabled={usedTargets.has(target) && column.semanticTarget !== target}
                        >
                          {t(`mappingWizard.targets.${target}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 space-y-2" aria-live="polite">
            {!targetsReady && (
              <p className="flex items-start gap-2 text-xs text-[var(--color-onerror)]">
                <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                {t("mappingWizard.editor.required")}
              </p>
            )}
            {duplicateSources && (
              <p className="flex items-start gap-2 text-xs text-[var(--color-onerror)]">
                <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                {t("mappingWizard.editor.duplicateSources")}
              </p>
            )}
            {invalidSource && (
              <p className="flex items-start gap-2 text-xs text-[var(--color-onerror)]">
                <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                {t("mappingWizard.editor.invalidSource")}
              </p>
            )}
          </div>
        </Card>

        <div className="space-y-5">
          <Card title={t("mappingWizard.normalization.title")}>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="account-normalization"
                  className="text-sm font-medium text-[var(--color-onetextsecondary)]"
                >
                  {t("mappingWizard.normalization.account")}
                </label>
                <select
                  id="account-normalization"
                  className={`${SELECT_CLASS} mt-1.5`}
                  value={accountNormalization}
                  onChange={(event) =>
                    setAccountNormalization(event.target.value as AccountCodeNormalization)
                  }
                >
                  <option value="trim">{t("mappingWizard.normalization.trim")}</option>
                  <option value="trim_collapse_whitespace">
                    {t("mappingWizard.normalization.collapse")}
                  </option>
                  <option value="trim_collapse_whitespace_remove_hyphens">
                    {t("mappingWizard.normalization.removeHyphens")}
                  </option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="dimension-normalization"
                  className="text-sm font-medium text-[var(--color-onetextsecondary)]"
                >
                  {t("mappingWizard.normalization.dimensions")}
                </label>
                <select
                  id="dimension-normalization"
                  className={`${SELECT_CLASS} mt-1.5`}
                  value={dimensionNormalization}
                  onChange={(event) =>
                    setDimensionNormalization(event.target.value as DimensionValueNormalization)
                  }
                >
                  <option value="trim">{t("mappingWizard.normalization.trim")}</option>
                  <option value="trim_collapse_whitespace">
                    {t("mappingWizard.normalization.collapse")}
                  </option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="period-normalization"
                  className="text-sm font-medium text-[var(--color-onetextsecondary)]"
                >
                  {t("mappingWizard.normalization.period")}
                </label>
                <select
                  id="period-normalization"
                  className={`${SELECT_CLASS} mt-1.5`}
                  value={periodNormalization}
                  onChange={(event) =>
                    setPeriodNormalization(event.target.value as PeriodNormalization)
                  }
                >
                  <option value="documented">{t("mappingWizard.normalization.documented")}</option>
                  <option value="month_name_mmm_yy">
                    {t("mappingWizard.normalization.monthName")}
                  </option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="sign-convention"
                  className="text-sm font-medium text-[var(--color-onetextsecondary)]"
                >
                  {t("mappingWizard.normalization.sign")}
                </label>
                <select
                  id="sign-convention"
                  className={`${SELECT_CLASS} mt-1.5`}
                  value={signConvention}
                  onChange={(event) =>
                    setSignConvention(event.target.value as ImportSignConvention)
                  }
                >
                  <option value="debit_positive">
                    {t("mappingWizard.normalization.debitPositive")}
                  </option>
                  <option value="credit_positive">
                    {t("mappingWizard.normalization.creditPositive")}
                  </option>
                </select>
              </div>
              <div className="rounded-md bg-[var(--color-onesurfacealt)] p-3 text-xs text-[var(--color-onetextsecondary)]">
                <p className="font-medium text-[var(--color-onetext)]">
                  {t("mappingWizard.normalization.exampleTitle")}
                </p>
                <p className="mt-1 font-mono">
                  {accountNormalization === "trim_collapse_whitespace_remove_hyphens"
                    ? "4100-00 → 410000"
                    : "  004100  → 004100"}
                </p>
                <p className="mt-1 font-mono">
                  {periodNormalization === "month_name_mmm_yy"
                    ? "AUG26 → 2026-08"
                    : "FY26-P08 → FY26-P08"}
                </p>
              </div>
            </div>
          </Card>

          <Card title={t("mappingWizard.template.title")}>
            <div className="space-y-3">
              <Input
                id="mapping-template-name"
                label={t("mappingWizard.template.name")}
                hint={t("mappingWizard.template.versionHint")}
                value={name}
                maxLength={120}
                onChange={(event) => {
                  setName(event.target.value);
                  if (mappingStatus === "error") clearMapping();
                }}
                placeholder={t("mappingWizard.template.placeholder")}
              />
              {readOnly && (
                <p className="flex items-start gap-2 text-xs text-[var(--color-onerror)]">
                  <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  {t("mappingWizard.template.readOnly")}
                </p>
              )}
              <div className="flex flex-col gap-2">
                {canonicalEligible && (
                  <Button variant="secondary" onClick={chooseCanonicalMapping}>
                    <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                    {t("mappingWizard.template.useCanonical")}
                  </Button>
                )}
                <Button disabled={!templateReady || readOnly} onClick={save}>
                  <Save aria-hidden="true" className="h-4 w-4" />
                  {t("mappingWizard.template.save")}
                </Button>
              </div>
              <p className="text-xs text-[var(--color-onetextmuted)]">
                {t("mappingWizard.template.listGate")}
              </p>
            </div>
          </Card>
        </div>
      </div>

      <Card title={t("mappingWizard.preview.title")}>
        <div className="flex items-start gap-3 rounded-md bg-[var(--color-onesurfacealt)] p-4">
          <SlidersHorizontal
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-onetextmuted)]"
          />
          <div>
            <p className="text-sm font-medium text-[var(--color-onetext)]">
              {t("mappingWizard.preview.unavailable")}
            </p>
            <p className="mt-1 text-xs text-[var(--color-onetextsecondary)]">
              {t("mappingWizard.preview.gate")}
            </p>
          </div>
        </div>
      </Card>
    </>
  );
}

/** S-031 — current parse → explicit mapping → real validation findings + valid-row preview. */
export function MappingWizardPage() {
  const { t } = useTranslation();
  const companyId = useSessionStore((state) => state.companyId);
  const readOnly = useSessionStore((state) => state.readOnly);
  const parsed = useImportStore((state) => state.parsed);
  const mappingStatus = useImportStore((state) => state.mappingStatus);
  const validationStatus = useImportStore((state) => state.validationStatus);
  const validationResult = useImportStore((state) => state.validationResult);
  const scopeToCompany = useImportStore((state) => state.scopeToCompany);

  useLayoutEffect(() => {
    scopeToCompany(companyId);
  }, [companyId, scopeToCompany]);

  const validationStarted =
    mappingStatus === "success" &&
    (validationResult !== null || validationStatus === "loading" || validationStatus === "error");
  const pipelineStage: PipelineStage =
    mappingStatus !== "success"
      ? "map"
      : validationResult && validationResult.hard.length === 0
        ? "preview"
        : "validate";
  const screenState: ScreenState =
    !companyId || !parsed
      ? "empty"
      : validationStarted
        ? validationStatus
        : mappingStatus === "loading" || mappingStatus === "error" || mappingStatus === "success"
          ? mappingStatus
          : "populated";

  return (
    <main data-screen-state={screenState} className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-[var(--color-onetext)]">
            <FileSpreadsheet
              aria-hidden="true"
              className="h-5 w-5 text-[var(--color-oneprimary)]"
            />
            {t("mappingWizard.title")}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-onetextsecondary)]">
            {t("mappingWizard.subtitle")}
          </p>
        </div>
        <Link
          to="/app/import"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--color-oneborder)] px-3 text-sm text-[var(--color-onetextsecondary)] hover:border-[var(--color-oneprimary)]"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {t("mappingWizard.back")}
        </Link>
      </div>

      <PipelineSteps stage={pipelineStage} />

      {!companyId || !parsed ? (
        <Card title={t("mappingWizard.editor.title")}>
          <StatePanel
            state="empty"
            message={
              companyId ? t("mappingWizard.empty.noParse") : t("mappingWizard.empty.noCompany")
            }
          >
            <Link
              to="/app/import"
              className="text-sm font-medium text-[var(--color-oneprimary)] underline-offset-2 hover:underline"
            >
              {t("mappingWizard.empty.return")}
            </Link>
          </StatePanel>
        </Card>
      ) : (
        <>
          <SourceFacts parsed={parsed} />
          <MappingWorkspace key={parsed.parse_id} parsed={parsed} readOnly={readOnly} />
        </>
      )}

      <p className="flex items-start gap-2 text-xs text-[var(--color-onetextmuted)]">
        {screenState === "loading" ? (
          <Loader2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        )}
        {t("mappingWizard.localOnly")}
      </p>
    </main>
  );
}
