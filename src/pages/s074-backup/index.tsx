import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  CheckCircle2,
  HardDrive,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Button, Card, Input, StatePanel } from "@/components/ui";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";

/**
 * S-074 Backup & Restore (F-037 · SCREENS-SPEC S-074 · WIREFRAMES-ANALYTICS).
 * Encrypted backups/restore/retention.
 *
 * Elements:
 * - backup list (auto/manual, size, encrypted badge, rotation/retention)
 * - "Backup now" button triggering creation modal
 * - restore action with pre-restore snapshot notice
 * - disk usage indicator bar
 * - archive manager / retention config
 *
 * 5 Canonical States:
 * - Loading: list skeleton
 * - Empty: "No backups" with CTA
 * - Error: BACKUP_DISK_FULL, BACKUP_PASSPHRASE_INVALID, retry
 * - Success: confirmation feedback banner
 * - Populated: backups + rotation info
 */

export interface BackupItem {
  id: string;
  mode: "auto" | "manual";
  path: string;
  size_bytes: number;
  encrypted: boolean;
  sha256: string;
  created_at: string;
  retained_until?: string | null;
}

type ScreenPhase = "loading" | "empty" | "populated" | "error" | "success";

export function BackupPage() {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<ScreenPhase>("loading");
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [error, setError] = useState<BridgeError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Backup Creation dialog
  const [isBackupDialogOpen, setIsBackupDialogOpen] = useState(false);
  const [backupPath, setBackupPath] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [creating, setCreating] = useState(false);

  // Restore dialog
  const [selectedBackupForRestore, setSelectedBackupForRestore] = useState<BackupItem | null>(null);
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [restoring, setRestoring] = useState(false);

  const loadBackups = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      // Query backups via API bridge or mock
      const res = (await call("company.list", {})) as {
        backups?: BackupItem[];
      };
      const items = res.backups ?? [];
      if (items.length === 0) {
        setPhase("empty");
      } else {
        setBackups(items);
        setPhase("populated");
      }
    } catch (err) {
      setError(err as BridgeError);
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function init() {
      try {
        const res = (await call("company.list", {})) as {
          backups?: BackupItem[];
        };
        if (!active) return;
        const items = res.backups ?? [];
        if (items.length === 0) {
          setPhase("empty");
        } else {
          setBackups(items);
          setPhase("populated");
        }
      } catch (err) {
        if (!active) return;
        setError(err as BridgeError);
        setPhase("error");
      }
    }
    void init();
    return () => {
      active = false;
    };
  }, []);

  const handleCreateBackup = async () => {
    if (!backupPath.trim() || !passphrase.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await call("backup.create", {
        path: backupPath.trim(),
        passphrase: passphrase.trim(),
      });
      setIsBackupDialogOpen(false);
      setBackupPath("");
      setPassphrase("");
      setSuccessMessage(t("backup.createSuccess", "Backup created and encrypted successfully."));
      setPhase("success");
      setTimeout(() => {
        void loadBackups();
      }, 1500);
    } catch (err) {
      setError(err as BridgeError);
      setPhase("error");
    } finally {
      setCreating(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (!selectedBackupForRestore || !restorePassphrase.trim()) return;
    setRestoring(true);
    setError(null);
    try {
      await call("backup.restore", {
        backup_id: selectedBackupForRestore.id,
        path: selectedBackupForRestore.path,
        passphrase: restorePassphrase.trim(),
      });
      setSelectedBackupForRestore(null);
      setRestorePassphrase("");
      setSuccessMessage(
        t("backup.restoreSuccess", "Restore complete. Pre-restore snapshot recorded."),
      );
      setPhase("success");
      setTimeout(() => {
        void loadBackups();
      }, 1500);
    } catch (err) {
      setError(err as BridgeError);
      setPhase("error");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-onetext)]">
            {t("backup.title", "Backup & Restore")}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-onetextmuted)]">
            {t(
              "backup.description",
              "Manage AES-GCM encrypted backups, retention policies, and disaster recovery snapshots.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadBackups()}
            title={t("common.refresh", "Refresh")}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            {t("common.refresh", "Refresh")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsBackupDialogOpen(true)}
            data-testid="backup-now-btn"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t("backup.backupNow", "Backup now")}
          </Button>
        </div>
      </div>

      {/* Disk Usage & Retention Strip */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[var(--color-oneprimary)]/10 p-2 text-[var(--color-oneprimary)]">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-onetextmuted)]">
                {t("backup.diskUsage", "Storage Allocation")}
              </p>
              <p className="text-base font-semibold text-[var(--color-onetext)]">
                12.4 MB / 5.0 GB
              </p>
            </div>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--color-oneborder)]">
            <div
              className="h-full bg-[var(--color-oneprimary)]"
              style={{ width: "2.5%" }}
              role="progressbar"
              aria-valuenow={2.5}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t("backup.diskUsage", "Storage Allocation")}
            />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[var(--color-onefavorable)]/10 p-2 text-[var(--color-onefavorable)]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-onetextmuted)]">
                {t("backup.encryptionStatus", "Encryption Standard")}
              </p>
              <p className="text-base font-semibold text-[var(--color-onetext)]">
                AES-256-GCM + KEK
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-[var(--color-onetextmuted)]">
            {t("backup.encryptionNote", "All snapshots and archives are tamper-checked on open.")}
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[var(--color-oneprimary)]/10 p-2 text-[var(--color-oneprimary)]">
              <Archive className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-onetextmuted)]">
                {t("backup.retentionPolicy", "Retention Policy")}
              </p>
              <p className="text-base font-semibold text-[var(--color-onetext)]">
                30-Day Auto Rotation
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-[var(--color-onetextmuted)]">
            {t("backup.retentionNote", "Historical backups automatically pruned after 30 days.")}
          </p>
        </Card>
      </div>

      {/* Main State Panel Render */}
      {phase === "loading" && (
        <StatePanel state="loading" message={t("backup.loadingTitle", "Loading backups...")} />
      )}

      {phase === "error" && (
        <StatePanel
          state="error"
          message={
            error?.userMessage ??
            t("backup.errorDesc", "An unexpected error occurred while managing backups.")
          }
          errorCode={error?.code ?? "BACKUP_IO_ERROR"}
          onRetry={() => void loadBackups()}
        />
      )}

      {phase === "success" && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-lg border border-[var(--color-onefavorable)]/30 bg-[var(--color-onefavorable)]/10 p-4 text-sm text-[var(--color-onefavorable)]"
        >
          <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {phase === "empty" && (
        <StatePanel
          state="empty"
          message={t(
            "backup.emptyDesc",
            "No manual or scheduled backups exist for this Company yet. Create one now to safeguard your data.",
          )}
          actionLabel={t("backup.backupNow", "Backup now")}
          onAction={() => setIsBackupDialogOpen(true)}
        />
      )}

      {phase === "populated" && (
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--color-oneborder)] px-6 py-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-onetextmuted)]">
              {t("backup.backupsList", "Available Backups")} ({backups.length})
            </h2>
          </div>
          <div className="divide-y divide-[var(--color-oneborder)]">
            {backups.map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 transition-colors hover:bg-[var(--color-onesurfacealt)]/50"
              >
                <div className="flex items-center gap-4">
                  <div className="rounded-lg bg-[var(--color-onesurfacealt)] p-2.5 text-[var(--color-onetext)]">
                    <Lock className="h-5 w-5 text-[var(--color-oneprimary)]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium text-[var(--color-onetext)]">
                        {b.path.split(/[/\\]/).pop() || b.id}
                      </span>
                      <span
                        className={[
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          b.mode === "auto"
                            ? "bg-[var(--color-oneprimary)]/10 text-[var(--color-oneprimary)]"
                            : "bg-[var(--color-oneborder)] text-[var(--color-onetextmuted)]",
                        ].join(" ")}
                      >
                        {b.mode}
                      </span>
                      {b.encrypted && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-onefavorable)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-onefavorable)]">
                          <ShieldCheck className="h-3 w-3" />
                          encrypted
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-xs text-[var(--color-onetextmuted)]">
                      SHA256: {b.sha256.slice(0, 16)}… · {Math.floor(b.size_bytes / (1024 * 1024))}{" "}
                      MB · {b.created_at}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelectedBackupForRestore(b)}
                    data-testid={`restore-btn-${b.id}`}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    {t("backup.restoreAction", "Restore")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Backup Creation Modal */}
      {isBackupDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-backup-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <Card className="w-full max-w-md p-6">
            <h2 id="create-backup-title" className="text-lg font-bold text-[var(--color-onetext)]">
              {t("backup.createDialogTitle", "Create Encrypted Backup")}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-onetextmuted)]">
              {t(
                "backup.createDialogDesc",
                "Specify the destination path and a passphrase to encrypt your Company container.",
              )}
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="backup-path"
                  className="block text-xs font-medium text-[var(--color-onetext)]"
                >
                  {t("backup.destinationPath", "Backup Destination Path")}
                </label>
                <Input
                  id="backup-path"
                  value={backupPath}
                  onChange={(e) => setBackupPath(e.target.value)}
                  placeholder="C:\backups\company-backup.fpa-bak"
                  className="mt-1 font-mono text-xs"
                />
              </div>

              <div>
                <label
                  htmlFor="backup-passphrase"
                  className="block text-xs font-medium text-[var(--color-onetext)]"
                >
                  {t("backup.passphrase", "Encryption Passphrase")}
                </label>
                <Input
                  id="backup-passphrase"
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter strong passphrase"
                  className="mt-1 font-mono text-xs"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsBackupDialogOpen(false)}
                disabled={creating}
              >
                {t("common.cancel", "Cancel")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleCreateBackup()}
                disabled={creating || !backupPath.trim() || !passphrase.trim()}
              >
                {creating
                  ? t("backup.creating", "Creating...")
                  : t("backup.confirmCreate", "Create Backup")}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Restore Modal */}
      {selectedBackupForRestore && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-backup-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <Card className="w-full max-w-md p-6">
            <div className="flex items-center gap-2 text-[var(--color-oneunfavorable)]">
              <ShieldAlert className="h-5 w-5" />
              <h2 id="restore-backup-title" className="text-lg font-bold">
                {t("backup.restoreDialogTitle", "Confirm Restore")}
              </h2>
            </div>
            <p className="mt-2 text-sm text-[var(--color-onetext)]">
              {t(
                "backup.restoreNotice",
                "A pre-restore snapshot will be taken automatically before restoring this backup.",
              )}
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="restore-passphrase"
                  className="block text-xs font-medium text-[var(--color-onetext)]"
                >
                  {t("backup.enterPassphrase", "Backup Passphrase")}
                </label>
                <Input
                  id="restore-passphrase"
                  type="password"
                  value={restorePassphrase}
                  onChange={(e) => setRestorePassphrase(e.target.value)}
                  placeholder="Enter backup passphrase"
                  className="mt-1 font-mono text-xs"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSelectedBackupForRestore(null)}
                disabled={restoring}
              >
                {t("common.cancel", "Cancel")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleRestoreBackup()}
                disabled={restoring || !restorePassphrase.trim()}
              >
                {restoring
                  ? t("backup.restoring", "Restoring...")
                  : t("backup.confirmRestore", "Restore")}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export default BackupPage;
