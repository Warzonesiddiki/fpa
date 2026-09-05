/**
 * S-052 What-If & Sensitivity Page (F-022 · M4-4 · SCREENS-SPEC S-052 · WIREFRAMES-ANALYTICS S-052 · SCENARIO-VERSION-SPEC §5).
 *
 * Three-pane layout:
 *   1. Top/Left: Scenario overlay time-series chart (2–3 scenarios × period) with [table↗] accessible data view.
 *   2. Bottom/Left: Waterfall attribution decomposition chart (Baseline -> Driver changes -> Scenario total)
 *      with [table↗] accessible data view. At bp-sm, panes stack and table view is the default.
 *   3. Right: Tabs for 'Sensitivity (Tornado)' and 'Goal Seek'.
 *      - Sensitivity: Driver × ±range tornado bars sorted by absolute impact; SENSITIVITY_OUT_OF_BOUNDS guard.
 *      - Goal Seek: Bounded bisection solver (target cell, target value, driver, bounds <= 100 iterations);
 *        GOAL_SEEK_NO_CONVERGE surfaces last value + iteration count in the panel that produced it.
 *
 * Footstrip: Model is NOT modified — [Apply to new Scenario ▸] is the ONLY write path.
 *
 * Accessibility & Money Rules:
 *   - role="region" on all 3 panes; role="tablist", role="tab", role="tabpanel" for tabs.
 *   - role="alert" for financial constraint errors; role="status" aria-live="polite" for loading skeletons.
 *   - Zero financial float (B3/B18-2): exact minor units and decimal strings only.
 */
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Download,
  HelpCircle,
  LineChart,
  RefreshCw,
  Sliders,
  Table as TableIcon,
  X,
} from "lucide-react";
import { Button, Input, StatePanel } from "@/components/ui";
import { useScenarioStore } from "@/stores/scenarios";
import { useWhatIfStore } from "@/stores/whatif";
import { activeModelId } from "@/stores/model";
import { call, type BridgeError } from "@/api/bridge";
import { formatMinor } from "@/utils/money";
import type { TornadoBar, WaterfallStep, WhatifSeries } from "@/api/schema";

type RightPaneTab = "sensitivity" | "goalseek";
type ViewMode = "chart" | "table";

const DEFAULT_SERIES_STYLES = [
  { stroke: "#2563EB", dash: "none", marker: "circle", label: "Baseline" },
  { stroke: "#16A34A", dash: "6 3", marker: "square", label: "Scenario A" },
  { stroke: "#D97706", dash: "2 2", marker: "triangle", label: "Scenario B" },
];

