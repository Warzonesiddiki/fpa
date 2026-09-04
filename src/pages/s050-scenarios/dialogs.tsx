/**
 * S-050 Scenario Manager — modal dialogs for every lifecycle action (F-022).
 *
 * Dialog inventory per SCENARIO-VERSION-SPEC §1 / SCREENS-SPEC D-004:
 *   * Create / Duplicate   — name + optional copy-source (mock/core auto-derive names when blank)
 *   * Lock / Delete        — D-004 2-step confirm: the Scenario's exact name must be typed
 *   * Reopen               — written reason required (mock/core answer VALUE_INVALID without one)
 *   * Set baseline         — reason required only when replacing the current Baseline
 *
 * All dialogs are labelled modal overlays; the confirm affordance is disabled while a mutation
 * is in flight (`busy`) and typed errors surface inline (`error`), never as raw exceptions.
 */
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Input } from "@/components/ui";
import type { ScenarioRow } from "@/api/schema";

/* ── Shared chrome ─────────────────────────────────────────────────────────────── */

interface DialogShellProps {
  title: string;
  onClose: () => void;
  /** Freeze dismissal while a mutation is running. */
  busy?: boolean;
  children: ReactNode;
}

function DialogShell({ title, onClose, busy = false, children }: DialogShellProps) {
  const { t } = useTranslation();
  const shellRef = useRef<HTMLDivElement | null>(null);

  // Focus the dialog surface on open and close on Escape (while not busy). The app has no
  // focus-trap primitive yet — the overlay keeps the rest of the page inert for mouse users.
  useEffect(() => {
    shellRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={shellRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-[min(94vw,30rem)] rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-4 shadow-xl outline-none"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-[var(--color-onetext)]">{title}</h2>
          <button
            type="button"
            aria-label={t("common.close")}
            disabled={busy}
            onClick={onClose}
            className="rounded-md px-1.5 text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurfacealt)] disabled:opacity-50"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DialogError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-[var(--color-oneerror)] bg-[var(--color-onesurfacealt)] px-3 py-2 text-xs text-[var(--color-onerror)]"
    >
      {message}
    </p>
  );
}

function DialogFooter({
  busy,
  submitLabel,
  busyLabel,
  danger = false,
  disabled = false,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  submitLabel: string;
  busyLabel: string;
  danger?: boolean;
  disabled?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
        {t("common.cancel")}
      </Button>
      <Button
        variant={danger ? "danger" : "primary"}
        size="sm"
        onClick={onSubmit}
        disabled={busy || disabled}
      >
        {busy ? busyLabel : submitLabel}
      </Button>
    </div>
  );
}

/* ── Create / Duplicate ─────────────────────────────────────────────────────────── */

export function CreateScenarioDialog({
  scenarios,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  /** Existing Scenarios of the active Model — used as the optional copy-source ("Base") list. */
  scenarios: ScenarioRow[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (name: string | undefined, baseId: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [baseId, setBaseId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const scenariosExist = scenarios.length > 0;
  const blankNameWithoutBase = !name.trim() && !baseId;

  const submit = () => {
    if (scenariosExist && blankNameWithoutBase) {
      // The core would reject a duplicate "Base" with SCENARIO_NAME_DUP — validate up front.
      setLocalError(t("scenariosPage.dialog.create.nameRequired"));
      return;
    }
    setLocalError(null);
    onSubmit(name.trim() || undefined, baseId || undefined);
  };

  return (
    <DialogShell title={t("scenariosPage.dialog.create.title")} onClose={onClose} busy={busy}>
      <div className="flex flex-col gap-3">
        <Input
          label={t("scenariosPage.dialog.create.name")}
          hint={t("scenariosPage.dialog.create.nameHint")}
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) submit();
          }}
        />
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="scenario-base"
            className="text-sm font-medium text-[var(--color-onetextsecondary)]"
          >
            {t("scenariosPage.dialog.create.base")}
          </label>
          <select
            id="scenario-base"
            value={baseId}
            onChange={(e) => setBaseId(e.target.value)}
            className="h-10 w-full rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-3 text-sm"
          >
            <option value="">{t("scenariosPage.dialog.create.none")}</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--color-onetextmuted)]">
            {t("scenariosPage.dialog.create.baseHint")}
          </p>
        </div>
        <DialogError message={error ?? localError} />
        <DialogFooter
          busy={busy}
          submitLabel={t("scenariosPage.dialog.create.submit")}
          busyLabel={t("scenariosPage.dialog.create.busy")}
          onSubmit={submit}
          onCancel={onClose}
        />
      </div>
    </DialogShell>
  );
}

export function DuplicateScenarioDialog({
  source,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  source: ScenarioRow;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (name: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");

  return (
    <DialogShell title={t("scenariosPage.dialog.duplicate.title")} onClose={onClose} busy={busy}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-[var(--color-onetextsecondary)]">
          {t("scenariosPage.dialog.duplicate.source", { name: source.name })}
        </p>
        <Input
          label={t("scenariosPage.dialog.duplicate.name")}
          hint={t("scenariosPage.dialog.duplicate.nameHint")}
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) onSubmit(name.trim() || undefined);
          }}
        />
        <DialogError message={error} />
        <DialogFooter
          busy={busy}
          submitLabel={t("scenariosPage.dialog.duplicate.submit")}
          busyLabel={t("scenariosPage.dialog.duplicate.busy")}
          onSubmit={() => onSubmit(name.trim() || undefined)}
          onCancel={onClose}
        />
      </div>
    </DialogShell>
  );
}

/* ── Reopen (written reason required) ───────────────────────────────────────────── */

