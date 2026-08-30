import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, Input, StatePanel } from "@/components/ui";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";
import { pinPolicyChecks, validatePinPolicy } from "@/api/schema";
import { CircleCheck, CircleX, Eye, EyeOff } from "lucide-react";

type Phase = "idle" | "submitting" | "error" | "success";

function PolicyRequirement({ met, label }: { met: boolean; label: string }) {
  const Icon = met ? CircleCheck : CircleX;
  return (
    <li
      className={`flex items-center gap-2 text-xs ${met ? "text-[var(--color-onefavorable)]" : "text-[var(--color-onetextmuted)]"}`}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {label}
    </li>
  );
}

/**
 * First-run PIN registration (AUTH-SPEC §2.1 / UF-010 step 1 — F-004).
 * `/welcome` entry point: `security.pin_setup` must succeed before the Wizard
 * (`company.create` is gated on the PIN row in the Rust core).
 * 5 states: loading (submitting) / empty (no input) / error (PIN_POLICY_WEAK) /
 * success (continue) / populated (form with values).
 */
export function FirstRunPinPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<BridgeError | null>(null);

  const checks = pinPolicyChecks(pin);
  const issue = validatePinPolicy(pin);
  const mismatch = confirm.length > 0 && confirm !== pin;
  const canSubmit = issue === null && confirm === pin && phase !== "submitting";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setPhase("submitting");
    setError(null);
    try {
      await call("security.pin_setup", { pin, confirm });
      setPhase("success");
    } catch (err) {
      setError(err as BridgeError);
      setPhase("error");
    }
  }

  const screenState: "loading" | "empty" | "error" | "success" | "populated" =
    phase === "submitting"
      ? "loading"
      : phase === "error"
        ? "error"
        : phase === "success"
          ? "success"
          : pin === "" && confirm === ""
            ? "empty"
            : "populated";

  if (phase === "success") {
    return (
      <main className="flex min-h-full flex-col items-center justify-center p-6">
        <StatePanel state="success" message={t("pinSetup.success")}>
          <Button onClick={() => navigate("/wizard")}>{t("pinSetup.continue")}</Button>
        </StatePanel>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col justify-center p-8">
      <Card title={t("pinSetup.title")}>
        <StatePanel
          state={screenState}
          message={
            screenState === "empty"
              ? t("pinSetup.empty")
              : screenState === "error"
                ? (error?.userMessage ?? t("pinSetup.weak"))
                : screenState === "loading"
                  ? t("pinSetup.submitting")
                  : t("pinSetup.subtitle")
          }
          errorCode={error?.code}
        >
          <form
            onSubmit={onSubmit}
            className="flex w-full flex-col gap-4"
            aria-label={t("pinSetup.title")}
          >
            <Input
              label={t("pinSetup.pinLabel")}
              id="pin-setup-pin"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              inputMode="text"
              placeholder={t("pinSetup.pinPlaceholder")}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
            <div className="flex items-center justify-between">
              <ul className="flex flex-col gap-1">
                <PolicyRequirement met={checks.length} label={t("pinSetup.hintLength")} />
                <PolicyRequirement met={checks.classes} label={t("pinSetup.hintClasses")} />
                <PolicyRequirement met={checks.sequence} label={t("pinSetup.hintSequence")} />
              </ul>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                aria-pressed={show}
                aria-label={t("pinSetup.toggleA11y")}
                onClick={() => setShow((s) => !s)}
              >
                {show ? (
                  <EyeOff aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Eye aria-hidden="true" className="h-4 w-4" />
                )}
                {show ? t("pinSetup.hide") : t("pinSetup.show")}
              </Button>
            </div>
            <Input
              label={t("pinSetup.confirmLabel")}
              id="pin-setup-confirm"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              inputMode="text"
              placeholder={t("pinSetup.confirmPlaceholder")}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              errorText={mismatch ? t("pinSetup.mismatch") : undefined}
            />
            <Button type="submit" disabled={!canSubmit}>
              {phase === "submitting" ? t("pinSetup.submitting") : t("pinSetup.submit")}
            </Button>
          </form>
        </StatePanel>
      </Card>
    </main>
  );
}
