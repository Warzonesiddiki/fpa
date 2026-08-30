import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Input, StatePanel } from "@/components/ui";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";

const STEPS = ["company", "pack", "calendar", "coa", "model"] as const;

const PACKS = [
  { key: "saas", name: "SaaS / Tech" },
  { key: "manufacturing", name: "Manufacturing" },
  { key: "retail", name: "Retail" },
];

const CALENDARS = ["12month", "454", "445", "544", "3334"] as const;

/** S-002 First-Run Wizard — 5 steps (F-004; SCREENS-SPEC S-002). */
export function WizardPage() {
  const { t } = useTranslation();
  const [stepIndex, setStepIndex] = useState(0);
  const [companyName, setCompanyName] = useState("");
  const [companyType, setCompanyType] = useState<"single" | "group">("single");
  const [packKey, setPackKey] = useState("saas");
  const [calendar, setCalendar] = useState<(typeof CALENDARS)[number]>("12month");
  const [planOnly, setPlanOnly] = useState(true);
  const [horizon, setHorizon] = useState<"13w" | "1y" | "3y" | "5y">("1y");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<BridgeError | null>(null);
  const [done, setDone] = useState(false);

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const canNext = step !== "company" || companyName.trim().length >= 2;

  async function createCompany() {
    setCreating(true);
    setError(null);
    try {
      await call("company.create", {
        name: companyName.trim(),
        path: `${companyName.trim()}.fpa`,
        pack_key: packKey,
        calendar: {
          preset: calendar,
          fy_start_month: calendar === "12month" ? 4 : null,
          week_start_day: 0,
          anchor_rule: calendar === "12month" ? null : "sunday_near_feb_1",
          year_end_rule: calendar === "12month" ? null : "nrf_4_day",
        },
        plan_only: planOnly,
        horizon,
      });
      setDone(true);
    } catch (err) {
      setError(err as BridgeError);
    } finally {
      setCreating(false);
    }
  }

  if (done) {
    return <StatePanel state="success" message={`${companyName} created`} />;
  }

  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col p-8">
      <ol className="mb-8 flex items-center gap-2" aria-label={t("wizard.title")}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`text-xs ${i === stepIndex ? "font-semibold text-[var(--color-oneprimary)]" : "text-[var(--color-onetextmuted)]"}`}
          >
            {i + 1}. {t(`wizard.steps.${s}`)}
          </li>
        ))}
      </ol>

      <Card title={t(`wizard.steps.${step}`)}>
        <div className="flex flex-col gap-4">
          {step === "company" && (
            <>
              <Input
                label={t("wizard.companyName")}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder={t("wizard.companyNamePlaceholder")}
              />
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-[var(--color-onetextsecondary)]">
                  {t("wizard.companyType")}
                </legend>
                <div className="flex gap-2">
                  {(["single", "group"] as const).map((v) => (
                    <label key={v} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="companyType"
                        checked={companyType === v}
                        onChange={() => setCompanyType(v)}
                      />
                      {t(`wizard.${v}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}
          {step === "pack" && (
            <ul className="flex flex-col gap-2">
              {PACKS.map((p) => (
                <li key={p.key}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="pack"
                      checked={packKey === p.key}
                      onChange={() => setPackKey(p.key)}
                    />
                    {p.name}
                  </label>
                </li>
              ))}
              <p className="text-xs text-[var(--color-onetextmuted)]">{t("wizard.packHint")}</p>
            </ul>
          )}
          {step === "calendar" && (
            <ul className="flex flex-col gap-2">
              {CALENDARS.map((c) => (
                <li key={c}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="calendar"
                      checked={calendar === c}
                      onChange={() => setCalendar(c)}
                    />
                    {t(`wizard.calendar${c === "12month" ? "12mo" : c}`)}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {step === "coa" && (
            <p className="text-sm text-[var(--color-onetextsecondary)]">{t("wizard.coaReview")}</p>
          )}
          {step === "model" && (
            <>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={planOnly}
                  onChange={(e) => setPlanOnly(e.target.checked)}
                />
                <span>
                  {t("wizard.planOnly")}
                  <span className="block text-xs text-[var(--color-onetextmuted)]">
                    {t("wizard.planOnlyHint")}
                  </span>
                </span>
              </label>
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-[var(--color-onetextsecondary)]">
                  {t("wizard.horizon")}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {(["13w", "1y", "3y", "5y"] as const).map((h) => (
                    <label key={h} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="horizon"
                        checked={horizon === h}
                        onChange={() => setHorizon(h)}
                      />
                      {t(`wizard.horizon${h}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}
        </div>
      </Card>

      {error && (
        <p role="alert" className="mt-4 text-sm text-[var(--color-onerror)]">
          {error.userMessage}
        </p>
      )}

      <div className="mt-6 flex justify-between">
        <Button
          variant="secondary"
          disabled={stepIndex === 0}
          onClick={() => setStepIndex((i) => i - 1)}
        >
          {t("common.back")}
        </Button>
        {isLast ? (
          <Button onClick={createCompany} disabled={creating}>
            {creating ? t("wizard.creating") : t("wizard.create")}
          </Button>
        ) : (
          <Button onClick={() => setStepIndex((i) => i + 1)} disabled={!canNext}>
            {t("common.next")}
          </Button>
        )}
      </div>
    </main>
  );
}
