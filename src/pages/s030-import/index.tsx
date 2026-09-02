import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  FolderOpen,
  HardDrive,
  Loader2,
  Network,
  PlugZap,
  RotateCcw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { isTauriRuntime } from "@/api/mock";
import type { ImportKind, ImportParseData } from "@/api/schema";
import { Button, Card, StatePanel } from "@/components/ui";
import { useImportStore } from "@/stores/import";
import { useSessionStore } from "@/stores/session";
import { useSettingsStore } from "@/stores/settings";
import { ImportHistoryPanel } from "./ImportHistoryPanel";

const ACCEPTED_EXTENSIONS = ["xlsx", "xlsm", "xlsb", "xls", "ods", "csv", "tsv", "txt"];

const SOURCE_TABS: { kind: ImportKind; key: "gl" | "files" }[] = [
  { kind: "gl_dump", key: "gl" },
  { kind: "excel_csv", key: "files" },
];

function AvailabilityRow({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof Archive;
  title: string;
  detail: string;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex gap-3 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-3">
      <Icon
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-onetextmuted)]"
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--color-onetext)]">{title}</p>
        <p className="mt-1 text-xs text-[var(--color-onetextsecondary)]">{detail}</p>
        <span className="mt-2 inline-flex rounded-full border border-[var(--color-oneborder)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-onetextmuted)]">
          {t("importHub.unavailable")}
        </span>
      </div>
    </li>
  );
}

