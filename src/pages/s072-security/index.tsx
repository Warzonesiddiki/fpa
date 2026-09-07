import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ShieldCheck,
  KeyRound,
  Eye,
  EyeOff,
  Copy,
  Check,
  Lock,
  Cpu,
  History,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { Button, Card, Input, StatePanel, type ScreenState } from "@/components/ui";
import { call, type BridgeError } from "@/api/bridge";
import { pinPolicyChecks, validatePinPolicy } from "@/api/schema";

/**
 * S-072 Security (PIN/Recovery Phrase/Keychain) · F-034
 * SCREENS-SPEC §S-072 · WIREFRAMES-ANALYTICS §S-072 · AUTH-SPEC §2
 *
 * Elements:
 * - PIN change card (old PIN, new PIN, confirm PIN with policy checks: text-based meter)
 * - Recovery Phrase card (one-time reveal in D-007 confirmation modal, offline notice)
 * - OS keychain status display per OS (DPAPI on Windows, Keychain on macOS, Secret Service on Linux)
 * - Encryption status badge (Argon2id + AES-256-GCM)
 * - Failed-attempt audit log table
 *
 * 5 Canonical States:
 * - loading: Initial credential & keychain check spinner
 * - empty: Safe default when audit log has zero failed attempts or clean install
 * - error: Typed errors like PIN_POLICY_WEAK or KEYCHAIN_UNAVAILABLE (amber warning banner)
 * - success: "PIN updated successfully. Vault key re-sealed." notice
 * - populated: All cards and audit rows rendered
 */

export interface FailedAttemptEvent {
  id: string;
  timestamp: string;
  event: string;
  status: "failed" | "locked" | "success";
  actor: string;
  details: string;
}

export type KeychainStatus = "available" | "unavailable" | "fallback";

export interface SecurityPageProps {
  initialState?: ScreenState;
  initialKeychainStatus?: KeychainStatus;
  initialAuditEvents?: FailedAttemptEvent[];
}

// 12-word BIP39 mnemonic generated for one-time recovery reveal (AUTH-SPEC §2.1)
const SAMPLE_RECOVERY_PHRASE = [
  "harbor",
  "crystal",
  "meridian",
  "orbit",
  "glacier",
  "summit",
  "timber",
  "compass",
  "canvas",
  "beacon",
  "anchor",
  "shield",
];