export function ReopenScenarioDialog({
  scenario,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  scenario: ScenarioRow;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = () => {
    if (!reason.trim()) {
      setLocalError(t("scenariosPage.dialog.reopen.reasonRequired"));
      return;
    }
    setLocalError(null);
    onSubmit(reason.trim());
  };

  return (
    <DialogShell title={t("scenariosPage.dialog.reopen.title")} onClose={onClose} busy={busy}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-[var(--color-onetextsecondary)]">
          {t("scenariosPage.dialog.reopen.body", { name: scenario.name })}
        </p>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="reopen-reason"
            className="text-sm font-medium text-[var(--color-onetextsecondary)]"
          >
            {t("scenariosPage.dialog.reopen.reason")}
          </label>
          <textarea
            id="reopen-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-oneprimary)]"
          />
          <p className="text-xs text-[var(--color-onetextmuted)]">
            {t("scenariosPage.dialog.reopen.reasonHint")}
          </p>
        </div>
        <DialogError message={error ?? localError} />
        <DialogFooter
          busy={busy}
          submitLabel={t("scenariosPage.dialog.reopen.submit")}
          busyLabel={t("common.loading")}
          onSubmit={submit}
          onCancel={onClose}
        />
      </div>
    </DialogShell>
  );
}

/* ── D-004 two-step confirms: Lock / Delete (type the exact Scenario name) ────────── */

function ConfirmNameDialog({
  title,
  body,
  confirmLabel,
  busy,
  danger = false,
  error,
  scenario,
  versionsHint,
  submitLabel,
  busyLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  danger?: boolean;
  error: string | null;
  scenario: ScenarioRow;
  versionsHint?: string;
  submitLabel: string;
  busyLabel: string;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const matches = typed === scenario.name;

  return (
    <DialogShell title={title} onClose={onClose} busy={busy}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-[var(--color-onetextsecondary)]">{body}</p>
        {versionsHint && (
          <p className="text-xs font-medium text-[var(--color-onetext)]">{versionsHint}</p>
        )}
        <Input
          label={confirmLabel}
          hint={t("scenariosPage.dialog.typeToConfirm", { name: scenario.name })}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-invalid={typed.length > 0 && !matches ? true : undefined}
        />
        <DialogError message={error} />
        <DialogFooter
          busy={busy}
          submitLabel={submitLabel}
          busyLabel={busyLabel}
          danger={danger}
          disabled={!matches}
          onSubmit={onSubmit}
          onCancel={onClose}
        />
      </div>
    </DialogShell>
  );
}

export function LockScenarioDialog({
  scenario,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  scenario: ScenarioRow;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const nextVersion = scenario.versions.length + 1;
  return (
    <ConfirmNameDialog
      title={t("scenariosPage.dialog.lock.title")}
      body={t("scenariosPage.dialog.lock.body", { name: scenario.name })}
      confirmLabel={t("scenariosPage.dialog.lock.confirm")}
      versionsHint={t("scenariosPage.dialog.lock.versionHint", {
        version: `v${nextVersion}`,
      })}
      busy={busy}
      error={error}
      scenario={scenario}
      submitLabel={t("scenariosPage.dialog.lock.submit")}
      busyLabel={t("common.loading")}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}

export function DeleteScenarioDialog({
  scenario,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  scenario: ScenarioRow;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmNameDialog
      title={t("scenariosPage.dialog.delete.title")}
      body={t("scenariosPage.dialog.delete.body", { name: scenario.name })}
      confirmLabel={t("scenariosPage.dialog.delete.confirm")}
      busy={busy}
      danger
      error={error}
      scenario={scenario}
      submitLabel={t("scenariosPage.dialog.delete.submit")}
      busyLabel={t("common.loading")}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}

/* ── Set baseline (reason required when replacing) ───────────────────────────────── */

export function BaselineScenarioDialog({
  scenario,
  currentBaseline,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  scenario: ScenarioRow;
  /** The Scenario that is currently THE Baseline, when a different one is set. */
  currentBaseline: ScenarioRow | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (reason: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const replacing = currentBaseline !== null;

  const submit = () => {
    if (replacing && !reason.trim()) {
      setLocalError(t("scenariosPage.dialog.baseline.reasonRequired"));
      return;
    }
    setLocalError(null);
    onSubmit(reason.trim() || undefined);
  };

  return (
    <DialogShell title={t("scenariosPage.dialog.baseline.title")} onClose={onClose} busy={busy}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-[var(--color-onetextsecondary)]">
          {t("scenariosPage.dialog.baseline.body", { name: scenario.name })}
        </p>
        {replacing && (
          <p className="text-xs font-medium text-[var(--color-onewarning)]">
            {t("scenariosPage.dialog.baseline.replacing", { current: currentBaseline.name })}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="baseline-reason"
            className="text-sm font-medium text-[var(--color-onetextsecondary)]"
          >
            {t("scenariosPage.dialog.baseline.reason")}
          </label>
          <textarea
            id="baseline-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-oneprimary)]"
          />
          <p className="text-xs text-[var(--color-onetextmuted)]">
            {replacing
              ? t("scenariosPage.dialog.baseline.reasonHintReplacing")
              : t("scenariosPage.dialog.baseline.reasonHint")}
          </p>
        </div>
        <DialogError message={error ?? localError} />
        <DialogFooter
          busy={busy}
          submitLabel={t("scenariosPage.dialog.baseline.submit")}
          busyLabel={t("common.loading")}
          onSubmit={submit}
          onCancel={onClose}
        />
      </div>
    </DialogShell>
  );
}
