import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Input, Button, StatePanel } from "@/components/ui";
import { useSessionStore } from "@/stores/session";
import { call } from "@/api/bridge";
import { validatePinPolicy } from "@/api/schema";

type LoadPhase = "pending" | "ready" | "failed";

/** AUTH-SPEC §2.2: 5 failed attempts → 30 s lockout (fallback when no retryAfterMs arrives). */
const LOCKOUT_DEFAULT_MS = 30_000;

/** S-001 Unlock — 5 states (SCREENS-SPEC S-001). */
export function UnlockPage() {
  const { t } = useTranslation();
  const { unlocked, status: sessionStatus, error, check, unlock } = useSessionStore();
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("pending");
  const [attempt, setAttempt] = useState(0);
  const [lockoutDeadline, setLockoutDeadline] = useState<number | null>(null);
  const [lockoutSecsLeft, setLockoutSecsLeft] = useState(0);
  const lockoutActive = lockoutSecsLeft > 0;

  // KI-013 / ERROR-HANDLING §A: AUTH_LOCKED carries retryAfterMs — render a live seconds
  // countdown (AUTH-SPEC §2.2 "30s countdown"). The deadline is set in the submit handler
  // (never synchronously in an effect body); this ticker only keeps it counting down and
  // is cleared on unmount via the effect cleanup.
  useEffect(() => {
    if (lockoutDeadline === null) return;
    let intervalId: number | undefined;
    const firstTick = window.setTimeout(() => {
      const remaining = () => Math.max(0, Math.ceil((lockoutDeadline - Date.now()) / 1000));
      setLockoutSecsLeft(remaining());
      intervalId = window.setInterval(() => setLockoutSecsLeft(remaining()), 250);
    }, 0);
    return () => {
      window.clearTimeout(firstTick);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [lockoutDeadline]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      await check();
      try {
        const data = (await call("company.list", {})) as { id: string; name: string }[];
        if (!cancelled) {
          setCompanies(data ?? []);
          setLoadPhase("ready");
        }
      } catch {
        if (!cancelled) setLoadPhase("failed");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [check]);

  const screenState: "loading" | "empty" | "error" | "success" | "populated" =
    sessionStatus === "loading" || loadPhase === "pending"
      ? "loading"
      : sessionStatus === "error"
        ? "error"
        : unlocked || sessionStatus === "populated"
          ? "success"
          : companies.length > 0
            ? "populated"
            : "empty";

  const canSubmit = validatePinPolicy(pin) === null && companies.length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || lockoutActive) return;
    const ok = await unlock(pin, companies[0].id);
    if (ok) {
      navigate("/app/dashboard");
      return;
    }
    setAttempt((n) => n + 1);
    setPin("");
    // KI-013: read the freshly-set store error here (event handler, not an effect body).
    // AUTH_LOCKED starts the seconds countdown; submit stays disabled until it expires.
    const failure = useSessionStore.getState().error;
    if (failure?.code === "AUTH_LOCKED") {
      const totalMs = failure.retryAfterMs ?? LOCKOUT_DEFAULT_MS;
      setLockoutDeadline(Date.now() + totalMs);
      setLockoutSecsLeft(Math.max(1, Math.ceil(totalMs / 1000)));
    } else {
      setLockoutDeadline(null);
      setLockoutSecsLeft(0);
    }
  }

  return (
    <main className="flex min-h-full flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-8 shadow-sm">
        <h1 className="text-lg font-semibold">{t("app.name")}</h1>
        <p className="mb-6 text-sm text-[var(--color-onetextsecondary)]">{t("unlock.subtitle")}</p>

        <StatePanel
          state={screenState}
          message={
            screenState === "empty"
              ? t("unlock.populated.nothing")
              : screenState === "error"
                ? (error?.userMessage ?? t("common.error"))
                : undefined
          }
          errorCode={error?.code}
        >
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {companies.length > 0 && (
              <Input
                label={t("unlock.pinLabel")}
                type="password"
                inputMode="text"
                autoComplete="current-password"
                placeholder={t("unlock.pinPlaceholder")}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                errorText={attempt > 0 && pin.length === 0 ? t("unlock.error.invalid") : undefined}
              />
            )}
            {lockoutActive && (
              <p role="alert" className="text-sm text-[var(--color-onerror)]">
                {t("unlock.error.locked", { seconds: lockoutSecsLeft })}
              </p>
            )}
            <Button type="submit" disabled={!canSubmit || lockoutActive}>
              {t("unlock.submit")}
            </Button>
            <button
              type="button"
              className="text-xs text-[var(--color-onetextsecondary)] underline"
            >
              {t("unlock.forgot")}
            </button>
            {companies.length === 0 && (
              <Button type="button" variant="secondary" onClick={() => navigate("/welcome")}>
                {t("unlock.firstRun")}
              </Button>
            )}
          </form>
          {companies.length > 0 && (
            <ul
              className="mt-4 text-xs text-[var(--color-onetextmuted)]"
              aria-label={t("unlock.populated.recent")}
            >
              {companies.map((c) => (
                <li key={c.id}>{c.name}</li>
              ))}
            </ul>
          )}
        </StatePanel>
      </div>
    </main>
  );
}
