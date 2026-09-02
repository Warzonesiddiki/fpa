import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileCheck2, LockKeyhole } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type { ImportExclusion } from "@/api/schema";
import { Button, Card, Input, MoneyCell, StatePanel } from "@/components/ui";
import { useImportStore } from "@/stores/import";
import { useSessionStore } from "@/stores/session";
import { useSettingsStore } from "@/stores/settings";

interface ExclusionDraft {
  selected: boolean;
  reason: string;
}

interface BatchDraft {
  parseId: string | null;
  name: string;
}

interface ExclusionState {
  parseId: string | null;
  drafts: Record<string, ExclusionDraft>;
}

export function ImportCommitPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const parsed = useImportStore((state) => state.parsed);
  const mappingId = useImportStore((state) => state.mappingId);
  const mappingVersion = useImportStore((state) => state.mappingVersion);
  const validationResult = useImportStore((state) => state.validationResult);
  const tieOutStatus = useImportStore((state) => state.tieOutStatus);
  const tieOutError = useImportStore((state) => state.tieOutError);
  const tieOutResult = useImportStore((state) => state.tieOutResult);
  const commitStatus = useImportStore((state) => state.commitStatus);
  const commitError = useImportStore((state) => state.commitError);
  const commitResult = useImportStore((state) => state.commitResult);
  const runTieOut = useImportStore((state) => state.runTieOut);
  const commitBatch = useImportStore((state) => state.commitBatch);
  const readOnly = useSessionStore((state) => state.readOnly);
  const locale = useSettingsStore((state) => state.preferences.locale);
  const count = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const defaultBatchName = parsed ? parsed.source_name.replace(/\.[^.]+$/, "") : "";
  const [batchDraft, setBatchDraft] = useState<BatchDraft>(() => ({
    parseId: parsed?.parse_id ?? null,
    name: defaultBatchName,
  }));
  const [exclusionState, setExclusionState] = useState<ExclusionState>(() => ({
    parseId: parsed?.parse_id ?? null,
    drafts: {},
  }));
  const batchName = batchDraft.parseId === parsed?.parse_id ? batchDraft.name : defaultBatchName;
  const exclusionDrafts = exclusionState.parseId === parsed?.parse_id ? exclusionState.drafts : {};

  const eligible = Boolean(
    parsed &&
    mappingId &&
    mappingVersion &&
    validationResult &&
    validationResult.hard.length === 0 &&
    validationResult.mapping_version === mappingVersion,
  );

  useEffect(() => {
    if (eligible && tieOutStatus === "empty" && !tieOutResult) void runTieOut();
  }, [eligible, runTieOut, tieOutResult, tieOutStatus]);

  if (!eligible || !parsed || !mappingId || !mappingVersion) {
    return (
      <Card title={t("importCommit.title")}>
        <StatePanel
          state="empty"
          message={t("importCommit.noValidatedImport")}
          actionLabel={t("importCommit.returnToMapping")}
          onAction={() => navigate("/app/import/map")}
        />
      </Card>
    );
  }

  if (tieOutStatus === "loading") {
    return (
      <Card title={t("importCommit.title")}>
        <StatePanel state="loading" message={t("importCommit.loading")} />
      </Card>
    );
  }

  if (tieOutStatus === "error" || !tieOutResult) {
    const parseExpired = tieOutError?.code === "IMPORT_PARSE_EXPIRED";
    return (
      <Card title={t("importCommit.title")}>
        <StatePanel
          state="error"
          message={tieOutError?.userMessage ?? t("importCommit.tieOutError")}
          errorCode={tieOutError?.code ?? "INTERNAL"}
          onRetry={!parseExpired && tieOutError?.retryable ? () => void runTieOut() : undefined}
        >
          {parseExpired && (
            <Link
              className="text-sm font-medium text-[var(--color-oneaccent)] underline"
              to="/app/import"
            >
              {t("importCommit.selectAgain")}
            </Link>
          )}
        </StatePanel>
      </Card>
    );
  }

  if (tieOutResult.rows === 0) {
    return (
      <Card title={t("importCommit.title")}>
        <StatePanel state="empty" message={t("importCommit.noRows")}>
          <Link
            className="text-sm font-medium text-[var(--color-oneaccent)] underline"
            to="/app/import/map"
          >
            {t("importCommit.returnToMapping")}
          </Link>
        </StatePanel>
      </Card>
    );
  }

  const activeParseId = parsed.parse_id;
  const selectedExclusions: ImportExclusion[] = tieOutResult.diff_rows
    .filter((row) => exclusionDrafts[String(row.line_no)]?.selected)
    .map((row) => ({
      line_no: row.line_no,
      reason: exclusionDrafts[String(row.line_no)]?.reason.trim() ?? "",
    }));
  const exclusionsComplete = selectedExclusions.every((exclusion) => exclusion.reason.length > 0);
  const adjustedGateReady =
    tieOutResult.balanced || (selectedExclusions.length > 0 && exclusionsComplete);
  const nameReady = batchName.trim().length > 0 && batchName.trim().length <= 120;
  const canCommit =
    adjustedGateReady && nameReady && !readOnly && commitStatus !== "loading" && !commitResult;
  const displayedDebits = commitResult?.debits_minor ?? tieOutResult.debits_minor;
  const displayedCredits = commitResult?.credits_minor ?? tieOutResult.credits_minor;
  const displayedBalanced = commitResult ? true : tieOutResult.balanced;

  function updateExclusion(lineNo: number, patch: Partial<ExclusionDraft>) {
    const key = String(lineNo);
    setExclusionState((current) => {
      const drafts = current.parseId === activeParseId ? current.drafts : {};
      return {
        parseId: activeParseId,
        drafts: {
          ...drafts,
          [key]: {
            selected: drafts[key]?.selected ?? false,
            reason: drafts[key]?.reason ?? "",
            ...patch,
          },
        },
      };
    });
  }

  function submitCommit() {
    if (!canCommit) return;
    void commitBatch(batchName.trim(), selectedExclusions);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/app/import/map"
            className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--color-onetextsecondary)] hover:text-[var(--color-onetext)]"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            {t("importCommit.back")}
          </Link>
          <h1 className="text-2xl font-semibold text-[var(--color-onetext)]">
            {t("importCommit.title")}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-onetextsecondary)]">
            {t("importCommit.subtitle")}
          </p>
        </div>
        <span className="rounded-full bg-[var(--color-onesurfacealt)] px-3 py-1 font-mono text-xs text-[var(--color-onetextsecondary)]">
          {t("importCommit.mappingVersion", { version: mappingVersion })}
        </span>
      </div>

      {readOnly && (
        <div
          role="alert"
          className="flex gap-3 rounded-lg border border-[var(--color-onewarning)] bg-[var(--color-onewarningcontainer)] p-4 text-sm text-[var(--color-onewarning)]"
        >
          <LockKeyhole aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{t("importCommit.readOnly")}</p>
        </div>
      )}

      <Card title={t("importCommit.identity.title")}>
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-[var(--color-onetextmuted)]">
              {t("importCommit.identity.source")}
            </dt>
            <dd className="mt-1 break-all font-medium text-[var(--color-onetext)]">
              {parsed.source_name}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-onetextmuted)]">
              {t("importCommit.identity.sourceHash")}
            </dt>
            <dd className="mt-1 break-all font-mono text-xs text-[var(--color-onetext)]">
              {parsed.source_hash}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-onetextmuted)]">
              {t("importCommit.identity.currency")}
            </dt>
            <dd className="mt-1 font-mono font-medium text-[var(--color-onetext)]">
              {tieOutResult.currency}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-onetextmuted)]">
              {t("importCommit.identity.validRows")}
            </dt>
            <dd className="mt-1 font-mono font-medium tabular-nums text-[var(--color-onetext)]">
              {count.format(tieOutResult.rows)}
            </dd>
          </div>
        </dl>
      </Card>

      <Card title={t("importCommit.tieOut.title")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md bg-[var(--color-onesurfacealt)] p-4">
            <p className="text-xs text-[var(--color-onetextmuted)]">
              {t("importCommit.tieOut.debits")}
            </p>
            <p className="mt-1 text-lg font-semibold text-[var(--color-onetext)]">
              <MoneyCell minor={displayedDebits} currency={tieOutResult.currency} />
            </p>
          </div>
          <div className="rounded-md bg-[var(--color-onesurfacealt)] p-4">
            <p className="text-xs text-[var(--color-onetextmuted)]">
              {t("importCommit.tieOut.credits")}
            </p>
            <p className="mt-1 text-lg font-semibold text-[var(--color-onetext)]">
              <MoneyCell minor={displayedCredits} currency={tieOutResult.currency} />
            </p>
          </div>
          <div className="rounded-md bg-[var(--color-onesurfacealt)] p-4">
            <p className="text-xs text-[var(--color-onetextmuted)]">
              {t("importCommit.tieOut.state")}
            </p>
            <p
              className={`mt-1 flex items-center gap-2 font-semibold ${
                displayedBalanced
                  ? "text-[var(--color-onefavorable)]"
                  : "text-[var(--color-onewarning)]"
              }`}
            >
              {displayedBalanced ? (
                <CheckCircle2 aria-hidden="true" className="h-5 w-5" />
              ) : (
                <AlertTriangle aria-hidden="true" className="h-5 w-5" />
              )}
              {displayedBalanced
                ? t("importCommit.tieOut.balanced")
                : t("importCommit.tieOut.unbalanced")}
            </p>
          </div>
        </div>
      </Card>

      {!tieOutResult.balanced && !commitResult && (
        <Card title={t("importCommit.exclusions.title")}>
          <p className="mb-4 text-sm text-[var(--color-onetextsecondary)]">
            {t("importCommit.exclusions.description")}
          </p>
          {tieOutResult.diff_rows.length === 0 ? (
            <StatePanel
              state="error"
              message={t("importCommit.exclusions.unattributed")}
              errorCode="IMPORT_TIE_OUT_FAILED"
            />
          ) : (
            <fieldset className="space-y-3">
              <legend className="sr-only">{t("importCommit.exclusions.title")}</legend>
              {tieOutResult.diff_rows.map((row) => {
                const draft = exclusionDrafts[String(row.line_no)] ?? {
                  selected: false,
                  reason: "",
                };
                return (
                  <div
                    key={row.line_no}
                    className="rounded-lg border border-[var(--color-oneborder)] p-4"
                  >
                    <label
                      aria-label={t("importCommit.exclusions.line", { line: row.line_no })}
                      className="flex cursor-pointer items-start gap-3"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-[var(--color-oneaccent)]"
                        checked={draft.selected}
                        onChange={(event) =>
                          updateExclusion(row.line_no, { selected: event.target.checked })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-[var(--color-onetext)]">
                          {t("importCommit.exclusions.line", { line: row.line_no })}
                        </span>
                        <span className="mt-1 grid gap-2 text-xs text-[var(--color-onetextsecondary)] sm:grid-cols-2 lg:grid-cols-5">
                          <span>
                            {t("importCommit.exclusions.postingRef")}: {row.posting_ref ?? "—"}
                          </span>
                          <span>
                            {t("importCommit.exclusions.debit")}:{" "}
                            <MoneyCell minor={row.debit_minor} currency={tieOutResult.currency} />
                          </span>
                          <span>
                            {t("importCommit.exclusions.credit")}:{" "}
                            <MoneyCell minor={row.credit_minor} currency={tieOutResult.currency} />
                          </span>
                          <span>
                            {t("importCommit.exclusions.amount")}:{" "}
                            <MoneyCell minor={row.amount_minor} currency={tieOutResult.currency} />
                          </span>
                          <span>
                            {t("importCommit.exclusions.residual")}:{" "}
                            <MoneyCell
                              minor={row.residual_minor}
                              currency={tieOutResult.currency}
                            />
                          </span>
                        </span>
                      </span>
                    </label>
                    {draft.selected && (
                      <div className="mt-3">
                        <label
                          htmlFor={`exclusion-reason-${row.line_no}`}
                          className="text-sm font-medium text-[var(--color-onetextsecondary)]"
                        >
                          {t("importCommit.exclusions.reason")}
                        </label>
                        <textarea
                          id={`exclusion-reason-${row.line_no}`}
                          required
                          maxLength={500}
                          value={draft.reason}
                          onChange={(event) =>
                            updateExclusion(row.line_no, { reason: event.target.value })
                          }
                          className="mt-1.5 min-h-20 w-full rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-3 py-2 text-sm text-[var(--color-onetext)]"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </fieldset>
          )}
          <p className="mt-4 text-xs text-[var(--color-onetextmuted)]">
            {t("importCommit.exclusions.authoritative")}
          </p>
        </Card>
      )}

      <Card title={t("importCommit.batch.title")}>
        <div className="space-y-4">
          <Input
            id="import-batch-name"
            label={t("importCommit.batch.name")}
            value={batchName}
            maxLength={120}
            onChange={(event) =>
              setBatchDraft({ parseId: activeParseId, name: event.target.value })
            }
            errorText={
              !nameReady && batchName.length > 0 ? t("importCommit.batch.nameError") : undefined
            }
            hint={t("importCommit.batch.nameHint")}
            disabled={Boolean(commitResult)}
          />

          {commitStatus === "error" && commitError && (
            <StatePanel
              state="error"
              message={commitError.userMessage}
              errorCode={commitError.code}
              onRetry={commitError.retryable && canCommit ? submitCommit : undefined}
            />
          )}

          {commitResult ? (
            <StatePanel state="success" message={t("importCommit.success.title")}>
              <div className="space-y-2 text-sm text-[var(--color-onetextsecondary)]">
                <p>{t("importCommit.success.batch", { id: commitResult.batch_id })}</p>
                <p>
                  {t("importCommit.success.rows", {
                    rows: count.format(commitResult.rows),
                    excluded: count.format(commitResult.excluded_rows),
                  })}
                </p>
                <p>{t("importCommit.success.audit", { id: commitResult.audit_id })}</p>
                <p>
                  {t("importCommit.success.tieOutStatus", {
                    status: commitResult.tie_out_status,
                  })}
                </p>
                <Link
                  to="/app/import"
                  className="inline-flex h-10 items-center justify-center rounded-md bg-[var(--color-oneaccent)] px-4 font-medium text-white"
                >
                  {t("importCommit.success.history")}
                </Link>
              </div>
            </StatePanel>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p id="commit-gate" className="text-xs text-[var(--color-onetextmuted)]">
                {readOnly
                  ? t("importCommit.gate.readOnly")
                  : adjustedGateReady
                    ? t("importCommit.gate.ready")
                    : t("importCommit.gate.exclusions")}
              </p>
              <Button onClick={submitCommit} disabled={!canCommit} aria-describedby="commit-gate">
                <FileCheck2 aria-hidden="true" className="h-4 w-4" />
                {commitStatus === "loading"
                  ? t("importCommit.committing")
                  : t("importCommit.commit")}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
