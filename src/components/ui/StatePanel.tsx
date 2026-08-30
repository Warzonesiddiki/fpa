import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { Loader2, AlertTriangle, Inbox, CircleCheck, Layers } from "lucide-react";

export type ScreenState = "loading" | "empty" | "error" | "success" | "populated";

export interface StatePanelProps {
  state: ScreenState;
  /** Required for `empty`/`error`/`success`/`populated` — shown as the primary line. */
  message?: string;
  /** Required for `error` — the typed error code (B12). */
  errorCode?: string;
  /** Retry handler for `error` when retryable (B12). */
  onRetry?: () => void;
  /** Actions for `empty` (e.g. "Create your first Company"). */
  actionLabel?: string;
  onAction?: () => void;
  /** Content for `populated`/`success` children. */
  children?: React.ReactNode;
}

const config: Record<
  ScreenState,
  { icon: typeof Loader2; label: string; tone: string; aria: string }
> = {
  loading: {
    icon: Loader2,
    label: "Loading…",
    tone: "text-[var(--color-onetextsecondary)]",
    aria: "Loading",
  },
  empty: {
    icon: Inbox,
    label: "Nothing here yet",
    tone: "text-[var(--color-onetextmuted)]",
    aria: "Empty",
  },
  error: {
    icon: AlertTriangle,
    label: "Something went wrong",
    tone: "text-[var(--color-onerror)]",
    aria: "Error",
  },
  success: {
    icon: CircleCheck,
    label: "Done",
    tone: "text-[var(--color-onefavorable)]",
    aria: "Success",
  },
  populated: {
    icon: Layers,
    label: "Populated",
    tone: "text-[var(--color-onetext)]",
    aria: "Populated",
  },
};

/** Renders one of the 5 required screen states (SCREENS-SPEC; Q1). */
export function StatePanel({
  state,
  message,
  errorCode,
  onRetry,
  actionLabel,
  onAction,
  children,
}: StatePanelProps) {
  const { t } = useTranslation();
  const { icon: Icon, label, tone, aria } = config[state];
  const labelText =
    label === "Loading…" ? t("common.loading") : label === "Done" ? t("common.success") : label;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${aria}: ${message ?? labelText}`}
      className="m-auto flex max-w-md flex-col items-center gap-3 p-8 text-center"
    >
      <Icon
        aria-hidden="true"
        className={`h-8 w-8 ${state === "loading" ? "animate-spin" : ""} ${tone}`}
      />
      <p className="text-sm font-medium text-[var(--color-onetext)]">{message ?? labelText}</p>
      {errorCode && (
        <p className="rounded bg-[var(--color-onesurfacealt)] px-2 py-1 font-mono text-xs text-[var(--color-onetextsecondary)]">
          {t("errors.code", { code: errorCode })}
        </p>
      )}
      {state === "error" && onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
      {state === "empty" && actionLabel && onAction && (
        <Button size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
      {children}
    </div>
  );
}
