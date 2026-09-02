import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, MoneyCell, StatePanel } from "@/components/ui";
import { useImportHistoryStore } from "@/stores/importHistory";
import { useSettingsStore } from "@/stores/settings";

export function ImportHistoryPanel({
  companyId,
  readOnly,
}: {
  companyId: string | null;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const locale = useSettingsStore((state) => state.preferences.locale);
  const count = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const status = useImportHistoryStore((state) => state.status);
  const error = useImportHistoryStore((state) => state.error);
  const result = useImportHistoryStore((state) => state.result);
  const rollbackStatus = useImportHistoryStore((state) => state.rollbackStatus);
  const rollbackError = useImportHistoryStore((state) => state.rollbackError);
  const rollbackResult = useImportHistoryStore((state) => state.rollbackResult);
  const rollbackBatchId = useImportHistoryStore((state) => state.rollbackBatchId);
  const scopeToCompany = useImportHistoryStore((state) => state.scopeToCompany);
  const load = useImportHistoryStore((state) => state.load);
  const beginRollback = useImportHistoryStore((state) => state.beginRollback);
  const rollback = useImportHistoryStore((state) => state.rollback);
  const clearRollback = useImportHistoryStore((state) => state.clearRollback);
  const [reason, setReason] = useState("");

  useLayoutEffect(() => {
    scopeToCompany(companyId);
  }, [companyId, scopeToCompany]);

  useEffect(() => {
    if (companyId) void load(1);
  }, [companyId, load]);

  if (!companyId) {
    return <StatePanel state="empty" message={t("importHub.history.noCompany")} />;
  }
  if (status === "loading" && !result) {
    return <StatePanel state="loading" message={t("importHub.history.loading")} />;
  }
  if (status === "error" && !result) {
    return (
      <StatePanel
        state="error"
        message={error?.userMessage ?? t("importHub.history.error")}
        errorCode={error?.code ?? "INTERNAL"}
        onRetry={error?.retryable ? () => void load(1) : undefined}
      />
    );
  }
  if (!result || result.rows.length === 0) {
    return (
      <StatePanel state="empty" message={t("importHub.history.empty")}>
        <p className="text-xs text-[var(--color-onetextmuted)]">
          {t("importHub.history.emptyHint")}
        </p>
      </StatePanel>
    );
  }

  const activeRollback = rollbackBatchId
    ? result.rows.find((batch) => batch.batch_id === rollbackBatchId)
    : undefined;
  const reasonReady = reason.trim().length > 0 && reason.trim().length <= 500;

  function openRollback(batchId: string) {
    setReason("");
    beginRollback(batchId);
  }

  function submitRollback() {
    if (!activeRollback || !reasonReady || readOnly || rollbackStatus === "loading") return;
    void rollback(activeRollback.batch_id, reason.trim());
  }

  return (
    <div className="space-y-4">
      {status === "error" && error && (
        <StatePanel
          state="error"
          message={error.userMessage}
          errorCode={error.code}
          onRetry={error.retryable ? () => void load(result.meta.page) : undefined}
        />
      )}
      {readOnly && (
        <p role="note" className="text-xs text-[var(--color-onewarning)]">
          {t("importHub.history.rollback.readOnly")}
        </p>
      )}
      {status === "loading" && (
        <p role="status" className="text-xs text-[var(--color-onetextmuted)]">
          {t("importHub.history.refreshing")}
        </p>
      )}
      {rollbackStatus === "success" && rollbackResult && (
        <div
          role="status"
          className="flex gap-2 rounded-md border border-[var(--color-onefavorable)]/40 bg-[var(--color-onefavorable)]/5 p-3 text-sm text-[var(--color-onetext)]"
        >
          <CheckCircle2
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-[var(--color-onefavorable)]"
          />
          <p>
            {rollbackResult.rolled_back_to
              ? t("importHub.history.rollback.successPrevious", {
                  id: rollbackResult.rolled_back_to,
                })
              : t("importHub.history.rollback.successBaseline")}
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-[var(--color-oneborder)]">
        <table className="w-full min-w-[920px] text-left text-xs">
          <caption className="sr-only">{t("importHub.history.caption")}</caption>
          <thead className="bg-[var(--color-onesurfacealt)] text-[var(--color-onetextsecondary)]">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("importHub.history.columns.source")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("importHub.history.columns.status")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("importHub.history.columns.rows")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("importHub.history.columns.debits")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("importHub.history.columns.credits")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("importHub.history.columns.mapping")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("importHub.history.columns.committed")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("importHub.history.columns.action")}
              </th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((batch) => (
              <tr
                key={batch.batch_id}
                className="border-t border-[var(--color-oneborder)] align-top"
              >
                <td className="max-w-52 px-3 py-3">
                  <p
                    className="truncate font-semibold text-[var(--color-onetext)]"
                    title={batch.name}
                  >
                    {batch.name}
                  </p>
                  <p
                    className="mt-1 truncate text-[var(--color-onetextsecondary)]"
                    title={batch.source_name}
                  >
                    {batch.source_name}
                  </p>
                  <p
                    className="mt-1 truncate font-mono text-[10px] text-[var(--color-onetextmuted)]"
                    title={batch.source_hash}
                  >
                    {batch.source_hash}
                  </p>
                  <p className="mt-1 text-[10px] text-[var(--color-onetextmuted)]">{batch.kind}</p>
                </td>
                <td className="px-3 py-3">
                  <span className="rounded-full bg-[var(--color-onesurfacealt)] px-2 py-1 font-medium text-[var(--color-onetextsecondary)]">
                    {t(`importHub.history.status.${batch.status}`)}
                  </span>
                  <p className="mt-2 text-[10px] text-[var(--color-onetextmuted)]">
                    {t(`importHub.history.tieOut.${batch.tie_out_status}`)}
                  </p>
                </td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-[var(--color-onetext)]">
                  {count.format(batch.rows)}
                </td>
                <td className="px-3 py-3 text-right text-[var(--color-onetext)]">
                  <MoneyCell minor={batch.debits_minor} currency={batch.currency} />
                </td>
                <td className="px-3 py-3 text-right text-[var(--color-onetext)]">
                  <MoneyCell minor={batch.credits_minor} currency={batch.currency} />
                </td>
                <td className="px-3 py-3 font-mono text-[var(--color-onetextsecondary)]">
                  {batch.mapping_version}
                </td>
                <td className="px-3 py-3 font-mono text-[var(--color-onetextsecondary)]">
                  <time dateTime={batch.committed_at ?? batch.created_at}>
                    {batch.committed_at ?? batch.created_at}
                  </time>
                </td>
                <td className="px-3 py-3 text-right">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={
                      readOnly || batch.status !== "committed" || rollbackStatus === "loading"
                    }
                    onClick={() => openRollback(batch.batch_id)}
                    aria-label={t("importHub.history.rollback.openAria", {
                      source: batch.source_name,
                    })}
                  >
                    <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                    {t("importHub.history.rollback.open")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {activeRollback && rollbackStatus !== "success" && (
        <div className="rounded-md border border-[var(--color-onewarning)]/50 p-4">
          <h3 className="text-sm font-semibold text-[var(--color-onetext)]">
            {t("importHub.history.rollback.title", { source: activeRollback.source_name })}
          </h3>
          <p className="mt-1 text-xs text-[var(--color-onetextsecondary)]">
            {t("importHub.history.rollback.description")}
          </p>
          <label
            htmlFor="rollback-reason"
            className="mt-3 block text-sm font-medium text-[var(--color-onetextsecondary)]"
          >
            {t("importHub.history.rollback.reason")}
          </label>
          <textarea
            id="rollback-reason"
            required
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={rollbackStatus === "loading"}
            className="mt-1.5 min-h-20 w-full rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-3 py-2 text-sm text-[var(--color-onetext)]"
          />
          {rollbackStatus === "error" && rollbackError && (
            <div className="mt-3">
              <StatePanel
                state="error"
                message={rollbackError.userMessage}
                errorCode={rollbackError.code}
                onRetry={rollbackError.retryable && reasonReady ? submitRollback : undefined}
              />
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={clearRollback} disabled={rollbackStatus === "loading"}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={submitRollback}
              disabled={!reasonReady || readOnly || rollbackStatus === "loading"}
            >
              {rollbackStatus === "loading"
                ? t("importHub.history.rollback.rollingBack")
                : t("importHub.history.rollback.confirm")}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--color-onetextmuted)]">
        <p>
          {t("importHub.history.page", {
            page: result.meta.page,
            pages: result.meta.total_pages,
            total: count.format(result.meta.total),
          })}
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={status === "loading" || result.meta.page <= 1}
            onClick={() => void load(result.meta.page - 1)}
          >
            {t("common.previous")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={status === "loading" || result.meta.page >= result.meta.total_pages}
            onClick={() => void load(result.meta.page + 1)}
          >
            {t("common.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
