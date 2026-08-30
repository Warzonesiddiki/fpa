import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Input, StatePanel } from "@/components/ui";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";
import type { CalendarPreviewData, PackMeta } from "@/api/schema";
import { Loader2 } from "lucide-react";

const STEPS = ["company", "pack", "calendar", "coa", "model"] as const;

const CALENDARS = ["12month", "454", "445", "544", "3334"] as const;

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

type PacksPhase = "loading" | "ready" | "error" | "empty";

/** S-002 First-Run Wizard — 5 steps (F-004; SCREENS-SPEC S-002). Pack + calendar steps
 *  load live data from the Rust core (`pack.list`, `calendar.preview`). */
export function WizardPage() {
  const { t } = useTranslation();
  const [stepIndex, setStepIndex] = useState(0);
  const [companyName, setCompanyName] = useState("");
  const [companyType, setCompanyType] = useState<"single" | "group">("single");
  const [packKey, setPackKey] = useState("saas");
  const [packs, setPacks] = useState<PackMeta[]>([]);
  const [packsPhase, setPacksPhase] = useState<PacksPhase>("loading");
  const [packsError, setPacksError] = useState<BridgeError | null>(null);
  const [calendar, setCalendar] = useState<(typeof CALENDARS)[number]>("12month");
  const [preview, setPreview] = useState<CalendarPreviewData | null>(null);
  const [previewPhase, setPreviewPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewError, setPreviewError] = useState<BridgeError | null>(null);
  const [planOnly, setPlanOnly] = useState(true);
  const [horizon, setHorizon] = useState<"13w" | "1y" | "3y" | "5y">("1y");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<BridgeError | null>(null);
  const [done, setDone] = useState(false);

  const loadPacks = useCallback(async () => {
    try {
      const data = (await call("pack.list", {})) as PackMeta[];
      setPacks(data ?? []);
      if (!data || data.length === 0) {
        setPacksPhase("empty");
        return;
      }
      // Keep the current selection when it exists in the library; otherwise default to the first.
      setPackKey((current) => (data.some((p) => p.key === current) ? current : data[0].key));
      setPacksPhase("ready");
    } catch (err) {
      setPacksError(err as BridgeError);
      setPacksPhase("error");
    }
  }, []);

  useEffect(() => {
    // First statement is an await → no synchronous setState inside the effect body.
    void (async () => {
      await loadPacks();
    })();
  }, [loadPacks]);

  const runPreview = useCallback(async () => {
    setPreviewPhase("loading");
    setPreviewError(null);
    const weekBased = calendar !== "12month";
    try {
      const data = (await call("calendar.preview", {
        preset: calendar,
        fy_start_month: weekBased ? null : 4,
        week_start_day: weekBased ? 0 : 0,
        anchor_rule: weekBased ? "sunday_near_feb_1" : null,
        year_end_rule: weekBased ? (calendar === "454" ? "nrf_4_day" : "full_week") : null,
        from: todayIso(),
        year_count: 1,
      })) as CalendarPreviewData;
      setPreview(data);
      setPreviewPhase("ready");
    } catch (err) {
      setPreviewError(err as BridgeError);
      setPreviewPhase("error");
    }
  }, [calendar]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPreview(null);
      setPreviewPhase("idle");
      void runPreview();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [calendar, runPreview]);

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
          year_end_rule:
            calendar === "12month" ? null : calendar === "454" ? "nrf_4_day" : "full_week",
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
            <>
              {packsPhase === "loading" && (
                <p
                  role="status"
                  className="flex items-center gap-2 text-sm text-[var(--color-onetextsecondary)]"
                >
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  {t("wizard.packLoading")}
                </p>
              )}
              {packsPhase === "error" && (
                <div>
                  <p role="alert" className="text-sm text-[var(--color-onerror)]">
                    {packsError?.userMessage ?? t("wizard.packError")}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      setPacksPhase("loading");
                      void loadPacks();
                    }}
                  >
                    {t("wizard.packRetry")}
                  </Button>
                </div>
              )}
              {packsPhase === "empty" && (
                <StatePanel state="empty" message={t("wizard.packEmpty")} />
              )}
              {packsPhase === "ready" && (
                <ul className="flex flex-col gap-2">
                  {packs.map((p) => (
                    <li key={p.key}>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="pack"
                          checked={packKey === p.key}
                          onChange={() => setPackKey(p.key)}
                        />
                        {p.name}
                        <span className="text-xs text-[var(--color-onetextmuted)]">
                          v{p.version}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-[var(--color-onetextmuted)]">{t("wizard.packHint")}</p>
            </>
          )}
          {step === "calendar" && (
            <>
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

              <div className="rounded-lg border border-[var(--color-oneborder)] p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-onetextmuted)]">
                  {t("wizard.calendarPreview")}
                </h3>
                {previewPhase === "loading" && (
                  <p
                    role="status"
                    className="flex items-center gap-2 text-sm text-[var(--color-onetextsecondary)]"
                  >
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                    {t("wizard.calendarPreviewLoading")}
                  </p>
                )}
                {previewPhase === "error" && (
                  <p role="alert" className="text-sm text-[var(--color-onerror)]">
                    {previewError?.userMessage ?? t("wizard.calendarPreviewError")}
                    {previewError?.code && (
                      <span className="mt-1 block font-mono text-xs opacity-70">
                        {previewError.code}
                      </span>
                    )}
                  </p>
                )}
                {previewPhase === "ready" && preview?.fiscal_years?.[0] && (
                  <table className="w-full text-left text-xs">
                    <thead className="text-[var(--color-onetextmuted)]">
                      <tr>
                        <th scope="col" className="py-1 pr-2">
                          {t("wizard.period")}
                        </th>
                        <th scope="col" className="py-1 pr-2">
                          {t("wizard.periodStart")}
                        </th>
                        <th scope="col" className="py-1">
                          {t("wizard.periodEnd")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.fiscal_years[0].periods.map((p) => (
                        <tr key={p.code} className="border-t border-[var(--color-oneborder)]">
                          <td className="py-1 pr-2 font-mono">
                            {p.code}
                            {p.is_53rd_week && (
                              <span className="ml-2 rounded bg-[var(--color-onesurfacealt)] px-1 text-[10px]">
                                {t("wizard.w53")}
                              </span>
                            )}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">{p.start_date}</td>
                          <td className="py-1 tabular-nums">{p.end_date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
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
