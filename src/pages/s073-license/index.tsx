import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Input, StatePanel } from "@/components/ui";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";
import type { LicenseVerifyData } from "@/api/schema";
import { useSessionStore } from "@/stores/session";
import { FileUp, KeyRound, FilePlus2 } from "lucide-react";

/**
 * S-073 License & Activation (F-035, PRD; LICENSE-SPEC; SCREENS-SPEC S-073).
 * Offline Ed25519 activation: request file → licensor signs → response applied here.
 * No network dependency (B18-9): every path is local file/text.
 *
 * 5 states (Q1): loading (initial), empty (license = null → "Not activated"),
 * populated (active/grace/expired badge + details), success (just applied),
 * error (screen-level load failure or apply/verify failure, read-only note).
 */

// Mirrors package.json `version` (there is no IPC surface for the app version; keep in
// lockstep — F-036 About block is a static build value).
const APP_VERSION = "0.1.0";

type LicenseInfo = {
  status: "active" | "grace" | "expired" | "invalid";
  days_left: number;
  plan?: "pro" | "enterprise";
  expires_at?: string | null;
  license_key_id?: string;
  machine_fingerprint?: string;
};

type LoadPhase = "loading" | "ready" | "error";
type InputMode = "file" | "code";

export function LicensePage() {
  const { t } = useTranslation();
  const companyId = useSessionStore((s) => s.companyId);

  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [loadError, setLoadError] = useState<BridgeError | null>(null);

  const [mode, setMode] = useState<InputMode>("file");
  const [payload, setPayload] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<
    (LicenseVerifyData & { plan?: "pro" | "enterprise" }) | null
  >(null);
  const [applyError, setApplyError] = useState<BridgeError | null>(null);

  const [requesting, setRequesting] = useState(false);
  const [requestFile, setRequestFile] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<BridgeError | null>(null);

  const load = useCallback(async () => {
    try {
      const data = (await call("session.status", {})) as { license: LicenseInfo | null };
      setLicense(data.license ?? null);
      setPhase("ready");
    } catch (err) {
      setLoadError(err as BridgeError);
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const onFilePicked = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setApplied(null);
    setApplyError(null);
    const reader = new FileReader();
    reader.onload = () => setPayload(String(reader.result ?? ""));
    reader.onerror = () =>
      setApplyError({
        code: "IMPORT_FILE_UNREADABLE",
        userMessage: t("licensePage.fileReadError"),
        httpStatus: 422,
        retryable: false,
        retryAfterMs: null,
        details: {},
      });
    reader.readAsText(file);
  };

  const applyPayload = async () => {
    if (!payload.trim() || applying) return;
    setApplying(true);
    setApplied(null);
    setApplyError(null);
    try {
      const data = (await call("license.apply_response", {
        response_path_or_payload: payload,
      })) as LicenseVerifyData & { plan?: "pro" | "enterprise" };
      setApplied(data);
      // Re-read the live status (the core now holds the persisted license).
      await load();
    } catch (err) {
      setApplyError(err as BridgeError);
    } finally {
      setApplying(false);
    }
  };

  const generateRequest = async () => {
    if (!companyId || requesting) return;
    setRequesting(true);
    setRequestError(null);
    setRequestFile(null);
    try {
      // The request file is named after the Company file: resolve its path from the
      // active Company's row (company.list carries company_file_path).
      const companies = (await call("company.list", {})) as {
        id: string;
        company_file_path: string;
      }[];
      const path = companies.find((c) => c.id === companyId)?.company_file_path;
      if (!path) throw new Error("company path not found");
      const data = (await call("license.request_file", {
        company_path: path,
      })) as { file: string };
      setRequestFile(data.file);
    } catch (err) {
      const e = err as BridgeError;
      setRequestError(
        e && typeof e === "object" && "code" in e
          ? e
          : {
              code: "INTERNAL",
              userMessage: t("licensePage.requestError"),
              httpStatus: 500,
              retryable: false,
              retryAfterMs: null,
              details: {},
            },
      );
    } finally {
      setRequesting(false);
    }
  };

  if (phase === "loading") {
    return (
      <div role="status" aria-label={t("common.loading")} className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t("licensePage.title")}</h1>
        {[0, 1].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg bg-[var(--color-onesurfacealt)]" />
        ))}
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex min-h-full flex-col">
        <h1 className="mb-6 text-xl font-semibold">{t("licensePage.title")}</h1>
        <StatePanel
          state="error"
          message={loadError?.userMessage ?? t("licensePage.loadError")}
          errorCode={loadError?.code}
          onRetry={load}
        />
      </div>
    );
  }

  const statusTone =
    license?.status === "active"
      ? "bg-[var(--color-onefavorable)]/15 text-[var(--color-onefavorable)]"
      : license?.status === "grace"
        ? "bg-[var(--color-oneunfavorable)]/15 text-[var(--color-oneunfavorable)]"
        : "bg-[var(--color-onerror)]/15 text-[var(--color-onerror)]";
  const statusText =
    license?.status === "active"
      ? t("licensePage.statusActive")
      : license?.status === "grace"
        ? t("licensePage.statusGrace")
        : license?.status === "expired"
          ? t("licensePage.statusExpired")
          : t("licensePage.notActivated");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("licensePage.title")}</h1>
        <p className="text-sm text-[var(--color-onetextsecondary)]">{t("licensePage.subtitle")}</p>
      </div>

      {/* Status */}
      <Card title={t("licensePage.statusTitle")}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <span
              role="status"
              className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${statusTone}`}
            >
              {statusText}
            </span>
            {license?.status === "grace" && (
              <p role="alert" className="mt-2 text-sm text-[var(--color-oneunfavorable)]">
                {t("licensePage.graceCountdown", { days: license.days_left })}
              </p>
            )}
            {license?.status === "expired" && (
              <p role="alert" className="mt-2 text-sm text-[var(--color-onerror)]">
                {t("licensePage.readOnlyNote")}
              </p>
            )}
          </div>
          {applied && (
            <span role="status" className="text-sm text-[var(--color-onefavorable)]">
              {t("licensePage.applied", { status: applied.status, days: applied.days_left })}
            </span>
          )}
        </div>

        {license ? (
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--color-onetextsecondary)]">{t("licensePage.planLabel")}</dt>
              <dd className="font-medium">{license.plan ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--color-onetextsecondary)]">
                {t("licensePage.expiresLabel")}
              </dt>
              <dd className="font-medium">{license.expires_at ?? t("licensePage.perpetual")}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--color-onetextsecondary)]">
                {t("licensePage.keyIdLabel")}
              </dt>
              <dd className="truncate font-mono text-xs">{license.license_key_id ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--color-onetextsecondary)]">
                {t("licensePage.fingerprintLabel")}
              </dt>
              <dd className="truncate font-mono text-xs">{license.machine_fingerprint ?? "—"}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-4 text-sm text-[var(--color-onetextsecondary)]">
            {t("licensePage.notActivatedHint")}
          </p>
        )}
      </Card>

      {/* Activation */}
      <Card title={t("licensePage.activateTitle")}>
        <div className="mb-3 flex gap-2" role="tablist" aria-label={t("licensePage.activateTitle")}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "file"}
            onClick={() => {
              setMode("file");
              setApplyError(null);
            }}
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs ${
              mode === "file"
                ? "border-[var(--color-oneprimary)] text-[var(--color-onetext)]"
                : "border-[var(--color-oneborder)] text-[var(--color-onetextsecondary)]"
            }`}
          >
            <FileUp aria-hidden="true" className="h-3.5 w-3.5" />
            {t("licensePage.viaFile")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "code"}
            onClick={() => {
              setMode("code");
              setApplyError(null);
            }}
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs ${
              mode === "code"
                ? "border-[var(--color-oneprimary)] text-[var(--color-onetext)]"
                : "border-[var(--color-oneborder)] text-[var(--color-onetextsecondary)]"
            }`}
          >
            <KeyRound aria-hidden="true" className="h-3.5 w-3.5" />
            {t("licensePage.viaCode")}
          </button>
        </div>

        {mode === "file" ? (
          <div className="flex items-center gap-2">
            <Input
              type="file"
              accept=".json,.lic,.txt"
              aria-label={t("licensePage.fileBrowse")}
              onChange={(e) => onFilePicked(e.target.files?.[0])}
              className="text-xs"
            />
            {fileName && (
              <span className="truncate text-xs text-[var(--color-onetextsecondary)]">
                {fileName}
              </span>
            )}
          </div>
        ) : (
          <div>
            <textarea
              data-testid="license-payload"
              aria-label={t("licensePage.pastePayload")}
              value={payload}
              onChange={(e) => {
                setPayload(e.target.value);
                setApplyError(null);
              }}
              rows={5}
              placeholder={t("licensePage.payloadHint")}
              className="w-full rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-2 font-mono text-xs text-[var(--color-onetext)]"
            />
          </div>
        )}

        <div className="mt-3 flex items-center gap-3">
          <Button onClick={() => void applyPayload()} disabled={!payload.trim() || applying}>
            {t("licensePage.apply")}
          </Button>
          {applyError && (
            <p role="alert" className="text-xs text-[var(--color-onerror)]">
              <span className="font-mono">{applyError.code}</span> · {applyError.userMessage}
            </p>
          )}
        </div>
      </Card>

      {/* Request file */}
      <Card title={t("licensePage.requestTitle")}>
        <p className="text-sm text-[var(--color-onetextsecondary)]">
          {t("licensePage.requestHint")}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void generateRequest()}
            disabled={requesting || !companyId}
          >
            <FilePlus2 aria-hidden="true" className="h-3.5 w-3.5" />
            {t("licensePage.requestGenerate")}
          </Button>
          {requestFile && (
            <code className="rounded bg-[var(--color-onesurfacealt)] px-2 py-1 text-xs">
              {requestFile}
            </code>
          )}
          {requestError && (
            <p role="alert" className="text-xs text-[var(--color-onerror)]">
              <span className="font-mono">{requestError.code}</span> · {requestError.userMessage}
            </p>
          )}
        </div>
      </Card>

      {/* About / version (F-035 element; F-036 block lands with the updater) */}
      <Card title={t("licensePage.about")}>
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--color-onetextsecondary)]">{t("licensePage.version")}</span>
          <span className="font-mono text-xs">OneFP&amp;A {APP_VERSION}</span>
        </div>
        <p className="mt-2 text-xs text-[var(--color-onetextsecondary)]">
          {t("licensePage.offlineNote")}
        </p>
      </Card>
    </div>
  );
}
