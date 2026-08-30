import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, StatePanel } from "@/components/ui";
import { ModelSectionNav } from "@/components/domain/ModelSectionNav";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";
import { useSessionStore } from "@/stores/session";
import type { CalendarPreviewData } from "@/api/schema";
import { Loader2 } from "lucide-react";

const PRESETS = ["12month", "454", "445", "544", "3334"] as const;
type Preset = (typeof PRESETS)[number];

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const WEEK_STARTS = [0, 1, 2, 3, 4, 5, 6];
const PREVIEW_DEBOUNCE_MS = 300;

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

interface PreviewConfig {
  preset: Preset;
  fyStartMonth: number;
  weekStartDay: number;
  anchorRule: "sunday_near_feb_1" | "nearest_weekday" | "first_day";
  yearEndRule: "nrf_4_day" | "full_week" | null;
  from: string;
  yearCount: number;
}

function previewArgs(cfg: PreviewConfig) {
  const weekBased = cfg.preset !== "12month";
  return {
    preset: cfg.preset,
    fy_start_month: weekBased ? null : cfg.fyStartMonth,
    week_start_day: weekBased ? 0 : cfg.weekStartDay,
    anchor_rule: weekBased ? cfg.anchorRule : null,
    year_end_rule: weekBased ? (cfg.yearEndRule ?? "full_week") : null,
    from: cfg.from,
    year_count: cfg.yearCount,
  };
}

