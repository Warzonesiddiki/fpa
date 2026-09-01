import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, Input, StatePanel } from "@/components/ui";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";
import { CANONICAL_MAPPING_ID, type CalendarPreviewData, type PackMeta } from "@/api/schema";
import { Loader2 } from "lucide-react";

const STEPS = ["company", "pack", "calendar", "coa", "model"] as const;

/** Bundled demo asset (assets/demo/README.md — clearly-marked sample data, B18-3).
 *  Relative resource path; `import.parse` resolves it via the resource dir / dev fallback. */
const DEMO_GL_DUMP = "assets/demo/sample_gl_dump.csv";
const DEMO_COMPANY_NAME = "Demo Company — sample data";
/** The demo batch must be marked as demo everywhere it is listed (B18-3, QA F-004.6). */
const DEMO_BATCH_NAME = "DEMO — sample_gl_dump.csv (clearly-marked demo data, never production)";

/** S-002 loading state: "wizard resumes from saved draft" (TODO M1-8: resume-safe). */
const DRAFT_KEY = "onefpa.wizard.v1";
const CALENDAR_PRESETS: readonly string[] = ["12month", "454", "445", "544", "3334"];
const HORIZONS = ["13w", "1y", "3y", "5y"] as const;

interface WizardDraft {
  stepIndex: number;
  companyName: string;
  companyType: "single" | "group";
  packKey: string;
  calendar: (typeof CALENDARS)[number];
  fyStartMonth: number;
  planOnly: boolean;
  horizon: (typeof HORIZONS)[number];
  demoData: boolean;
}

function loadDraft(): WizardDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<WizardDraft>;
    if (
      typeof d !== "object" ||
      d === null ||
      typeof d.companyName !== "string" ||
      typeof d.companyType !== "string" ||
      (d.companyType !== "single" && d.companyType !== "group") ||
      typeof d.packKey !== "string" ||
      typeof d.calendar !== "string" ||
      !CALENDAR_PRESETS.includes(d.calendar) ||
      typeof d.fyStartMonth !== "number" ||
      d.fyStartMonth < 1 ||
      d.fyStartMonth > 12 ||
      typeof d.planOnly !== "boolean" ||
      typeof d.horizon !== "string" ||
      !(HORIZONS as readonly string[]).includes(d.horizon) ||
      typeof d.demoData !== "boolean" ||
      typeof d.stepIndex !== "number" ||
      d.stepIndex < 0 ||
      d.stepIndex >= STEPS.length
    ) {
      return null;
    }
    return d as WizardDraft;
  } catch {
    return null; // corrupt draft → fresh wizard (never crash first-run on bad local state)
  }
}

function saveDraft(draft: WizardDraft): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage unavailable (private mode) → the wizard still works, just not resumable.
  }
}

function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // no-op
  }
}

const CALENDARS = ["12month", "454", "445", "544", "3334"] as const;

