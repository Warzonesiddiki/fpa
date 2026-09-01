import { useMemo } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { RowIssue, ImportParseData as ImportParseResult } from "@/api/schema";
import { Button, Card, MoneyCell, StatePanel } from "@/components/ui";
import { useImportStore } from "@/stores/import";
import { useSettingsStore } from "@/stores/settings";

const FINDING_DISPLAY_LIMIT = 50;

interface ValidationPanelProps {
  parsed: ImportParseResult;
  mappingId: string;
  mappingVersion: string;
  readOnly: boolean;
  onEditMapping: () => void;
}

interface FindingListProps {
  severity: "hard" | "warning";
  findings: RowIssue[];
}

function detailValue(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (
    Array.isArray(value) &&
    value.every(
      (item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean",
    )
  ) {
    return value.map(String).join(", ");
  }
  return null;
}

function FindingList({ severity, findings }: FindingListProps) {
  const { t } = useTranslation();
  if (findings.length === 0) return null;

  const displayed = findings.slice(0, FINDING_DISPLAY_LIMIT);
  const remaining = findings.length - displayed.length;
  const hard = severity === "hard";
  const tone = hard ? "text-[var(--color-onerror)]" : "text-[var(--color-onewarning)]";

  return (
    <Card
      title={t(`mappingWizard.validation.findings.${severity}.title`, {
        count: findings.length,
      })}
      data-testid={`${severity}-findings`}
    >
      <p className="mb-3 text-xs text-[var(--color-onetextsecondary)]">
        {t(`mappingWizard.validation.findings.${severity}.description`)}
      </p>
      <ol
        className="space-y-3"
        aria-label={t(`mappingWizard.validation.findings.${severity}.label`)}
      >
        {displayed.map((finding, index) => {
          const details = Object.entries(finding.details)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, value]) => [key, detailValue(value)] as const)
            .filter((entry): entry is readonly [string, string] => entry[1] !== null);
          return (
            <li
              key={`${finding.code}-${finding.line_no ?? "batch"}-${String(index)}`}
              className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`font-bold ${tone}`}>{hard ? "HARD" : "WARNING"}</span>
                <code className="font-mono text-[var(--color-onetext)]">{finding.code}</code>
                <span className="text-[var(--color-onetextmuted)]">
                  {finding.line_no === null
                    ? t("mappingWizard.validation.findings.batch")
                    : t("mappingWizard.validation.findings.row", { row: finding.line_no })}
                </span>
              </div>
              <p className="mt-2 break-words text-sm text-[var(--color-onetext)]">
                {finding.message}
              </p>
              {details.length > 0 && (
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-onetextsecondary)]">
                  {details.map(([key, value]) => (
                    <div key={key} className="flex gap-1">
                      <dt className="font-medium">{key}:</dt>
                      <dd className="break-all font-mono">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ol>
      {remaining > 0 && (
        <p className="mt-3 text-xs font-medium text-[var(--color-onetextsecondary)]">
          {t("mappingWizard.validation.findings.more", { count: remaining })}
        </p>
      )}
    </Card>
  );
}

function MappingContext({
  parsed,
  mappingId,
  mappingVersion,
  onEditMapping,
}: Omit<ValidationPanelProps, "readOnly" | "onEditMapping"> & {
  onEditMapping?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card
      title={t("mappingWizard.validation.context.title")}
      actions={
        onEditMapping ? (
          <Button variant="ghost" size="sm" onClick={onEditMapping}>
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            {t("mappingWizard.validation.actions.editMapping")}
          </Button>
        ) : undefined
      }
    >
      <p className="mb-3 text-sm font-medium text-[var(--color-onetext)]">
        {mappingId === "canonical"
          ? t("mappingWizard.result.canonical")
          : t("mappingWizard.result.saved")}
      </p>
      <dl className="grid gap-3 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-[var(--color-onetextmuted)]">
            {t("mappingWizard.validation.context.source")}
          </dt>
          <dd className="mt-1 break-all font-medium text-[var(--color-onetext)]">
            {parsed.source_name}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-onetextmuted)]">
            {t("mappingWizard.validation.context.mappingVersion")}
          </dt>
          <dd className="mt-1 font-medium text-[var(--color-onetext)]">{mappingVersion}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-onetextmuted)]">
            {t("mappingWizard.validation.context.mappingId")}
          </dt>
          <dd className="mt-1 break-all font-mono text-[var(--color-onetext)]">{mappingId}</dd>
        </div>
      </dl>
    </Card>
  );
}

