import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Input, Button, StatePanel } from "@/components/ui";
import { useSessionStore } from "@/stores/session";
import { call } from "@/api/bridge";

type LoadPhase = "pending" | "ready" | "failed";

/** S-001 Unlock — 5 states (SCREENS-SPEC S-001). */
export function UnlockPage() {
  const { t } = useTranslation();
  const { unlocked, status: sessionStatus, error, check, unlock } = useSessionStore();
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("pending");
  const [attempt, setAttempt] = useState(0);

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

  const canSubmit = pin.length >= 4 && companies.length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const ok = await unlock(pin, companies[0].id);
    if (ok) {
      navigate("/app/dashboard");
      return;
    }
    setAttempt((n) => n + 1);
    setPin("");
  }

  const lockoutMinutes =
    error?.code === "AUTH_LOCKED"
      ? Math.max(1, Math.floor((error.retryAfterMs ?? 0) / 60000))
      : null;

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
                inputMode="numeric"
                autoComplete="current-password"
                placeholder={t("unlock.pinPlaceholder")}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                errorText={attempt > 0 && pin.length === 0 ? t("unlock.error.invalid") : undefined}
              />
            )}
            {lockoutMinutes !== null && (
              <p role="alert" className="text-sm text-[var(--color-onerror)]">
                {t("unlock.error.locked", { minutes: lockoutMinutes })}
              </p>
            )}
            <Button type="submit" disabled={!canSubmit}>
              {t("unlock.submit")}
            </Button>
            <button
              type="button"
              className="text-xs text-[var(--color-onetextsecondary)] underline"
            >
              {t("unlock.forgot")}
            </button>
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