/** Deterministic logo-tile hue per pack key (no bundled logo asset → monogram tile, S-002). */
function packHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) % 360;
  return h;
}

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
  const navigate = useNavigate();
  const [draft] = useState<WizardDraft | null>(loadDraft);
  const [stepIndex, setStepIndex] = useState(draft?.stepIndex ?? 0);
  const [companyName, setCompanyName] = useState(draft?.companyName ?? "");
  const [companyType, setCompanyType] = useState<"single" | "group">(
    draft?.companyType ?? "single",
  );
  const [packKey, setPackKey] = useState(draft?.packKey ?? "saas");
  const [packs, setPacks] = useState<PackMeta[]>([]);
  const [packsPhase, setPacksPhase] = useState<PacksPhase>("loading");
  const [packsError, setPacksError] = useState<BridgeError | null>(null);
  const [calendar, setCalendar] = useState<(typeof CALENDARS)[number]>(
    draft?.calendar ?? "12month",
  );
  // FY start month (1-12) — meaningful for the 12-month preset only (F-003: week-based
  // presets are anchored to the Sunday nearest Feb 1 and ignore the FY start month).
  const [fyStartMonth, setFyStartMonth] = useState(draft?.fyStartMonth ?? 4);
  const [preview, setPreview] = useState<CalendarPreviewData | null>(null);
  const [previewPhase, setPreviewPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewError, setPreviewError] = useState<BridgeError | null>(null);
  const [planOnly, setPlanOnly] = useState(draft?.planOnly ?? true);
  const [horizon, setHorizon] = useState<"13w" | "1y" | "3y" | "5y">(draft?.horizon ?? "1y");
  const [demoData, setDemoData] = useState(false);
  const [demoResult, setDemoResult] = useState<"ok" | "failed" | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdName, setCreatedName] = useState("");
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

  // Resume-safe (S-002): persist the in-progress setup; cleared once a Company is created.
  useEffect(() => {
    if (done) return;
    saveDraft({
      stepIndex,
      companyName,
      companyType,
      packKey,
      calendar,
      fyStartMonth,
      planOnly,
      horizon,
      demoData,
    });
  }, [
    stepIndex,
    companyName,
    companyType,
    packKey,
    calendar,
    fyStartMonth,
    planOnly,
    horizon,
    demoData,
    done,
  ]);

  const runPreview = useCallback(async () => {
    setPreviewPhase("loading");
    setPreviewError(null);
    const weekBased = calendar !== "12month";
    try {
      const data = (await call("calendar.preview", {
        preset: calendar,
        fy_start_month: weekBased ? null : fyStartMonth,
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
  }, [calendar, fyStartMonth]);

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

  /** S-002 success: "Company created, toast, navigate to S-010" — open the created Company
   *  (mints its session) and go to the Dashboard. */
  async function openAndNavigate(path: string): Promise<void> {
    await call("company.open", { path });
    navigate("/app/dashboard", { replace: true });
  }

  /** Seed the freshly created Company with the clearly-marked demo actuals (B18-3) through
   *  the NORMAL import pipeline — no side door: parse → validate → tieout → commit with the
   *  canonical template mapping (GL-TEMPLATE-SPEC §7; the demo dump follows it). */
  async function runDemoImport(): Promise<"ok" | "failed"> {
    setDemoResult(null);
    try {
      const parsed = (await call("import.parse", {
        file_path: DEMO_GL_DUMP,
        kind: "gl_dump",
      })) as { parse_id: string };
      const parse_id = parsed.parse_id;
      await call("import.validate", { parse_id, mapping_id: CANONICAL_MAPPING_ID });
      await call("import.tieout", { parse_id, mapping_id: CANONICAL_MAPPING_ID });
      await call("import.commit", {
        parse_id,
        mapping_id: CANONICAL_MAPPING_ID,
        name: DEMO_BATCH_NAME,
        exclusions: [],
      });
      setDemoResult("ok");
      return "ok";
    } catch {
      setDemoResult("failed");
      return "failed";
    }
  }

  async function createCompany(opts?: { demo?: boolean }) {
    // "Open Demo Company" (S-002 Model step): a fixed, clearly-marked sample Company
    // (manufacturing pack, 12-month April calendar — the demo dump's P08 2026-08 lands
    // in the default calendar) whose actuals come from the bundled demo dump.
    const name = opts?.demo ? DEMO_COMPANY_NAME : companyName.trim();
    const pack = opts?.demo ? "manufacturing" : packKey;
    const preset = opts?.demo ? "12month" : calendar;
    setCreating(true);
    setError(null);
    try {
      await call("company.create", {
        name,
        path: `${name}.fpa`,
        pack_key: pack,
        calendar: {
          preset,
          // The demo Company is ALWAYS April-start: the bundled dump's 2026-08 rows land
          // in P08 of that calendar (tests/fixtures/demo_company/gl_dump.expected.json).
          fy_start_month: preset === "12month" ? (opts?.demo ? 4 : fyStartMonth) : null,
          week_start_day: 0,
          anchor_rule: preset === "12month" ? null : "sunday_near_feb_1",
          year_end_rule: preset === "12month" ? null : preset === "454" ? "nrf_4_day" : "full_week",
        },
        plan_only: opts?.demo ? false : planOnly,
        horizon,
      });
      let demoOutcome: "ok" | "failed" | null = null;
      if (opts?.demo || demoData) {
        // The Company exists either way — the failure is surfaced on the success screen and
        // the data can be re-imported from the Import Hub (S-030).
        demoOutcome = await runDemoImport();
      }
      clearDraft();
      setCreatedName(name);
      setDone(true);
      // S-002 success path: "Company created, toast, navigate to S-010" (except when the
      // demo seeding failed — the user sees the warning and continues on purpose).
      if (demoOutcome !== "failed") {
        try {
          await openAndNavigate(`${name}.fpa`);
        } catch (err) {
          setError(err as BridgeError);
        }
      }
    } catch (err) {
      setError(err as BridgeError);
    } finally {
      setCreating(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center gap-3 p-8">
        <StatePanel state="success" message={`${createdName} created`} />
        {demoResult === "ok" && (
          <p className="text-xs text-[var(--color-onetextsecondary)]">{t("wizard.demoLoaded")}</p>
        )}
        {demoResult === "failed" && (
          <>
            <p role="alert" className="text-xs text-[var(--color-onerror)]">
              {t("wizard.demoFailed")}
            </p>
            <Button
              onClick={() => {
                void openAndNavigate(`${createdName}.fpa`).catch((err) =>
                  setError(err as BridgeError),
                );
              }}
            >
              {t("wizard.continueDashboard")}
            </Button>
          </>
        )}
      </div>
    );
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
                <div>
                  <StatePanel state="empty" message={t("wizard.packEmpty")} />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      setPacksPhase("loading");
                      void loadPacks();
                    }}
                  >
                    {t("wizard.packRedownload")}
                  </Button>
                </div>
              )}
              {packsPhase === "ready" && (
                <ul className="flex flex-col gap-2" aria-label={t("wizard.packLabel")}>
                  {packs.map((p) => (
                    <li key={p.key}>
                      <label
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                          packKey === p.key
                            ? "border-[var(--color-oneprimary)]"
                            : "border-[var(--color-oneborder)]"
                        }`}
                      >
                        <input
                          type="radio"
                          name="pack"
                          className="mt-1"
                          checked={packKey === p.key}
                          onChange={() => setPackKey(p.key)}
                        />
                        <span
                          aria-hidden="true"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold text-white"
                          style={{ backgroundColor: `hsl(${packHue(p.key)} 55% 42%)` }}
                        >
                          {p.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span>
                          <span className="flex items-center gap-2 font-medium">
                            {p.name}
                            <span className="text-xs font-normal text-[var(--color-onetextmuted)]">
                              v{p.version}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-xs text-[var(--color-onetextsecondary)]">
                            {p.description}
                          </span>
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

              {calendar === "12month" ? (
                <label className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-[var(--color-onetextsecondary)]">
                    {t("wizard.fyStart")}
                  </span>
                  <select
                    aria-label={t("wizard.fyStart")}
                    className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1 text-sm"
                    value={fyStartMonth}
                    onChange={(e) => setFyStartMonth(parseInt(e.target.value, 10))}
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>
                        {new Intl.DateTimeFormat("en-US", { month: "long" }).format(
                          new Date(2000, m - 1, 1),
                        )}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="text-xs text-[var(--color-onetextmuted)]">
                  {t("wizard.weekStartNote")}
                </p>
              )}

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
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={demoData}
                  onChange={(e) => setDemoData(e.target.checked)}
                />
                <span>
                  {t("wizard.demoData")}
                  <span className="block text-xs text-[var(--color-onetextmuted)]">
                    {t("wizard.demoDataHint")}
                  </span>
                </span>
              </label>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void createCompany({ demo: true });
                }}
                disabled={creating}
              >
                {t("wizard.openDemo")}
              </Button>
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
          <Button
            onClick={() => {
              void createCompany();
            }}
            disabled={creating}
          >
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