/** S-022 Fiscal Calendar — config + live preview + apply (F-003; SCREENS-SPEC S-022). */
export function CalendarPage() {
  const { t } = useTranslation();
  const companyId = useSessionStore((s) => s.companyId);
  const companyName = useSessionStore((s) => s.companyName);
  const [config, setConfig] = useState<PreviewConfig>({
    preset: "12month",
    fyStartMonth: 4,
    weekStartDay: 0,
    anchorRule: "sunday_near_feb_1",
    yearEndRule: null,
    from: todayIso(),
    yearCount: 3,
  });
  const [preview, setPreview] = useState<CalendarPreviewData | null>(null);
  const [previewPhase, setPreviewPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewError, setPreviewError] = useState<BridgeError | null>(null);
  /** Outcome of the last apply — shown only while the config it refers to is unchanged. */
  const [applyResult, setApplyResult] = useState<{
    ok: boolean;
    error: BridgeError | null;
    config: PreviewConfig;
  } | null>(null);
  const [applying, setApplying] = useState(false);
  const requestSeq = useRef(0);

  const runPreview = useCallback(async (cfg: PreviewConfig) => {
    const seq = ++requestSeq.current;
    setPreviewPhase("loading");
    setPreviewError(null);
    try {
      const data = (await call("calendar.preview", previewArgs(cfg))) as CalendarPreviewData;
      if (seq !== requestSeq.current) return; // stale response — newer config superseded it
      setPreview(data);
      setPreviewPhase("ready");
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setPreviewError(err as BridgeError);
      setPreviewPhase("error");
    }
  }, []);

  // Debounced live preview on any config change.
  useEffect(() => {
    const timer = window.setTimeout(() => void runPreview(config), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [config, runPreview]);

  function setPreset(preset: Preset) {
    setConfig((c) => ({
      ...c,
      preset,
      yearEndRule:
        preset === "12month"
          ? null
          : preset === "454"
            ? "nrf_4_day"
            : c.yearEndRule === "nrf_4_day"
              ? "full_week"
              : c.yearEndRule,
    }));
  }

  async function apply() {
    if (!companyId || previewPhase !== "ready" || !preview) return;
    setApplying(true);
    try {
      await call("calendar.apply", {
        company_id: companyId,
        config: [
          {
            preset: config.preset,
            fy_start_month: config.preset === "12month" ? config.fyStartMonth : null,
            week_start_day: config.preset === "12month" ? config.weekStartDay : 0,
            anchor_rule: config.preset === "12month" ? null : config.anchorRule,
            year_end_rule: config.preset === "12month" ? null : (config.yearEndRule ?? "full_week"),
          },
        ],
        bu_map: [],
      });
      setApplyResult({ ok: true, error: null, config });
    } catch (err) {
      setApplyResult({ ok: false, error: err as BridgeError, config });
    } finally {
      setApplying(false);
    }
  }

  if (!companyId) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t("calendarPage.title")}</h1>
        <ModelSectionNav />
        <StatePanel state="empty" message={t("calendarPage.noCompany")} />
      </div>
    );
  }

  const weekBased = config.preset !== "12month";
  const resultCurrent =
    applyResult !== null && JSON.stringify(applyResult.config) === JSON.stringify(config);
  const applied = resultCurrent && applyResult.ok;
  const applyError = resultCurrent && !applyResult.ok ? applyResult.error : null;
  const canApply = previewPhase === "ready" && Boolean(preview) && !applying && !previewError;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("calendarPage.title")}</h1>
      <ModelSectionNav />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        <section className="flex flex-col gap-4 rounded-lg border border-[var(--color-oneborder)] p-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-[var(--color-onetextsecondary)]">
              {t("calendarPage.preset")}
            </legend>
            <div className="flex flex-col gap-1.5">
              {PRESETS.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="calendar-preset"
                    checked={config.preset === p}
                    onChange={() => setPreset(p)}
                  />
                  {t(`calendarPage.presets.${p}`)}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-[var(--color-onetextsecondary)]">
              {t("calendarPage.fyStart")}
            </span>
            <select
              value={config.fyStartMonth}
              disabled={weekBased}
              onChange={(e) =>
                setConfig((c) => ({ ...c, fyStartMonth: parseInt(e.target.value, 10) }))
              }
              className="h-9 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 text-sm"
            >
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-[var(--color-onetextsecondary)]">
              {t("calendarPage.weekStart")}
            </span>
            <select
              value={weekBased ? 0 : config.weekStartDay}
              disabled={weekBased}
              onChange={(e) =>
                setConfig((c) => ({ ...c, weekStartDay: parseInt(e.target.value, 10) }))
              }
              className="h-9 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 text-sm"
            >
              {WEEK_STARTS.map((d) => (
                <option key={d} value={d}>
                  {t(`calendarPage.weekday.${d}`)}
                </option>
              ))}
            </select>
            {weekBased && (
              <span className="text-xs text-[var(--color-onetextmuted)]">
                {t("calendarPage.nrfSundayHint")}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-[var(--color-onetextsecondary)]">
              {t("calendarPage.yearEndRule")}
            </span>
            <select
              value={config.yearEndRule ?? ""}
              disabled={!weekBased}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  yearEndRule: (e.target.value || null) as PreviewConfig["yearEndRule"],
                }))
              }
              className="h-9 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 text-sm"
            >
              <option value="nrf_4_day">{t("calendarPage.yearEndRule.nrf")}</option>
              <option value="full_week">{t("calendarPage.yearEndRule.full")}</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-[var(--color-onetextsecondary)]">
              {t("calendarPage.yearCount")}
            </span>
            <select
              value={config.yearCount}
              onChange={(e) =>
                setConfig((c) => ({ ...c, yearCount: parseInt(e.target.value, 10) }))
              }
              className="h-9 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 text-sm"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-[var(--color-onetextsecondary)]">
              {t("calendarPage.from")}
            </span>
            <input
              type="date"
              value={config.from}
              onChange={(e) => setConfig((c) => ({ ...c, from: e.target.value }))}
              className="h-9 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 text-sm"
            />
          </label>

          <Button disabled={!canApply} onClick={() => void apply()}>
            {applying ? t("calendarPage.applying") : t("calendarPage.apply")}
          </Button>

          {applied && (
            <p role="status" className="text-sm text-[var(--color-onefavorable)]">
              {t("calendarPage.applied", { company: companyName ?? companyId })}
            </p>
          )}
          {applyError && (
            <p role="alert" className="text-sm text-[var(--color-onerror)]">
              {applyError.userMessage}
              <span className="mt-1 block font-mono text-xs opacity-70">{applyError.code}</span>
            </p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-[var(--color-onetext)]">
            {t("calendarPage.preview.title")}
          </h2>

          {previewPhase === "loading" && (
            <p
              role="status"
              className="flex items-center gap-2 rounded-lg border border-[var(--color-oneborder)] p-4 text-sm text-[var(--color-onetextsecondary)]"
            >
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </p>
          )}

          {previewPhase === "error" && (
            <div className="rounded-lg border border-[var(--color-onerror)] p-4">
              <p role="alert" className="text-sm text-[var(--color-onerror)]">
                {previewError?.userMessage ?? t("calendarPage.error.preview")}
              </p>
              {previewError?.code && (
                <span className="mt-1 block font-mono text-xs text-[var(--color-onetextsecondary)]">
                  {previewError.code}
                </span>
              )}
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => void runPreview(config)}
              >
                {t("common.retry")}
              </Button>
            </div>
          )}

          {previewPhase === "ready" && preview && (
            <div className="overflow-x-auto rounded-lg border border-[var(--color-oneborder)]">
              {preview.fiscal_years.map((fy) => (
                <div
                  key={fy.fy_label}
                  className="border-b border-[var(--color-oneborder)] last:border-0"
                >
                  <h3 className="flex items-center justify-between bg-[var(--color-onesurfacealt)] px-3 py-2 text-xs font-semibold">
                    <span>{fy.fy_label}</span>
                    <span className="font-normal text-[var(--color-onetextsecondary)]">
                      {fy.start_date} → {fy.end_date} ·{" "}
                      {t("calendarPage.weekCount", { count: fy.week_count })}
                    </span>
                  </h3>
                  <table className="w-full text-left text-xs">
                    <thead className="text-[var(--color-onetextmuted)]">
                      <tr>
                        <th scope="col" className="px-3 py-1.5">
                          {t("calendarPage.period")}
                        </th>
                        <th scope="col" className="px-3 py-1.5">
                          {t("calendarPage.start")}
                        </th>
                        <th scope="col" className="px-3 py-1.5">
                          {t("calendarPage.end")}
                        </th>
                        <th scope="col" className="px-3 py-1.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {fy.periods.map((p) => (
                        <tr key={p.code} className="border-t border-[var(--color-oneborder)]">
                          <td className="px-3 py-1.5 font-mono">{p.code}</td>
                          <td className="px-3 py-1.5 tabular-nums">{p.start_date}</td>
                          <td className="px-3 py-1.5 tabular-nums">{p.end_date}</td>
                          <td className="px-3 py-1.5 text-right">
                            {p.is_53rd_week && (
                              <span className="rounded-full bg-[var(--color-onesurfacealt)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-onetextsecondary)]">
                                {t("calendarPage.w53")}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {previewPhase === "idle" && (
            <p className="rounded-lg border border-[var(--color-oneborder)] p-4 text-sm text-[var(--color-onetextmuted)]">
              {t("calendarPage.emptyDefault")}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