function exportWhatifCsv(series: WhatifSeries[]): void {
  const periods = series[0]?.points.map((p) => p.period_label) ?? [];
  const header = ["Scenario", "Version", ...periods];
  const rows = series.map((s) => [
    s.scenario_name,
    s.version_label ?? "Current",
    ...s.points.map((p) => String(p.value_minor)),
  ]);

  const csvContent = [header, ...rows]
    .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "whatif-overlay.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function TimeSeriesOverlayChart({
  series,
  currency = "USD",
}: {
  series: WhatifSeries[];
  currency?: string;
}) {
  const width = 560;
  const height = 240;
  const padLeft = 70;
  const padRight = 24;
  const padTop = 24;
  const padBottom = 36;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const pointsCount = series[0]?.points.length ?? 0;

  const allMinors = useMemo(() => {
    const vals: number[] = [];
    series.forEach((s) => s.points.forEach((p) => vals.push(p.value_minor)));
    return vals;
  }, [series]);

  const minMinor = allMinors.length > 0 ? Math.min(...allMinors) : 0;
  const maxMinor = allMinors.length > 0 ? Math.max(...allMinors) : 10000000;
  const range = maxMinor - minMinor || 1;

  const getX = useCallback(
    (index: number) => {
      if (pointsCount <= 1) return padLeft + plotWidth / 2;
      return padLeft + Math.floor((index / (pointsCount - 1)) * plotWidth);
    },
    [pointsCount, padLeft, plotWidth],
  );

  const getY = useCallback(
    (valMinor: number) => {
      const norm = (valMinor - minMinor) / range;
      return padTop + plotHeight - Math.floor(norm * plotHeight);
    },
    [minMinor, range, padTop, plotHeight],
  );

  const yTicks = [minMinor, Math.floor(minMinor + range / 2), maxMinor];

  return (
    <figure className="relative m-0 flex flex-col items-center">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Scenario overlay time-series chart showing scenario trajectory by period"
        className="h-auto w-full max-w-full overflow-visible font-sans text-xs select-none"
      >
        {yTicks.map((tick, idx) => {
          const yPos = getY(tick);
          return (
            <g key={`ytick-${idx}`}>
              <line
                x1={padLeft}
                y1={yPos}
                x2={width - padRight}
                y2={yPos}
                stroke="var(--color-oneborder)"
                strokeDasharray="3 3"
              />
              <text
                x={padLeft - 8}
                y={yPos + 4}
                textAnchor="end"
                className="fill-[var(--color-onetextmuted)] font-mono text-[10px]"
              >
                {formatMinor(tick, currency, { showInThousands: true })}
              </text>
            </g>
          );
        })}

        {series[0]?.points.map((p, idx) => {
          const xPos = getX(idx);
          return (
            <text
              key={`xlabel-${p.period_id}`}
              x={xPos}
              y={height - 12}
              textAnchor="middle"
              className="fill-[var(--color-onetextsecondary)] font-medium text-[11px]"
            >
              {p.period_label}
            </text>
          );
        })}

        {series.map((s, sIdx) => {
          const style = DEFAULT_SERIES_STYLES[sIdx % DEFAULT_SERIES_STYLES.length];
          const pathD = s.points
            .map((pt, pIdx) => `${pIdx === 0 ? "M" : "L"} ${getX(pIdx)} ${getY(pt.value_minor)}`)
            .join(" ");

          return (
            <g key={`series-${s.scenario_id}`}>
              <path
                d={pathD}
                fill="none"
                stroke={style.stroke}
                strokeWidth={2.5}
                strokeDasharray={style.dash}
              >
                <title>{`${s.scenario_name} trendline`}</title>
              </path>
              {s.points.map((pt, pIdx) => {
                const cx = getX(pIdx);
                const cy = getY(pt.value_minor);
                return (
                  <g key={`node-${s.scenario_id}-${pt.period_id}`}>
                    {style.marker === "circle" && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={4.5}
                        fill="var(--color-onesurface)"
                        stroke={style.stroke}
                        strokeWidth={2}
                      />
                    )}
                    {style.marker === "square" && (
                      <rect
                        x={cx - 4}
                        y={cy - 4}
                        width={8}
                        height={8}
                        fill="var(--color-onesurface)"
                        stroke={style.stroke}
                        strokeWidth={2}
                      />
                    )}
                    {style.marker === "triangle" && (
                      <polygon
                        points={`${cx},${cy - 5} ${cx + 4.5},${cy + 4} ${cx - 4.5},${cy + 4}`}
                        fill="var(--color-onesurface)"
                        stroke={style.stroke}
                        strokeWidth={2}
                      />
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      <figcaption className="mt-3 flex flex-wrap items-center justify-center gap-4 text-xs text-[var(--color-onetextsecondary)]">
        {series.map((s, sIdx) => {
          const style = DEFAULT_SERIES_STYLES[sIdx % DEFAULT_SERIES_STYLES.length];
          return (
            <div key={`legend-${s.scenario_id}`} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-5 rounded"
                style={{
                  backgroundColor: style.stroke,
                  borderTop: style.dash === "none" ? "none" : "2px dashed white",
                }}
                aria-hidden="true"
              />
              <span className="font-medium text-[var(--color-onetext)]">{s.scenario_name}</span>
              {s.version_label && (
                <span className="rounded bg-[var(--color-onesurfacealt)] px-1 py-0.5 text-[10px] text-[var(--color-onetextmuted)]">
                  {s.version_label}
                </span>
              )}
            </div>
          );
        })}
      </figcaption>
    </figure>
  );
}

function WaterfallDecompositionChart({
  waterfall,
  currency = "USD",
}: {
  waterfall: WaterfallStep[];
  currency?: string;
}) {
  const width = 560;
  const height = 240;
  const padLeft = 60;
  const padRight = 20;
  const padTop = 24;
  const padBottom = 48;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const barCount = waterfall.length;
  const stepWidth = Math.floor(plotWidth / (barCount || 1));
  const barWidth = Math.min(42, Math.floor(stepWidth * 0.65));

  const allValues = useMemo(() => {
    const list = [0];
    waterfall.forEach((step) => {
      list.push(step.cumulative_minor);
      list.push(step.cumulative_minor - step.delta_minor);
    });
    return list;
  }, [waterfall]);

  const minMinor = Math.min(0, ...allValues);
  const maxMinor = Math.max(1000000, ...allValues);
  const range = maxMinor - minMinor || 1;

  const getY = useCallback(
    (val: number) => {
      const norm = (val - minMinor) / range;
      return padTop + plotHeight - Math.floor(norm * plotHeight);
    },
    [minMinor, range, padTop, plotHeight],
  );

  return (
    <figure className="relative m-0 flex flex-col items-center">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Waterfall attribution chart from Baseline to Scenario Total"
        className="h-auto w-full max-w-full overflow-visible font-sans text-xs select-none"
      >
        <line
          x1={padLeft}
          y1={getY(0)}
          x2={width - padRight}
          y2={getY(0)}
          stroke="var(--color-oneborder)"
          strokeWidth={1.5}
        />

        {waterfall.map((step, idx) => {
          const centerX = padLeft + idx * stepWidth + Math.floor(stepWidth / 2);
          const barX = centerX - Math.floor(barWidth / 2);

          let barTop: number;
          let barHeight: number;
          let barFill = "var(--color-oneprimary)";

          if (step.kind === "baseline" || step.kind === "total") {
            const topVal = Math.max(0, step.cumulative_minor);
            const botVal = Math.min(0, step.cumulative_minor);
            barTop = getY(topVal);
            barHeight = Math.max(4, getY(botVal) - barTop);
            barFill = step.kind === "baseline" ? "#3B82F6" : "#2563EB";
          } else {
            const prev = step.cumulative_minor - step.delta_minor;
            const cur = step.cumulative_minor;
            const topVal = Math.max(prev, cur);
            const botVal = Math.min(prev, cur);
            barTop = getY(topVal);
            barHeight = Math.max(4, getY(botVal) - barTop);

            if (step.kind === "other_manual") {
              barFill = "#D97706";
            } else if (step.delta_minor >= 0) {
              barFill = "#16A34A";
            } else {
              barFill = "#DC2626";
            }
          }

          return (
            <g key={step.step_id}>
              {idx < barCount - 1 && (
                <line
                  x1={barX + barWidth}
                  y1={getY(step.cumulative_minor)}
                  x2={barX + stepWidth}
                  y2={getY(step.cumulative_minor)}
                  stroke="var(--color-onetextmuted)"
                  strokeDasharray="2 2"
                />
              )}

              <rect x={barX} y={barTop} width={barWidth} height={barHeight} rx={3} fill={barFill}>
                <title>{`${step.label}: ${step.delta_minor >= 0 ? "+" : ""}${step.delta_text}`}</title>
              </rect>

              {step.kind === "other_manual" && (
                <g transform={`translate(${centerX - 6}, ${barTop - 16})`}>
                  <title>Unallocated manual attribution step</title>
                  <circle cx={6} cy={6} r={7} fill="#FDE68A" stroke="#D97706" strokeWidth={1} />
                  <text
                    x={6}
                    y={10}
                    textAnchor="middle"
                    className="fill-[#92400E] font-bold text-[9px]"
                  >
                    !
                  </text>
                </g>
              )}

              <text
                x={centerX}
                y={height - 24}
                textAnchor="middle"
                className="fill-[var(--color-onetextsecondary)] font-medium text-[10px]"
              >
                {step.label.length > 14 ? `${step.label.slice(0, 12)}…` : step.label}
              </text>

              <text
                x={centerX}
                y={barTop - 4}
                textAnchor="middle"
                className={`font-mono text-[9px] font-semibold ${
                  step.kind === "other_manual"
                    ? "fill-[var(--color-onewarning)]"
                    : step.delta_minor < 0
                      ? "fill-[var(--color-oneerror)]"
                      : "fill-[var(--color-onetext)]"
                }`}
              >
                {step.kind === "baseline" || step.kind === "total"
                  ? formatMinor(step.cumulative_minor, currency, { showInThousands: true })
                  : `${step.delta_minor > 0 ? "+" : ""}${formatMinor(step.delta_minor, currency, { showInThousands: true })}`}
              </text>
            </g>
          );
        })}
      </svg>

      <figcaption className="mt-2 flex flex-wrap items-center justify-center gap-3 text-xs text-[var(--color-onetextsecondary)]">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#3B82F6]" aria-hidden="true" />
          <span>Anchor (Baseline/Total)</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#16A34A]" aria-hidden="true" />
          <span>+▲ Driver Favorable</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#DC2626]" aria-hidden="true" />
          <span>-▼ Driver Unfavorable</span>
        </span>
        <span className="flex items-center gap-1 font-medium text-[var(--color-onewarning)]">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#D97706]" aria-hidden="true" />
          <span>⚠ Other / Manual</span>
        </span>
      </figcaption>
    </figure>
  );
}

function TornadoSensitivityChart({
  tornadoBars,
  currency = "USD",
}: {
  tornadoBars: TornadoBar[];
  currency?: string;
}) {
  const width = 420;
  const rowHeight = 44;
  const headerHeight = 24;
  const height = headerHeight + tornadoBars.length * rowHeight;
  const leftLabelWidth = 140;
  const chartWidth = width - leftLabelWidth - 20;
  const centerX = leftLabelWidth + Math.floor(chartWidth / 2);

  const maxSwing = useMemo(() => {
    let m = 1;
    tornadoBars.forEach((b) => {
      const half = Math.floor(b.swing_minor / 2);
      if (half > m) m = half;
    });
    return m;
  }, [tornadoBars]);

  return (
    <figure className="relative m-0 flex flex-col">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Tornado sensitivity chart sorted by absolute driver swing"
        className="h-auto w-full max-w-full overflow-visible font-sans text-xs select-none"
      >
        <line
          x1={centerX}
          y1={headerHeight}
          x2={centerX}
          y2={height}
          stroke="var(--color-oneborder)"
          strokeWidth={1.5}
          strokeDasharray="3 3"
        />

        <text
          x={centerX}
          y={headerHeight - 8}
          textAnchor="middle"
          className="fill-[var(--color-onetextmuted)] text-[10px] font-medium"
        >
          Base Impact
        </text>

        {tornadoBars.map((bar, idx) => {
          const yPos = headerHeight + idx * rowHeight + 8;
          const halfSwing = Math.floor(bar.swing_minor / 2);
          const wingPixels = Math.floor((halfSwing / maxSwing) * (chartWidth / 2 - 16));

          return (
            <g key={bar.target_line_id}>
              <text
                x={leftLabelWidth - 8}
                y={yPos + 14}
                textAnchor="end"
                className="fill-[var(--color-onetext)] font-medium text-[11px]"
              >
                {bar.target_line_name.length > 18
                  ? `${bar.target_line_name.slice(0, 16)}…`
                  : bar.target_line_name}
              </text>

              <rect
                x={centerX - wingPixels}
                y={yPos}
                width={wingPixels}
                height={20}
                rx={2}
                fill="#DC2626"
              >
                <title>{`Low wing ${bar.low_value}`}</title>
              </rect>

              <rect x={centerX} y={yPos} width={wingPixels} height={20} rx={2} fill="#16A34A">
                <title>{`High wing ${bar.high_value}`}</title>
              </rect>

              <text
                x={centerX + wingPixels + 6}
                y={yPos + 14}
                className="fill-[var(--color-onetextsecondary)] font-mono text-[10px]"
              >
                Δ {formatMinor(bar.swing_minor, currency, { showInThousands: true })}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function ApplyScenarioDialog({
  isOpen,
  onClose,
  onSuccess,
  baseScenarioName,
  baseScenarioId,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newId: string) => void;
  baseScenarioName: string;
  baseScenarioId: string;
}) {
  const [name, setName] = useState(`What-If: ${baseScenarioName} Variation`);
  const [reason, setReason] = useState("Applying What-If driver adjustments to isolated draft");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!name.trim()) {
      setDialogError("Scenario name is required.");
      return;
    }
    setBusy(true);
    setDialogError(null);
    try {
      const activeModel = activeModelId();
      const res = (await call("scenario.duplicate", {
        model_id: activeModel,
        name: name.trim(),
        base_id: baseScenarioId || undefined,
      })) as { data: { scenario_id: string } } | { scenario_id: string };

      const resRecord = res as Record<string, unknown>;
      const newId =
        (resRecord.scenario_id as string | undefined) ??
        (resRecord.id as string | undefined) ??
        ((resRecord.data as Record<string, unknown> | undefined)?.scenario_id as
          | string
          | undefined) ??
        ((resRecord.data as Record<string, unknown> | undefined)?.id as string | undefined);
      if (newId) {
        onSuccess(newId);
        onClose();
      } else {
        setDialogError("Failed to create scenario.");
      }
    } catch (err) {
      const be = err as BridgeError;
      setDialogError(be?.userMessage ?? "An error occurred while creating the Scenario.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="apply-scenario-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--color-oneborder)] pb-3">
          <h2
            id="apply-scenario-title"
            className="text-base font-semibold text-[var(--color-onetext)]"
          >
            Apply to New Scenario
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={busy}
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className="mt-3 text-xs text-[var(--color-onetextsecondary)]">
          The working Model and Baseline remain protected and untouched. This action creates a new
          isolated Draft Scenario containing your What-If parameter variations.
        </p>

        {dialogError && (
          <div
            role="alert"
            className="mt-3 rounded-md bg-[var(--color-oneerror)]/10 p-2.5 text-xs text-[var(--color-oneerror)]"
          >
            {dialogError}
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3">
          <Input
            id="apply-scenario-name"
            label="New Scenario Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            placeholder="e.g. What-If Upside 2027"
            required
          />

          <div className="flex flex-col gap-1 text-xs font-medium text-[var(--color-onetext)]">
            <label htmlFor="apply-base-template">Base Template</label>
            <input
              id="apply-base-template"
              type="text"
              readOnly
              disabled
              value={baseScenarioName}
              className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] px-3 py-1.5 text-xs text-[var(--color-onetextmuted)]"
            />
          </div>

          <div className="flex flex-col gap-1 text-xs font-medium text-[var(--color-onetext)]">
            <label htmlFor="apply-audit-note">Written Justification (Audit Note)</label>
            <textarea
              id="apply-audit-note"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-2 text-xs text-[var(--color-onetext)] focus:outline-none focus:ring-2 focus:ring-[var(--color-oneprimary)]"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 border-t border-[var(--color-oneborder)] pt-4">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={busy}>
            {busy ? "Applying…" : "Create Scenario ▸"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function WhatIfPage() {
  const scenarios = useScenarioStore((s) => s.scenarios);
  const scenarioStatus = useScenarioStore((s) => s.status);
  const loadScenarios = useScenarioStore((s) => s.load);

  const status = useWhatIfStore((s) => s.status);
  const error = useWhatIfStore((s) => s.error);
  const overlayData = useWhatIfStore((s) => s.overlayData);
  const sensitivityData = useWhatIfStore((s) => s.sensitivityData);
  const goalSeekData = useWhatIfStore((s) => s.goalSeekData);

  const scenarioIds = useWhatIfStore((s) => s.scenarioIds);
  const setScenarioIds = useWhatIfStore((s) => s.setScenarioIds);
  const sensitivityDriverId = useWhatIfStore((s) => s.sensitivityDriverId);
  const setSensitivityDriverId = useWhatIfStore((s) => s.setSensitivityDriverId);
  const sensitivityLo = useWhatIfStore((s) => s.sensitivityLo);
  const sensitivityHi = useWhatIfStore((s) => s.sensitivityHi);
  const setSensitivityBounds = useWhatIfStore((s) => s.setSensitivityBounds);
  const sensitivitySteps = useWhatIfStore((s) => s.sensitivitySteps);
  const setSensitivitySteps = useWhatIfStore((s) => s.setSensitivitySteps);

  const goalSeekTargetCell = useWhatIfStore((s) => s.goalSeekTargetCell);
  const setGoalSeekTargetCell = useWhatIfStore((s) => s.setGoalSeekTargetCell);
  const goalSeekTargetValue = useWhatIfStore((s) => s.goalSeekTargetValue);
  const setGoalSeekTargetValue = useWhatIfStore((s) => s.setGoalSeekTargetValue);
  const goalSeekDriverId = useWhatIfStore((s) => s.goalSeekDriverId);
  const setGoalSeekDriverId = useWhatIfStore((s) => s.setGoalSeekDriverId);

  const runOverlay = useWhatIfStore((s) => s.runOverlay);
  const runSensitivity = useWhatIfStore((s) => s.runSensitivity);
  const runGoalSeek = useWhatIfStore((s) => s.runGoalSeek);
  const retry = useWhatIfStore((s) => s.retry);

  const [overlayViewMode, setOverlayViewMode] = useState<ViewMode>("chart");
  const [waterfallViewMode, setWaterfallViewMode] = useState<ViewMode>("chart");
  const [rightTab, setRightTab] = useState<RightPaneTab>("sensitivity");
  const [isApplyOpen, setIsApplyOpen] = useState(false);
  const [appliedScenarioId, setAppliedScenarioId] = useState<string | null>(null);

  useEffect(() => {
    if (scenarioStatus === "loading") void loadScenarios();
  }, [scenarioStatus, loadScenarios]);

  useEffect(() => {
    if (scenarios.length > 0 && scenarioIds.length === 0) {
      setScenarioIds(scenarios.slice(0, 2).map((s) => s.id));
    }
  }, [scenarios, scenarioIds.length, setScenarioIds]);

  useEffect(() => {
    if (scenarioIds.length > 0 && status === "empty") {
      void runOverlay();
    }
  }, [scenarioIds.length, status, runOverlay]);

  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setRightTab((curr) => (curr === "sensitivity" ? "goalseek" : "sensitivity"));
    }
  };

  if (status === "loading") {
    return (
      <main className="flex flex-col gap-6 p-6" role="main">
        <header className="flex items-center justify-between">
          <div className="h-7 w-64 animate-pulse rounded bg-[var(--color-onesurfacealt)]" />
          <div className="h-9 w-32 animate-pulse rounded bg-[var(--color-onesurfacealt)]" />
        </header>
        <div
          role="status"
          aria-live="polite"
          className="grid grid-cols-1 gap-6 lg:grid-cols-12"
          aria-label="Loading What-If models and sensitivity simulation"
        >
          <div className="flex flex-col gap-6 lg:col-span-8">
            <div className="h-72 animate-pulse rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-6" />
            <div className="h-72 animate-pulse rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-6" />
          </div>
          <div className="h-[600px] animate-pulse rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-6 lg:col-span-4" />
        </div>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="flex flex-col gap-6 p-6" role="main">
        <h1 className="text-xl font-bold text-[var(--color-onetext)]">What-If & Sensitivity</h1>
        <StatePanel
          state="error"
          message={error?.userMessage ?? "Failed to compute What-If scenario overlay."}
          errorCode={error?.code}
          onRetry={retry}
        />
      </main>
    );
  }

  const primaryScenario = scenarios.find((s) => s.id === scenarioIds[0]) ?? scenarios[0];
  const primaryScenarioName = primaryScenario?.name ?? "Baseline";

  return (
    <main className="flex flex-col gap-6 pb-24" role="main">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-oneborder)] pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-onetext)]">
            What-If & Sensitivity
          </h1>
          <p className="mt-1 text-xs text-[var(--color-onetextsecondary)]">
            Scenario time-series overlay, waterfall driver attribution, sensitivity tornado, and
            bounded goal seek.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-[var(--color-onetextsecondary)]">
            <span>Overlay:</span>
            <select
              value={scenarioIds[0] ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                setScenarioIds(val ? [val] : []);
                void runOverlay({ scenario_ids: val ? [val] : [] });
              }}
              aria-label="Select primary scenario for overlay"
              className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2.5 py-1.5 text-xs text-[var(--color-onetext)] focus:outline-none focus:ring-2 focus:ring-[var(--color-oneprimary)]"
            >
              {scenarios.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.name} ({sc.kind})
                </option>
              ))}
            </select>
          </label>

          {overlayData && (
            <Button variant="ghost" size="sm" onClick={() => exportWhatifCsv(overlayData.series)}>
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Export CSV</span>
            </Button>
          )}

          <Button size="sm" onClick={() => runOverlay()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>Recompute</span>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:col-span-8">
          <section
            aria-label="Scenario Overlay Time-Series"
            className="rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-5 shadow-xs"
          >
            <div className="mb-4 flex items-center justify-between border-b border-[var(--color-oneborder)] pb-3">
              <div className="flex items-center gap-2">
                <LineChart className="h-4 w-4 text-[var(--color-oneprimary)]" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-[var(--color-onetext)]">
                  Scenario Overlay (Time-Series)
                </h2>
                {overlayData && (
                  <span className="rounded-full bg-[var(--color-onesurfacealt)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-onetextsecondary)]">
                    {overlayData.series.length} Scenarios
                  </span>
                )}
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOverlayViewMode((m) => (m === "chart" ? "table" : "chart"))}
                aria-label={
                  overlayViewMode === "chart"
                    ? "Switch scenario overlay to accessible table view [table↗]"
                    : "Switch scenario overlay to graphical chart view"
                }
              >
                {overlayViewMode === "chart" ? (
                  <>
                    <TableIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="text-xs font-medium">[table↗]</span>
                  </>
                ) : (
                  <>
                    <LineChart className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="text-xs font-medium">[chart]</span>
                  </>
                )}
              </Button>
            </div>

            {overlayData && overlayData.series.length > 0 ? (
              overlayViewMode === "chart" ? (
                <TimeSeriesOverlayChart series={overlayData.series} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <caption className="sr-only">
                      Scenario Overlay data table comparing values across periods
                    </caption>
                    <thead>
                      <tr className="border-b border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] text-[var(--color-onetextsecondary)]">
                        <th scope="col" className="px-3 py-2 font-medium">
                          Period
                        </th>
                        {overlayData.series.map((s) => (
                          <th
                            key={s.scenario_id}
                            scope="col"
                            className="px-3 py-2 text-right font-medium"
                          >
                            {s.scenario_name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {overlayData.series[0]?.points.map((pt, pIdx) => (
                        <tr
                          key={pt.period_id}
                          className="border-b border-[var(--color-oneborder)] last:border-0 hover:bg-[var(--color-onesurfacealt)]"
                        >
                          <th
                            scope="row"
                            className="px-3 py-2 font-mono font-medium text-[var(--color-onetext)]"
                          >
                            {pt.period_label}
                          </th>
                          {overlayData.series.map((s) => (
                            <td
                              key={`${s.scenario_id}-${pt.period_id}`}
                              className="px-3 py-2 text-right font-mono"
                            >
                              {formatMinor(s.points[pIdx]?.value_minor ?? 0, "USD")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <div className="flex h-48 flex-col items-center justify-center rounded border border-dashed border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-4 text-center">
                <BarChart3
                  aria-hidden="true"
                  className="h-8 w-8 text-[var(--color-onetextsecondary)]"
                />
                <p className="mt-2 text-xs font-medium text-[var(--color-onetext)]">
                  No scenario overlay loaded
                </p>
                <p className="text-[11px] text-[var(--color-onetextsecondary)]">
                  Select scenarios to display trajectory
                </p>
              </div>
            )}
          </section>

          <section
            aria-label="Waterfall Attribution Decomposition"
            className="rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-5 shadow-xs"
          >
            <div className="mb-4 flex items-center justify-between border-b border-[var(--color-oneborder)] pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-[var(--color-oneprimary)]" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-[var(--color-onetext)]">
                  Waterfall Attribution Bridge
                </h2>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setWaterfallViewMode((m) => (m === "chart" ? "table" : "chart"))}
                aria-label={
                  waterfallViewMode === "chart"
                    ? "Switch waterfall attribution to accessible table view [table↗]"
                    : "Switch waterfall attribution to graphical chart view"
                }
              >
                {waterfallViewMode === "chart" ? (
                  <>
                    <TableIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="text-xs font-medium">[table↗]</span>
                  </>
                ) : (
                  <>
                    <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="text-xs font-medium">[chart]</span>
                  </>
                )}
              </Button>
            </div>

            {overlayData && overlayData.waterfall.length > 0 ? (
              waterfallViewMode === "chart" ? (
                <WaterfallDecompositionChart waterfall={overlayData.waterfall} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <caption className="sr-only">
                      Waterfall Attribution Bridge breaking down deltas from Baseline to Scenario
                      Total
                    </caption>
                    <thead>
                      <tr className="border-b border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] text-[var(--color-onetextsecondary)]">
                        <th scope="col" className="px-3 py-2 font-medium">
                          Attribution Step
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Driver / Kind
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          Delta
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          Cumulative
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {overlayData.waterfall.map((step) => (
                        <tr
                          key={step.step_id}
                          className="border-b border-[var(--color-oneborder)] last:border-0 hover:bg-[var(--color-onesurfacealt)]"
                        >
                          <th
                            scope="row"
                            className="px-3 py-2 font-medium text-[var(--color-onetext)]"
                          >
                            {step.label}
                          </th>
                          <td className="px-3 py-2 text-[var(--color-onetextsecondary)]">
                            {step.kind === "other_manual" ? (
                              <span className="inline-flex items-center gap-1 rounded bg-[var(--color-onewarning)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-onewarning)]">
                                ⚠ other/manual
                              </span>
                            ) : (
                              step.kind
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-medium">
                            {step.delta_minor === 0
                              ? "—"
                              : `${step.delta_minor > 0 ? "+" : ""}${formatMinor(step.delta_minor, "USD")}`}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-[var(--color-onetext)]">
                            {formatMinor(step.cumulative_minor, "USD")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <div className="flex h-48 flex-col items-center justify-center rounded border border-dashed border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-4 text-center">
                <Sliders
                  aria-hidden="true"
                  className="h-8 w-8 text-[var(--color-onetextsecondary)]"
                />
                <p className="mt-2 text-xs font-medium text-[var(--color-onetext)]">
                  No waterfall breakdown available
                </p>
                <p className="text-[11px] text-[var(--color-onetextsecondary)]">
                  Select multiple scenarios to calculate driver attribution
                </p>
              </div>
            )}
          </section>
        </div>

        <div className="lg:col-span-4">
          <section
            aria-label="Sensitivity and Goal Seek Analysis"
            className="rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-5 shadow-xs"
          >
            <div
              role="tablist"
              aria-label="Simulation tuning tools"
              className="flex items-center gap-1 rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-1"
            >
              <button
                type="button"
                role="tab"
                id="tab-sensitivity"
                aria-selected={rightTab === "sensitivity"}
                aria-controls="tabpanel-sensitivity"
                tabIndex={rightTab === "sensitivity" ? 0 : -1}
                onClick={() => setRightTab("sensitivity")}
                onKeyDown={handleTabKeyDown}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                  rightTab === "sensitivity"
                    ? "bg-[var(--color-onesurface)] text-[var(--color-oneprimary)] shadow-xs"
                    : "text-[var(--color-onetextsecondary)] hover:text-[var(--color-onetext)]"
                }`}
              >
                Sensitivity (Tornado)
              </button>
              <button
                type="button"
                role="tab"
                id="tab-goalseek"
                aria-selected={rightTab === "goalseek"}
                aria-controls="tabpanel-goalseek"
                tabIndex={rightTab === "goalseek" ? 0 : -1}
                onClick={() => setRightTab("goalseek")}
                onKeyDown={handleTabKeyDown}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                  rightTab === "goalseek"
                    ? "bg-[var(--color-onesurface)] text-[var(--color-oneprimary)] shadow-xs"
                    : "text-[var(--color-onetextsecondary)] hover:text-[var(--color-onetext)]"
                }`}
              >
                Goal Seek
              </button>
            </div>

            {rightTab === "sensitivity" && (
              <div
                role="tabpanel"
                id="tabpanel-sensitivity"
                aria-labelledby="tab-sensitivity"
                className="mt-4 flex flex-col gap-4"
              >
                <div className="flex flex-col gap-3">
                  <Input
                    id="sensitivity-driver-id"
                    label="Driver to Vary"
                    value={sensitivityDriverId ?? "dr-price"}
                    onChange={(e) => setSensitivityDriverId(e.target.value)}
                    placeholder="e.g. dr-price"
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      id="sensitivity-bound-low"
                      label="Low Bound (e.g. -0.25)"
                      value={sensitivityLo}
                      onChange={(e) => setSensitivityBounds(e.target.value, sensitivityHi)}
                    />
                    <Input
                      id="sensitivity-bound-high"
                      label="High Bound (e.g. 0.25)"
                      value={sensitivityHi}
                      onChange={(e) => setSensitivityBounds(sensitivityLo, e.target.value)}
                    />
                  </div>

                  <Input
                    id="sensitivity-steps"
                    label="Steps (2..100)"
                    type="number"
                    value={String(sensitivitySteps)}
                    onChange={(e) => setSensitivitySteps(parseInt(e.target.value, 10) || 5)}
                  />

                  <Button
                    size="sm"
                    onClick={() => {
                      void runSensitivity({
                        driver_id: sensitivityDriverId ?? "dr-price",
                        lo: sensitivityLo,
                        hi: sensitivityHi,
                        steps: sensitivitySteps,
                        target_lines: ["ln-rev", "ln-ebitda", "ln-cogs"],
                      });
                    }}
                  >
                    Calculate Tornado
                  </Button>
                </div>

                {sensitivityData && sensitivityData.tornado.length > 0 ? (
                  <div className="mt-4 border-t border-[var(--color-oneborder)] pt-4">
                    <h3 className="mb-2 text-xs font-semibold text-[var(--color-onetext)]">
                      Tornado Bars (Ranked by Absolute Swing)
                    </h3>
                    <TornadoSensitivityChart tornadoBars={sensitivityData.tornado} />
                  </div>
                ) : (
                  <div className="mt-2">
                    <StatePanel
                      state="empty"
                      message="Choose a driver to vary"
                      actionLabel="Calculate Tornado"
                      onAction={() => {
                        void runSensitivity({
                          driver_id: sensitivityDriverId ?? "dr-price",
                          lo: sensitivityLo,
                          hi: sensitivityHi,
                          steps: sensitivitySteps,
                          target_lines: ["ln-rev", "ln-ebitda", "ln-cogs"],
                        });
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {rightTab === "goalseek" && (
              <div
                role="tabpanel"
                id="tabpanel-goalseek"
                aria-labelledby="tab-goalseek"
                className="mt-4 flex flex-col gap-4"
              >
                <div className="flex flex-col gap-3">
                  <Input
                    id="goalseek-target-cell"
                    label="Target Cell"
                    value={goalSeekTargetCell || "ln-rev"}
                    onChange={(e) => setGoalSeekTargetCell(e.target.value)}
                    placeholder="e.g. ln-rev"
                  />

                  <Input
                    id="goalseek-target-value"
                    label="Target Value (Decimal String)"
                    value={goalSeekTargetValue || "3000000.00"}
                    onChange={(e) => setGoalSeekTargetValue(e.target.value)}
                    placeholder="e.g. 3000000.00"
                  />

                  <Input
                    id="goalseek-driver-solve"
                    label="Driver to Solve"
                    value={goalSeekDriverId || "dr-reps"}
                    onChange={(e) => setGoalSeekDriverId(e.target.value)}
                    placeholder="e.g. dr-reps"
                  />

                  <Button
                    size="sm"
                    onClick={() => {
                      void runGoalSeek({
                        target_cell: goalSeekTargetCell || "ln-rev",
                        target_value: goalSeekTargetValue || "3000000.00",
                        driver_id: goalSeekDriverId || "dr-reps",
                        bounds: ["10", "150"],
                      });
                    }}
                  >
                    Solve via Bisection (≤100 iter)
                  </Button>
                </div>

                {goalSeekData && (
                  <div
                    role="status"
                    className="mt-4 rounded-lg border border-[var(--color-onefavorable)] bg-[var(--color-onesurfacealt)] p-4 text-xs"
                  >
                    <div className="flex items-center gap-2 font-semibold text-[var(--color-onefavorable)]">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      <span>Converged in {goalSeekData.iterations} iterations</span>
                    </div>
                    <div className="mt-2 font-mono text-sm font-bold text-[var(--color-onetext)]">
                      Solved Driver Value: {goalSeekData.driver_value}
                    </div>
                    {goalSeekData.last_target_value && (
                      <div className="mt-1 text-[11px] text-[var(--color-onetextsecondary)]">
                        Target Value: {goalSeekData.last_target_value}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      <footer
        aria-label="What-If Audit and Safety Footstrip"
        className="fixed right-0 bottom-0 left-0 z-20 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-6 py-3 shadow-lg"
      >
        <div className="flex items-center gap-2 text-xs text-[var(--color-onetextsecondary)]">
          <HelpCircle className="h-4 w-4 text-[var(--color-onewarning)]" aria-hidden="true" />
          <span className="font-medium text-[var(--color-onetext)]">Model is NOT modified</span>
          <span className="hidden sm:inline">
            — [Apply to new Scenario ▸] is the ONLY write path.
          </span>
        </div>

        <div className="flex items-center gap-3">
          {appliedScenarioId && (
            <span className="text-xs font-semibold text-[var(--color-onefavorable)]">
              ✓ Scenario created
            </span>
          )}
          <Button size="sm" onClick={() => setIsApplyOpen(true)}>
            <span>Apply to new Scenario</span>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </footer>

      <ApplyScenarioDialog
        isOpen={isApplyOpen}
        onClose={() => setIsApplyOpen(false)}
        onSuccess={(newId) => setAppliedScenarioId(newId)}
        baseScenarioName={primaryScenarioName}
        baseScenarioId={scenarioIds[0] ?? ""}
      />
    </main>
  );
}