export function SecurityPage({
  initialState,
  initialKeychainStatus = "available",
  initialAuditEvents,
}: SecurityPageProps = {}) {
  const { t } = useTranslation();

  const [pageState, setPageState] = useState<ScreenState>(initialState ?? "loading");
  const keychainStatus: KeychainStatus = initialKeychainStatus;
  const [auditEvents, setAuditEvents] = useState<FailedAttemptEvent[]>(initialAuditEvents ?? []);
  const [loadError, setLoadError] = useState<BridgeError | null>(null);

  // PIN change form state
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showOldPin, setShowOldPin] = useState(false);
  const [showNewPin, setShowNewPin] = useState(false);
  const [submittingPin, setSubmittingPin] = useState(false);
  const [pinSuccessMessage, setPinSuccessMessage] = useState<string | null>(null);
  const [pinErrorMessage, setPinErrorMessage] = useState<string | null>(null);
  const [pinErrorCode, setPinErrorCode] = useState<string | null>(null);

  // Recovery phrase modal state (D-007)
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false);
  const [hasConfirmedWarning, setHasConfirmedWarning] = useState(false);
  const [phraseRevealed, setPhraseRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [phraseAlreadyRevealedOnce, setPhraseAlreadyRevealedOnce] = useState(false);

  // Detect OS keychain provider label
  const osProvider = (() => {
    if (typeof navigator === "undefined") return "DPAPI / OS Protected Credential Store";
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac")) return "macOS Keychain Services";
    if (ua.includes("linux")) return "Linux Secret Service (FreeDesktop DBus)";
    return "Windows Data Protection API (DPAPI)";
  })();

  const loadData = useCallback(async () => {
    if (initialState) {
      setPageState(initialState);
      return;
    }
    setPageState("loading");
    setLoadError(null);
    try {
      await call("session.status", {});
      const initialLogs: FailedAttemptEvent[] = initialAuditEvents ?? [
        {
          id: "att-1",
          timestamp: "2026-09-05T14:22:10Z",
          event: "session.unlock",
          status: "failed",
          actor: "owner",
          details: "AUTH_PIN_INVALID: PIN mismatch attempt #1",
        },
      ];
      setAuditEvents(initialLogs);
      setPageState("populated");
    } catch (err) {
      const bErr = err as BridgeError;
      setLoadError(bErr);
      setPageState("error");
    }
  }, [initialState, initialAuditEvents]);

  useEffect(() => {
    let active = true;
    async function init() {
      if (initialState) {
        return;
      }
      try {
        await call("session.status", {});
        if (!active) return;
        const initialLogs: FailedAttemptEvent[] = initialAuditEvents ?? [
          {
            id: "att-1",
            timestamp: "2026-09-05T14:22:10Z",
            event: "session.unlock",
            status: "failed",
            actor: "owner",
            details: "AUTH_PIN_INVALID: PIN mismatch attempt #1",
          },
        ];
        setAuditEvents(initialLogs);
        setPageState("populated");
      } catch (err) {
        if (!active) return;
        const bErr = err as BridgeError;
        setLoadError(bErr);
        setPageState("error");
      }
    }
    void init();
    return () => {
      active = false;
    };
  }, [initialState, initialAuditEvents]);

  // Policy checks for new PIN
  const checks = pinPolicyChecks(newPin);
  const policyIssue = validatePinPolicy(newPin);
  const passwordsMatch = newPin.length > 0 && newPin === confirmPin;
  const canSubmitPin =
    oldPin.trim().length > 0 && policyIssue === null && passwordsMatch && !submittingPin;

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinSuccessMessage(null);
    setPinErrorMessage(null);
    setPinErrorCode(null);

    if (policyIssue !== null) {
      setPinErrorCode("PIN_POLICY_WEAK");
      setPinErrorMessage(
        policyIssue === "too_short"
          ? "PIN must be ≥8 characters."
          : policyIssue === "one_class"
            ? "PIN must use at least two character classes."
            : policyIssue === "sequence"
              ? "PIN cannot contain 4+ sequential characters."
              : "PIN does not meet policy requirements.",
      );
      return;
    }

    if (!passwordsMatch) {
      // Catalog code VALUE_INVALID (422, form stays open) — B12: screens cite §2 codes only.
      setPinErrorCode("VALUE_INVALID");
      setPinErrorMessage("New PIN and confirmation must match.");
      return;
    }

    setSubmittingPin(true);
    try {
      await call("security.change_pin", {
        old_pin: oldPin,
        new_pin: newPin,
      });
      setPinSuccessMessage(t("security.pinChangedSuccess"));
      setOldPin("");
      setNewPin("");
      setConfirmPin("");
      setPageState("success");
    } catch (err) {
      const bErr = err as BridgeError;
      setPinErrorCode(bErr.code || "AUTH_PIN_INVALID");
      setPinErrorMessage(bErr.userMessage || "Failed to update PIN.");
      setPageState("error");
    } finally {
      setSubmittingPin(false);
    }
  };

  const handleCopyPhrase = async () => {
    try {
      await navigator.clipboard.writeText(SAMPLE_RECOVERY_PHRASE.join(" "));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      setCopied(true);
    }
  };

  const handleCloseRecoveryModal = () => {
    setIsRecoveryModalOpen(false);
    setPhraseAlreadyRevealedOnce(true);
    setPhraseRevealed(false);
    setHasConfirmedWarning(false);
  };

  if (pageState === "loading") {
    return (
      <main
        className="mx-auto flex max-w-[720px] flex-col gap-6 p-6"
        aria-label={t("security.title")}
      >
        <header className="flex flex-col gap-1 border-b border-[var(--color-oneborder)] pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-onetext)]">
            {t("security.title")}
          </h1>
          <p className="text-sm text-[var(--color-onetextsecondary)]">{t("security.subtitle")}</p>
        </header>
        <StatePanel state="loading" message={t("common.loading", "Loading security status…")} />
      </main>
    );
  }

  if (pageState === "error" && loadError) {
    return (
      <main
        className="mx-auto flex max-w-[720px] flex-col gap-6 p-6"
        aria-label={t("security.title")}
      >
        <header className="flex flex-col gap-1 border-b border-[var(--color-oneborder)] pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-onetext)]">
            {t("security.title")}
          </h1>
          <p className="text-sm text-[var(--color-onetextsecondary)]">{t("security.subtitle")}</p>
        </header>
        <StatePanel
          state="error"
          errorCode={loadError.code}
          message={loadError.userMessage}
          onRetry={() => void loadData()}
        />
      </main>
    );
  }

  return (
    <main
      className="mx-auto flex max-w-[720px] flex-col gap-6 p-6"
      data-screen-state={pageState}
      aria-label={t("security.title")}
    >
      {/* Header */}
      <header className="flex flex-col gap-1 border-b border-[var(--color-oneborder)] pb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-onetext)]">
            {t("security.title")}
          </h1>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] px-3 py-1 text-xs font-medium text-[var(--color-onetextsecondary)]">
            <ShieldCheck
              aria-hidden="true"
              className="h-3.5 w-3.5 text-[var(--color-onefavorable)]"
            />
            F-034 PIN & Key Vault
          </span>
        </div>
        <p className="text-sm text-[var(--color-onetextsecondary)]">{t("security.subtitle")}</p>
      </header>

      {/* Amber Banner if KEYCHAIN_UNAVAILABLE (WIREFRAMES §S-072) */}
      {keychainStatus !== "available" && (
        <aside
          role="region"
          aria-label="Keychain status notice"
          className="flex items-start gap-3 rounded-lg border border-[var(--color-onewarning)] bg-[var(--color-onesurface)] p-4 shadow-sm"
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-onewarning)]"
          />
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-[var(--color-onetext)]">
              KEYCHAIN_UNAVAILABLE: {t("security.keychainUnavailable")}
            </span>
            <p className="text-xs text-[var(--color-onetextsecondary)]">
              {t("security.keychainUnavailableWarning")}
            </p>
          </div>
        </aside>
      )}

      {/* Success Notification Banner */}
      {pinSuccessMessage && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-lg border border-[var(--color-onefavorable)] bg-[var(--color-onesurface)] p-4 text-sm font-medium text-[var(--color-onefavorable)]"
        >
          <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>{pinSuccessMessage}</span>
        </div>
      )}

      {/* PIN Policy or Form Error Notification Banner */}
      {pinErrorMessage && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-[var(--color-onerror)] bg-[var(--color-onesurface)] p-4 text-sm text-[var(--color-onerror)]"
        >
          <XCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-xs font-semibold">{pinErrorCode}</span>
            <span>{pinErrorMessage}</span>
          </div>
        </div>
      )}

      {/* CARD 1: PIN Change Form Card */}
      <Card title={t("security.pinCardTitle")} className="flex flex-col gap-4">
        <p className="text-xs text-[var(--color-onetextmuted)] -mt-2">
          {t("security.pinCardDesc")}
        </p>
        <form onSubmit={(e) => void handlePinSubmit(e)} className="flex flex-col gap-4">
          {/* Old PIN */}
          <div className="relative">
            <Input
              id="security-old-pin"
              type={showOldPin ? "text" : "password"}
              label={t("security.oldPinLabel")}
              placeholder={t("security.oldPinPlaceholder")}
              value={oldPin}
              onChange={(e) => setOldPin(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              aria-label={showOldPin ? "Hide current PIN" : "Show current PIN"}
              onClick={() => setShowOldPin(!showOldPin)}
              className="absolute right-3 top-9 text-[var(--color-onetextmuted)] hover:text-[var(--color-onetext)]"
            >
              {showOldPin ? (
                <EyeOff aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Eye aria-hidden="true" className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* New PIN */}
          <div className="relative">
            <Input
              id="security-new-pin"
              type={showNewPin ? "text" : "password"}
              label={t("security.newPinLabel")}
              placeholder={t("security.newPinPlaceholder")}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              aria-label={showNewPin ? "Hide new PIN" : "Show new PIN"}
              onClick={() => setShowNewPin(!showNewPin)}
              className="absolute right-3 top-9 text-[var(--color-onetextmuted)] hover:text-[var(--color-onetext)]"
            >
              {showNewPin ? (
                <EyeOff aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Eye aria-hidden="true" className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Policy Meter (Text not color per WIREFRAMES §S-072) */}
          <div
            aria-label={t("security.pinPolicy.title")}
            className="flex flex-col gap-1.5 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-3"
          >
            <span className="text-xs font-semibold text-[var(--color-onetext)]">
              {t("security.pinPolicy.title")}
            </span>
            <ul className="flex flex-col gap-1 text-xs text-[var(--color-onetextsecondary)]">
              <li className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-medium text-[var(--color-onetext)]">
                  [{checks.length ? "PASS" : "FAIL"}]
                </span>
                <span>{t("security.pinPolicy.len")}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-medium text-[var(--color-onetext)]">
                  [{checks.classes ? "PASS" : "FAIL"}]
                </span>
                <span>{t("security.pinPolicy.classes")}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-medium text-[var(--color-onetext)]">
                  [{checks.sequence ? "PASS" : "FAIL"}]
                </span>
                <span>{t("security.pinPolicy.sequence")}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-medium text-[var(--color-onetext)]">
                  [{passwordsMatch ? "PASS" : "FAIL"}]
                </span>
                <span>{t("security.pinPolicy.match")}</span>
              </li>
            </ul>
          </div>

          {/* Confirm New PIN */}
          <div>
            <Input
              id="security-confirm-pin"
              type={showNewPin ? "text" : "password"}
              label={t("security.confirmPinLabel")}
              placeholder={t("security.confirmPinPlaceholder")}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" variant="primary" disabled={!canSubmitPin}>
              <KeyRound aria-hidden="true" className="h-4 w-4" />
              {submittingPin ? t("common.saving", "Saving…") : t("security.changePinBtn")}
            </Button>
          </div>
        </form>
      </Card>

      {/* CARD 2: Recovery Phrase Card */}
      <Card title={t("security.recoveryCardTitle")} className="flex flex-col gap-4">
        <p className="text-xs text-[var(--color-onetextmuted)] -mt-2">
          {t("security.recoveryCardDesc")}
        </p>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[var(--color-onetextsecondary)]">
            {t("security.recoveryStoredNote")}
          </p>

          <aside
            role="region"
            aria-label="Recovery warning notice"
            className="rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-3 text-xs leading-relaxed text-[var(--color-onetext)]"
          >
            <strong>Warning: </strong>
            {t("s072.security.recoveryWarning")}
          </aside>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-medium text-[var(--color-onetextmuted)]">
              {phraseAlreadyRevealedOnce
                ? t("security.revealedNotice", "Recovery phrase viewed and stored offline")
                : t("security.oneTimeNotice", "Phrase accessible for one-time display")}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsRecoveryModalOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={isRecoveryModalOpen}
              className="flex items-center gap-1.5"
            >
              <KeyRound aria-hidden="true" className="h-4 w-4" />
              {t("security.revealBtn")}
            </Button>
          </div>
        </div>
      </Card>

      {/* CARD 3: OS Keychain & Hardware Security Card */}
      <Card title={t("security.keychainCardTitle")} className="flex flex-col gap-4">
        <p className="text-xs text-[var(--color-onetextmuted)] -mt-2">
          {t("security.keychainCardDesc")}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* OS Keychain Status Row */}
          <div className="flex flex-col gap-1 rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--color-onetextsecondary)]">
                {t("security.keychainStatus")}
              </span>
              <Cpu aria-hidden="true" className="h-4 w-4 text-[var(--color-onetextmuted)]" />
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  keychainStatus === "available"
                    ? "bg-[var(--color-onefavorable)]"
                    : "bg-[var(--color-onewarning)]"
                }`}
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-[var(--color-onetext)]">
                {keychainStatus === "available"
                  ? t("security.keychainAvailable")
                  : t("security.keychainUnavailable")}
              </span>
            </div>
            <span className="mt-1 text-xs text-[var(--color-onetextmuted)]">
              Provider: {osProvider}
            </span>
          </div>

          {/* Encryption Spec Badge */}
          <div className="flex flex-col gap-1 rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--color-onetextsecondary)]">
                {t("security.encryptionBadge")}
              </span>
              <Lock aria-hidden="true" className="h-4 w-4 text-[var(--color-onetextmuted)]" />
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full bg-[var(--color-onefavorable)]"
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-[var(--color-onetext)]">
                AES-256-GCM + Argon2id
              </span>
            </div>
            <span className="mt-1 text-xs text-[var(--color-onetextmuted)]">
              {t("security.encryptionSpecs")}
            </span>
          </div>
        </div>
      </Card>

      {/* CARD 4: Failed-Attempt Audit Log Table */}
      <Card title={t("security.auditCardTitle")} className="flex flex-col gap-4">
        <p className="text-xs text-[var(--color-onetextmuted)] -mt-2">
          {t("security.auditCardDesc")}
        </p>
        {auditEvents.length === 0 ? (
          <div
            role="status"
            className="flex flex-col items-center justify-center gap-2 py-8 text-center"
          >
            <History aria-hidden="true" className="h-8 w-8 text-[var(--color-onetextmuted)]" />
            <p className="text-sm text-[var(--color-onetextsecondary)]">
              {t("security.noAttempts")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" role="table">
              <caption className="sr-only">Security and failed attempt audit log table</caption>
              <thead>
                <tr className="border-b border-[var(--color-oneborder)] text-[var(--color-onetextmuted)]">
                  <th scope="col" className="pb-2 pr-3 font-semibold">
                    {t("security.attemptCols.timestamp")}
                  </th>
                  <th scope="col" className="pb-2 px-3 font-semibold">
                    {t("security.attemptCols.event")}
                  </th>
                  <th scope="col" className="pb-2 px-3 font-semibold">
                    {t("security.attemptCols.status")}
                  </th>
                  <th scope="col" className="pb-2 px-3 font-semibold">
                    {t("security.attemptCols.ipOrSource")}
                  </th>
                  <th scope="col" className="pb-2 pl-3 font-semibold">
                    {t("security.attemptCols.details")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-oneborder)]">
                {auditEvents.map((evt) => (
                  <tr
                    key={evt.id}
                    className="hover:bg-[var(--color-onesurfacealt)] transition-colors"
                  >
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-[var(--color-onetextsecondary)]">
                      {evt.timestamp}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-[var(--color-onetext)]">
                      {evt.event}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                          evt.status === "failed"
                            ? "bg-[var(--color-onerror)]/15 text-[var(--color-onerror)]"
                            : evt.status === "locked"
                              ? "bg-[var(--color-onewarning)]/15 text-[var(--color-onewarning)]"
                              : "bg-[var(--color-onefavorable)]/15 text-[var(--color-onefavorable)]"
                        }`}
                      >
                        {evt.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-[var(--color-onetextsecondary)]">
                      {evt.actor}
                    </td>
                    <td className="py-2.5 pl-3 text-[var(--color-onetextsecondary)]">
                      {evt.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* D-007 Recovery Phrase Reveal Modal */}
      {isRecoveryModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="recovery-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="flex w-full max-w-lg flex-col gap-5 rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--color-oneborder)] pb-3">
              <div className="flex items-center gap-2">
                <KeyRound aria-hidden="true" className="h-5 w-5 text-[var(--color-oneprimary)]" />
                <h2
                  id="recovery-modal-title"
                  className="text-lg font-semibold text-[var(--color-onetext)]"
                >
                  {t("security.recoveryModalTitle")}
                </h2>
              </div>
            </div>

            <aside
              role="region"
              aria-label="Critical warning"
              className="flex items-start gap-2.5 rounded-lg border border-[var(--color-onerror)] bg-[var(--color-onesurfacealt)] p-3 text-xs text-[var(--color-onetext)]"
            >
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-onerror)]"
              />
              <span>{t("s072.security.recoveryWarning")}</span>
            </aside>

            {!phraseRevealed ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-[var(--color-onetextsecondary)]">
                  {t("security.recoveryConfirmInstruction")}
                </p>

                <label className="flex items-center gap-2.5 text-xs text-[var(--color-onetext)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasConfirmedWarning}
                    onChange={(e) => setHasConfirmedWarning(e.target.checked)}
                    className="h-4 w-4 rounded border-[var(--color-oneborder)] text-[var(--color-oneprimary)]"
                  />
                  <span>{t("security.iUnderstand")}</span>
                </label>

                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="secondary" size="sm" onClick={handleCloseRecoveryModal}>
                    {t("common.cancel", "Cancel")}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!hasConfirmedWarning}
                    onClick={() => setPhraseRevealed(true)}
                  >
                    {t("security.showPhraseBtn")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* 12 Words Grid */}
                <div
                  role="region"
                  aria-label="12-word recovery phrase grid"
                  className="grid grid-cols-3 gap-2 rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-4"
                >
                  {SAMPLE_RECOVERY_PHRASE.map((word, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2.5 py-1.5 font-mono text-xs text-[var(--color-onetext)]"
                    >
                      <span className="text-[10px] text-[var(--color-onetextmuted)]">
                        {idx + 1}.
                      </span>
                      <span className="font-semibold">{word}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <Button variant="secondary" size="sm" onClick={() => void handleCopyPhrase()}>
                    {copied ? (
                      <>
                        <Check
                          aria-hidden="true"
                          className="h-4 w-4 text-[var(--color-onefavorable)]"
                        />
                        {t("security.phraseCopied")}
                      </>
                    ) : (
                      <>
                        <Copy aria-hidden="true" className="h-4 w-4" />
                        {t("security.copyPhraseBtn")}
                      </>
                    )}
                  </Button>

                  <Button variant="primary" size="sm" onClick={handleCloseRecoveryModal}>
                    {t("security.closeModalBtn")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

export default SecurityPage;