function PreviewTable() {
  const { t } = useTranslation();
  const result = useImportStore((store) => store.validationResult);
  if (!result || result.preview.length === 0) {
    return (
      <Card title={t("mappingWizard.validation.preview.title")}>
        <StatePanel state="empty" message={t("mappingWizard.validation.preview.emptyTitle")}>
          <p className="text-xs text-[var(--color-onetextsecondary)]">
            {t("mappingWizard.validation.preview.emptyDescription")}
          </p>
        </StatePanel>
      </Card>
    );
  }

  return (
    <Card title={t("mappingWizard.validation.preview.title")} data-testid="mapped-preview">
      <p className="mb-3 text-xs text-[var(--color-onetextsecondary)]">
        {t("mappingWizard.validation.preview.description", {
          shown: result.preview.length,
          rows: result.rows,
        })}
      </p>
      <div className="overflow-x-auto rounded-md border border-[var(--color-oneborder)]">
        <table className="min-w-[1050px] w-full border-collapse text-left text-xs">
          <caption className="sr-only">{t("mappingWizard.validation.preview.caption")}</caption>
          <thead className="bg-[var(--color-onesurfacealt)] text-[var(--color-onetextsecondary)]">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("mappingWizard.validation.preview.columns.row")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("mappingWizard.validation.preview.columns.period")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("mappingWizard.validation.preview.columns.account")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("mappingWizard.validation.preview.columns.businessUnit")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("mappingWizard.validation.preview.columns.debit")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("mappingWizard.validation.preview.columns.credit")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("mappingWizard.validation.preview.columns.net")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("mappingWizard.validation.preview.columns.reference")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("mappingWizard.validation.preview.columns.type")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("mappingWizard.validation.preview.columns.intercompany")}
              </th>
            </tr>
          </thead>
          <tbody>
            {result.preview.map((row) => (
              <tr
                key={`${String(row.line_no)}-${row.account_id}`}
                className="border-t border-[var(--color-oneborder)] text-[var(--color-onetext)]"
              >
                <td className="px-3 py-2 font-mono tabular-nums">{row.line_no}</td>
                <td className="px-3 py-2 font-mono">{row.period_id}</td>
                <td className="px-3 py-2">
                  <span className="font-medium">{row.account_code}</span>
                  <span className="block font-mono text-[var(--color-onetextmuted)]">
                    {row.account_id}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono">{row.business_unit_id ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  <MoneyCell minor={row.debit_minor} currency={row.currency} />
                </td>
                <td className="px-3 py-2 text-right">
                  <MoneyCell minor={row.credit_minor} currency={row.currency} />
                </td>
                <td className="px-3 py-2 text-right">
                  <MoneyCell minor={row.amount_minor} currency={row.currency} />
                </td>
                <td className="px-3 py-2 font-mono">{row.posting_ref ?? "—"}</td>
                <td className="px-3 py-2">{row.doc_type ?? "—"}</td>
                <td className="px-3 py-2">
                  {row.is_ic
                    ? t("mappingWizard.validation.preview.yes")
                    : t("mappingWizard.validation.preview.no")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function ValidationPanel({
  parsed,
  mappingId,
  mappingVersion,
  readOnly,
  onEditMapping,
}: ValidationPanelProps) {
  const { t } = useTranslation();
  const validationStatus = useImportStore((store) => store.validationStatus);
  const validationError = useImportStore((store) => store.validationError);
  const result = useImportStore((store) => store.validationResult);
  const validateMapping = useImportStore((store) => store.validateMapping);
  const filePath = useImportStore((store) => store.filePath);
  const selectFile = useImportStore((store) => store.selectFile);
  const locale = useSettingsStore((store) => store.preferences.locale);
  const count = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const runValidation = () => void validateMapping();
  const parseExpired = validationError?.code === "IMPORT_PARSE_EXPIRED";

  return (
    <div className="space-y-4">
      <MappingContext
        parsed={parsed}
        mappingId={mappingId}
        mappingVersion={mappingVersion}
        onEditMapping={parseExpired || result !== null ? undefined : onEditMapping}
      />

      {result === null && validationStatus === "empty" && (
        <Card>
          <StatePanel state="success" message={t("mappingWizard.validation.ready.title")}>
            <div className="space-y-3">
              <p className="text-xs text-[var(--color-onetextsecondary)]">
                {t("mappingWizard.validation.ready.description")}
              </p>
              <p className="text-xs text-[var(--color-onetextmuted)]">
                {t("mappingWizard.validation.ready.noWrite")}
              </p>
              {readOnly && (
                <p className="flex items-start gap-2 text-xs text-[var(--color-onetextsecondary)]">
                  <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  {t("mappingWizard.validation.ready.readOnly")}
                </p>
              )}
              <Button onClick={runValidation}>
                {t("mappingWizard.validation.actions.continue")}
              </Button>
            </div>
          </StatePanel>
        </Card>
      )}

      {validationStatus === "loading" && (
        <Card>
          <StatePanel state="loading" message={t("mappingWizard.validation.loading.title")}>
            <p className="text-xs text-[var(--color-onetextsecondary)]">
              {t("mappingWizard.validation.loading.description")}
            </p>
          </StatePanel>
        </Card>
      )}

      {validationStatus === "error" && (
        <Card title={t("mappingWizard.validation.error.title")}>
          <StatePanel
            state="error"
            message={validationError?.userMessage ?? t("mappingWizard.validation.error.fallback")}
            errorCode={validationError?.code}
            onRetry={!parseExpired && validationError?.retryable ? runValidation : undefined}
          >
            <Link
              to="/app/import"
              onClick={parseExpired ? () => selectFile(filePath) : undefined}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--color-oneprimary)] px-4 text-sm font-medium text-white hover:bg-[var(--color-oneprimaryhover)]"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              {t("mappingWizard.validation.actions.returnToHub")}
            </Link>
          </StatePanel>
        </Card>
      )}

      {result !== null && validationStatus !== "loading" && validationStatus !== "error" && (
        <>
          <Card>
            <StatePanel
              state={validationStatus}
              message={
                result.hard.length > 0
                  ? t("mappingWizard.validation.outcome.blockedTitle")
                  : result.rows === 0
                    ? t("mappingWizard.validation.outcome.emptyTitle")
                    : t("mappingWizard.validation.outcome.cleanTitle")
              }
            >
              <p className="text-xs text-[var(--color-onetextsecondary)]">
                {result.hard.length > 0
                  ? t("mappingWizard.validation.outcome.blockedDescription")
                  : result.rows === 0
                    ? t("mappingWizard.validation.outcome.emptyDescription")
                    : result.warnings.length > 0
                      ? t("mappingWizard.validation.outcome.warningDescription")
                      : t("mappingWizard.validation.outcome.cleanDescription")}
              </p>
            </StatePanel>
            <dl
              className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"
              aria-label={t("mappingWizard.validation.summary.label")}
            >
              {(
                [
                  [t("mappingWizard.validation.summary.validRows"), result.rows],
                  [t("mappingWizard.validation.summary.hard"), result.hard.length],
                  [t("mappingWizard.validation.summary.warnings"), result.warnings.length],
                  [t("mappingWizard.validation.summary.previewRows"), result.preview.length],
                ] satisfies Array<[string, number]>
              ).map(([label, value]) => (
                <div key={String(label)} className="rounded-md bg-[var(--color-onesurfacealt)] p-3">
                  <dt className="text-xs text-[var(--color-onetextmuted)]">{label}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums text-[var(--color-onetext)]">
                    {count.format(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          <FindingList severity="hard" findings={result.hard} />
          <FindingList severity="warning" findings={result.warnings} />
          <PreviewTable />

          <Card title={t("mappingWizard.validation.remediation.title")}>
            <p className="text-sm text-[var(--color-onetextsecondary)]">
              {t("mappingWizard.validation.remediation.description")}
            </p>
            <p className="mt-2 text-xs text-[var(--color-onetextmuted)]">
              {t("mappingWizard.validation.remediation.unsupported")}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button variant="secondary" onClick={onEditMapping}>
                {t("mappingWizard.validation.actions.editMapping")}
              </Button>
              <Link
                to="/app/import"
                className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurfacealt)]"
              >
                {t("mappingWizard.validation.actions.returnToHub")}
              </Link>
              <Button disabled aria-describedby="tieout-gate">
                {t("mappingWizard.validation.actions.tieOut")}
              </Button>
            </div>
            <p id="tieout-gate" className="mt-3 text-xs text-[var(--color-onetextmuted)]">
              {result.hard.length > 0
                ? t("mappingWizard.validation.remediation.hardGate")
                : t("mappingWizard.validation.remediation.milestoneGate")}
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