function ParsedSummary({ data }: { data: ImportParseData }) {
  const { t } = useTranslation();
  const locale = useSettingsStore((s) => s.preferences.locale);
  const count = new Intl.NumberFormat(locale);
  const latin1Detected = data.encodings.some(
    (encoding) => encoding.encoding.toLowerCase() === "latin-1" && encoding.auto_detected,
  );

  return (
    <div className="w-full text-left">
      <div
        role="status"
        aria-label={t("importHub.success.aria")}
        className="mb-4 flex items-start gap-3 rounded-md border border-[var(--color-onefavorable)]/40 bg-[var(--color-onefavorable)]/5 p-3"
      >
        <CheckCircle2
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-onefavorable)]"
        />
        <div>
          <p className="text-sm font-semibold text-[var(--color-onetext)]">
            {t("importHub.success.title")}
          </p>
          <p className="text-xs text-[var(--color-onetextsecondary)]">
            {t("importHub.success.notCommitted")}
          </p>
        </div>
      </div>

      {latin1Detected && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-[var(--color-onewarning)] bg-[var(--color-onewarning)]/5 p-3 text-xs text-[var(--color-onetext)]"
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-onewarning)]"
          />
          {t("importHub.success.latin1")}
        </div>
      )}

      <dl className="grid gap-3 rounded-md bg-[var(--color-onesurfacealt)] p-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-[var(--color-onetextmuted)]">{t("importHub.summary.file")}</dt>
          <dd className="mt-1 break-all font-medium text-[var(--color-onetext)]">
            {data.source_name}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-onetextmuted)]">{t("importHub.summary.size")}</dt>
          <dd className="mt-1 font-medium text-[var(--color-onetext)]">
            {count.format(data.size_bytes)} {t("importHub.summary.bytes")}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--color-onetextmuted)]">{t("importHub.summary.hash")}</dt>
          <dd className="mt-1 break-all font-mono text-[11px] text-[var(--color-onetext)]">
            {data.source_hash}
          </dd>
        </div>
      </dl>

      <div className="mt-4 overflow-x-auto rounded-md border border-[var(--color-oneborder)]">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{t("importHub.summary.sheets")}</caption>
          <thead className="bg-[var(--color-onesurfacealt)] text-[var(--color-onetextsecondary)]">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("importHub.summary.sheet")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("importHub.summary.kind")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("importHub.summary.rows")}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.sheets.map((sheet) => (
              <tr key={sheet.name} className="border-t border-[var(--color-oneborder)]">
                <td className="px-3 py-2 font-medium text-[var(--color-onetext)]">{sheet.name}</td>
                <td className="px-3 py-2 text-[var(--color-onetextsecondary)]">{sheet.kind}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--color-onetext)]">
                  {count.format(sheet.row_count)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-onetextsecondary)]">
          {t("importHub.summary.encoding")}
        </h3>
        <ul className="mt-2 flex flex-wrap gap-2">
          {data.encodings.map((encoding) => (
            <li
              key={`${encoding.scope}-${encoding.encoding}`}
              className="rounded-full border border-[var(--color-oneborder)] px-2 py-1 text-xs text-[var(--color-onetext)]"
            >
              {encoding.scope}: {encoding.encoding}
              {encoding.bom ? ` · ${t("importHub.summary.bom")}` : ""}
              {encoding.auto_detected ? ` · ${t("importHub.summary.detected")}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** S-030 Import Hub — manual-import entry and real `import.parse` working-set hand-off. */
export function ImportHubPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const companyId = useSessionStore((s) => s.companyId);
  const readOnly = useSessionStore((s) => s.readOnly);
  const status = useImportStore((s) => s.status);
  const error = useImportStore((s) => s.error);
  const kind = useImportStore((s) => s.kind);
  const filePath = useImportStore((s) => s.filePath);
  const parsed = useImportStore((s) => s.parsed);
  const scopeToCompany = useImportStore((s) => s.scopeToCompany);
  const setKind = useImportStore((s) => s.setKind);
  const selectFile = useImportStore((s) => s.selectFile);
  const parse = useImportStore((s) => s.parse);
  const retry = useImportStore((s) => s.retry);
  const reportError = useImportStore((s) => s.reportError);
  const reset = useImportStore((s) => s.reset);
  const browserInput = useRef<HTMLInputElement>(null);
  const [dropActive, setDropActive] = useState(false);
  const [nativeDropReady, setNativeDropReady] = useState(true);
  const tauriRuntime = isTauriRuntime();
  const browserPreview = import.meta.env.DEV && !tauriRuntime;
  const fileSelectionReady = tauriRuntime || browserPreview;
  const busy = status === "loading";

  // Reset a prior Company's ephemeral parse before paint; source metadata never flashes across
  // Company switches while the ordinary effect queue catches up.
  useLayoutEffect(() => {
    scopeToCompany(companyId);
  }, [companyId, scopeToCompany]);

  useEffect(() => {
    if (!tauriRuntime) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDropActive(true);
          return;
        }
        setDropActive(false);
        if (
          event.payload.type === "drop" &&
          event.payload.paths[0] &&
          useImportStore.getState().status !== "loading"
        ) {
          selectFile(event.payload.paths[0]);
        }
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {
        if (!disposed) setNativeDropReady(false);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [selectFile, tauriRuntime]);

  const openPicker = useCallback(async () => {
    if (browserPreview) {
      browserInput.current?.click();
      return;
    }
    if (!tauriRuntime) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const chosen = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: t("importHub.picker.filterName"),
            extensions: ACCEPTED_EXTENSIONS,
          },
        ],
      });
      if (chosen) selectFile(chosen);
    } catch (cause) {
      reportError(cause);
    }
  }, [browserPreview, reportError, selectFile, t, tauriRuntime]);

  function onBrowserFile(file: File | undefined) {
    if (!file) return;
    // Browser mode exists only for the explicitly dev-only mock core. Tauri supplies the absolute
    // path via dialog/drag events; the product path never tries to turn browser bytes into a path.
    selectFile(file.name);
  }

  function renderWorkingState() {
    if (!companyId) {
      return (
        <StatePanel state="empty" message={t("importHub.noCompany")}>
          <p className="text-xs text-[var(--color-onetextmuted)]">{t("importHub.noCompanyHint")}</p>
        </StatePanel>
      );
    }

    if (status === "loading") {
      return (
        <div role="status" aria-label={t("importHub.loading")} className="p-8 text-center">
          <Loader2
            aria-hidden="true"
            className="mx-auto h-8 w-8 animate-spin text-[var(--color-oneprimary)]"
          />
          <p className="mt-3 text-sm font-medium text-[var(--color-onetext)]">
            {t("importHub.loading")}
          </p>
          <p className="mt-1 break-all text-xs text-[var(--color-onetextsecondary)]">{filePath}</p>
        </div>
      );
    }

    if (status === "error") {
      return (
        <StatePanel
          state="error"
          message={error?.userMessage ?? t("importHub.error.fallback")}
          errorCode={error?.code ?? "INTERNAL"}
          onRetry={error?.retryable && filePath ? () => void retry() : undefined}
        >
          <Button variant="secondary" size="sm" onClick={() => void openPicker()}>
            <FolderOpen aria-hidden="true" className="h-4 w-4" />
            {t("importHub.chooseAnother")}
          </Button>
        </StatePanel>
      );
    }

    if (status === "success" && parsed) {
      return (
        <div className="p-4">
          <ParsedSummary data={parsed} />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={reset}>
              <RotateCcw aria-hidden="true" className="h-4 w-4" />
              {t("importHub.parseAnother")}
            </Button>
            <Button onClick={() => navigate("/app/import/map")}>
              {t("importHub.continueMapping")}
            </Button>
          </div>
          <p className="mt-2 text-right text-xs text-[var(--color-onetextmuted)]">
            {t("importHub.mappingHint")}
          </p>
        </div>
      );
    }

    return (
      <div className="p-4">
        <div
          onDragEnter={() => setDropActive(true)}
          onDragOver={(event) => {
            event.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDropActive(false);
            if (browserPreview) onBrowserFile(event.dataTransfer.files[0]);
          }}
          className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
            dropActive
              ? "border-[var(--color-oneprimary)] bg-[var(--color-oneprimary)]/5"
              : "border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)]"
          }`}
        >
          <Upload aria-hidden="true" className="mx-auto h-8 w-8 text-[var(--color-onetextmuted)]" />
          <p className="mt-3 text-sm font-semibold text-[var(--color-onetext)]">
            {filePath ? t("importHub.selected") : t("importHub.drop.title")}
          </p>
          {filePath ? (
            <p className="mt-1 break-all text-xs text-[var(--color-onetextsecondary)]">
              {filePath}
            </p>
          ) : (
            <p className="mt-1 text-xs text-[var(--color-onetextsecondary)]">
              {t("importHub.drop.body")}
            </p>
          )}
          <Button
            variant="secondary"
            className="mt-4"
            disabled={busy || !fileSelectionReady}
            onClick={() => void openPicker()}
          >
            <FolderOpen aria-hidden="true" className="h-4 w-4" />
            {filePath ? t("importHub.changeFile") : t("importHub.chooseFile")}
          </Button>
          {!fileSelectionReady && (
            <p className="mt-2 text-xs text-[var(--color-onewarning)]">
              {t("importHub.picker.desktopOnly")}
            </p>
          )}
          {!nativeDropReady && (
            <p className="mt-2 text-xs text-[var(--color-onewarning)]">
              {t("importHub.drop.unavailable")}
            </p>
          )}
        </div>

        {browserPreview && (
          <input
            ref={browserInput}
            type="file"
            accept={ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(",")}
            aria-label={t("importHub.browserFile")}
            className="sr-only"
            onChange={(event) => {
              onBrowserFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-[var(--color-onetextmuted)]">{t("importHub.zipGate")}</p>
          <Button disabled={!filePath || busy} onClick={() => void parse()}>
            <FileSpreadsheet aria-hidden="true" className="h-4 w-4" />
            {t("importHub.parse")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <main
      data-screen-state={companyId ? status : "empty"}
      className="mx-auto flex w-full max-w-6xl flex-col gap-5"
    >
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-onetext)]">
          {t("importHub.title")}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-onetextsecondary)]">
          {t("importHub.subtitle")}
        </p>
      </div>

      <Card title={t("importHub.source.title")}>
        <div
          role="tablist"
          aria-label={t("importHub.source.aria")}
          className="flex flex-wrap gap-2"
        >
          {SOURCE_TABS.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              role="tab"
              aria-selected={kind === tab.kind}
              disabled={busy}
              onClick={() => setKind(tab.kind)}
              className={`rounded-md border px-3 py-2 text-sm font-medium ${
                kind === tab.kind
                  ? "border-[var(--color-oneprimary)] bg-[var(--color-oneprimary)] text-white"
                  : "border-[var(--color-oneborder)] text-[var(--color-onetextsecondary)]"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {t(`importHub.source.${tab.key}`)}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected="false"
            aria-describedby="connectors-gate"
            disabled
            className="rounded-md border border-[var(--color-oneborder)] px-3 py-2 text-sm font-medium text-[var(--color-onetextmuted)] opacity-60"
          >
            {t("importHub.source.connectors")}
          </button>
        </div>
        <p id="connectors-gate" className="mt-2 text-xs text-[var(--color-onetextmuted)]">
          {t("importHub.source.connectorsGate")}
        </p>
      </Card>

      <Card title={t("importHub.workingSet")}>{renderWorkingState()}</Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t("importHub.mappings.title")} className="lg:col-span-2">
          <div className="flex items-start gap-3 rounded-md border border-[var(--color-oneborder)] p-3">
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-onefavorable)]"
            />
            <div>
              <p className="text-sm font-medium text-[var(--color-onetext)]">
                {t("importHub.mappings.canonical")}
              </p>
              <p className="mt-1 text-xs text-[var(--color-onetextsecondary)]">
                {t("importHub.mappings.canonicalHint")}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-[var(--color-onetextmuted)]">
            {t("importHub.mappings.savedGate")}
          </p>
        </Card>

        <Card title={t("importHub.history.title")} className="lg:col-span-2">
          <ImportHistoryPanel companyId={companyId} readOnly={readOnly} />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t("importHub.connectors.title")}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {["QuickBooks Online", "Xero", "NetSuite", "Sage"].map((provider) => (
              <li
                key={provider}
                className="flex items-center gap-2 rounded-md border border-[var(--color-oneborder)] p-3 text-sm text-[var(--color-onetextsecondary)]"
              >
                <PlugZap aria-hidden="true" className="h-4 w-4 text-[var(--color-onetextmuted)]" />
                <span>{provider}</span>
                <span className="ml-auto text-[10px] uppercase text-[var(--color-onetextmuted)]">
                  {t("importHub.unavailable")}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[var(--color-onetextmuted)]">
            {t("importHub.connectors.gate")}
          </p>
        </Card>

        <Card title={t("importHub.tools.title")}>
          <ul className="space-y-2">
            <AvailabilityRow
              icon={Archive}
              title={t("importHub.tools.vault")}
              detail={t("importHub.tools.vaultGate")}
            />
            <AvailabilityRow
              icon={Network}
              title={t("importHub.tools.reconciliation")}
              detail={t("importHub.tools.reconciliationGate")}
            />
            <AvailabilityRow
              icon={HardDrive}
              title={t("importHub.tools.progress")}
              detail={t("importHub.tools.progressGate")}
            />
          </ul>
        </Card>
      </div>

      <p className="flex items-start gap-2 text-xs text-[var(--color-onetextmuted)]">
        <Database aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        {t("importHub.localOnly")}
      </p>
    </main>
  );
}
