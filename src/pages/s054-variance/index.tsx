/**
 * S-054 Variance & Attribution Screen (F-024 · M5-1 · M5-2 · SCREENS-SPEC S-054 · WIREFRAMES-ANALYTICS S-054).
 *
 * Core Features:
 *   - Toolbar with period, BU, and account filters, comparison picker (Budget vs Forecast vs Commit), and 3-Way toggle (Plan/Commit/Actuals).
 *   - Table rendering:
 *       * Account, Actual, Plan, Δ$, Δ%, F/U badge (with aria-label, text label, and chevron icon — never color alone)
 *       * 3-Way column view (when enabled: Plan, Commit, Actual, Δ$ vs Plan, Δ$ vs Commit)
 *       * Attribution decomposition columns: Volume, Price, Mix, FX, Efficiency
 *       * Reason Code picker & interactive note modal/popover
 *       * Waterfall chart view toggle (Plan → Drivers/Attribution → Actual)
 *   - 5 canonical UI states:
 *       * loading: skeleton / role="status"
 *       * empty: "No Actuals yet" (Plan-Only state) / "Nothing to compare"
 *       * error: typed errors e.g. VARIANCE_SOURCE_MIXED, VARIANCE_NO_ATTRIBUTION_DATA with retry / inline notification
 *       * success: identical or clean variance run confirmation
 *       * populated: interactive data table + waterfall chart view + reason codes
 *   - Strict Money: i64 minor units and Decimal string display formatting only (no floats / Math.round / toFixed).
 *   - WCAG 2.2 AA compliant with ARIA roles, captions, accessible data representations, and vitest-axe support.
 */

import { useCallback, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Download,
  Info,
  MessageSquare,
  Minus,
  Table as TableIcon,
  Tag,
  X,
} from "lucide-react";
import { Button, StatePanel } from "@/components/ui";
import { formatMinor, formatPercent } from "@/utils/money";

export type VarianceScreenState = "loading" | "empty" | "error" | "success" | "populated";

export type ComparisonTarget = "budget" | "forecast" | "commit";

export type ReasonCode =
  | "VOLUME_SURGE"
  | "PRICE_RENEGOTIATION"
  | "SUPPLIER_DISRUPTION"
  | "FX_HEADWIND"
  | "LABOR_EFFICIENCY"
  | "PRODUCT_MIX_SHIFT"
  | "ONE_OFF_TIMING"
  | "UNEXPLAINED";

export interface VarianceAttributionMinor {
  volume: number | null;
  price: number | null;
  mix: number | null;
  fx: number | null;
  efficiency: number | null;
  is_attributable: boolean;
}

export interface VarianceRow {
  account_id: string;
  account_code: string;
  account_name: string;
  category: "revenue" | "cogs" | "opex" | "capex";
  business_unit: string;
  period_id: string;
  period_label: string;
  // All monetary values in exact i64 minor units:
  actual_minor: number | null;
  plan_minor: number;
  commit_minor?: number;
  delta_minor: number | null;
  delta_pct: number | null;
  // Favorable vs Unfavorable
  direction: "favorable" | "unfavorable" | "neutral";
  // Decomposition
  attribution: VarianceAttributionMinor;
  // Commentary
  reason_code: ReasonCode | null;
  note: string | null;
}

export interface VarianceFilterState {
  period: string;
  businessUnit: string;
  accountCategory: string;
  comparisonTarget: ComparisonTarget;
  showThreeWay: boolean;
  viewMode: "table" | "waterfall";
}

export interface VarianceErrorDetail {
  code: string;
  userMessage: string;
  httpStatus?: number;
  retryable?: boolean;
}

const REASON_CODE_OPTIONS: { code: ReasonCode; label: string; description: string }[] = [
  { code: "VOLUME_SURGE", label: "Volume Surge", description: "Unexpected high demand or order intake" },
  { code: "PRICE_RENEGOTIATION", label: "Price Change", description: "Contract pricing adjustment or inflation pass-through" },
  { code: "PRODUCT_MIX_SHIFT", label: "Mix Shift", description: "Higher/lower proportion of high-margin offerings" },
  { code: "FX_HEADWIND", label: "FX Movement", description: "Currency rate fluctuation vs plan exchange rates" },
  { code: "LABOR_EFFICIENCY", label: "Efficiency Gain/Loss", description: "Productivity, overtime, or operational waste delta" },
  { code: "SUPPLIER_DISRUPTION", label: "Supply Chain", description: "Input price surge or freight expedited charges" },
  { code: "ONE_OFF_TIMING", label: "Timing Difference", description: "Billing or project delivery milestone shifted across periods" },
  { code: "UNEXPLAINED", label: "Unexplained / Pending", description: "Under investigation by FP&A and business unit lead" },
];

/** F/U Badge with aria-label, text label, and distinct icon (never color alone - B11 / WCAG 1.4.1). */
export function VarianceDirectionBadge({
  direction,
}: {
  direction: "favorable" | "unfavorable" | "neutral";
}) {
  if (direction === "favorable") {
    return (
      <span
        role="status"
        aria-label="Favorable variance"
        className="inline-flex items-center gap-1 rounded bg-[var(--color-onefavorable)]/10 px-1.5 py-0.5 text-xs font-semibold text-[var(--color-onefavorable)] border border-[var(--color-onefavorable)]/30"
      >
        <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span>F</span>
      </span>
    );
  }

  if (direction === "unfavorable") {
    return (
      <span
        role="status"
        aria-label="Unfavorable variance"
        className="inline-flex items-center gap-1 rounded bg-[var(--color-onerror)]/10 px-1.5 py-0.5 text-xs font-semibold text-[var(--color-onerror)] border border-[var(--color-onerror)]/30"
      >
        <ArrowDownRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span>U</span>
      </span>
    );
  }

  return (
    <span
      role="status"
      aria-label="Neutral variance"
      className="inline-flex items-center gap-1 rounded bg-[var(--color-onesurfacealt)] px-1.5 py-0.5 text-xs font-medium text-[var(--color-onetextsecondary)] border border-[var(--color-oneborder)]"
    >
      <Minus aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span>—</span>
    </span>
  );
}

/** Render money minor unit or em-dash */
function renderMinor(minor: number | null | undefined, currency = "USD"): string {
  if (minor == null) return "—";
  return formatMinor(minor, currency);
}

/** Export table rows as standard CSV */
function exportVarianceCsv(rows: VarianceRow[], showThreeWay: boolean): void {
  const headers = [
    "Period",
    "Business Unit",
    "Account Code",
    "Account Name",
    "Actual (minor)",
    "Plan (minor)",
    ...(showThreeWay ? ["Commit (minor)"] : []),
    "Delta $ (minor)",
    "Delta %",
    "F/U",
    "Volume (minor)",
    "Price (minor)",
    "Mix (minor)",
    "FX (minor)",
    "Efficiency (minor)",
    "Reason Code",
    "Note",
  ];

  const lines = rows.map((r) => [
    r.period_label,
    r.business_unit,
    r.account_code,
    r.account_name,
    String(r.actual_minor ?? ""),
    String(r.plan_minor),
    ...(showThreeWay ? [String(r.commit_minor ?? "")] : []),
    String(r.delta_minor ?? ""),
    formatPercent(r.delta_pct),
    r.direction === "favorable" ? "F" : r.direction === "unfavorable" ? "U" : "—",
    r.attribution.is_attributable && r.attribution.volume != null ? String(r.attribution.volume) : "N/A",
    r.attribution.is_attributable && r.attribution.price != null ? String(r.attribution.price) : "N/A",
    r.attribution.is_attributable && r.attribution.mix != null ? String(r.attribution.mix) : "N/A",
    r.attribution.is_attributable && r.attribution.fx != null ? String(r.attribution.fx) : "N/A",
    r.attribution.is_attributable && r.attribution.efficiency != null ? String(r.attribution.efficiency) : "N/A",
    r.reason_code ?? "",
    r.note ?? "",
  ]);

  const csvContent = [headers, ...lines]
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "variance-attribution.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/** SVG Waterfall Chart View (Plan -> Attribution Drivers -> Actual) */
export function VarianceWaterfallChart({
  rows,
  currency = "USD",
}: {
  rows: VarianceRow[];
  currency?: string;
}) {
  // Sum up totals across filtered rows for overall bridge
  const totals = useMemo(() => {
    let plan = 0;
    let actual = 0;
    let vol = 0;
    let price = 0;
    let mix = 0;
    let fx = 0;
    let eff = 0;

    for (const r of rows) {
      plan += r.plan_minor;
      if (r.actual_minor != null) actual += r.actual_minor;
      if (r.attribution.is_attributable) {
        if (r.attribution.volume) vol += r.attribution.volume;
        if (r.attribution.price) price += r.attribution.price;
        if (r.attribution.mix) mix += r.attribution.mix;
        if (r.attribution.fx) fx += r.attribution.fx;
        if (r.attribution.efficiency) eff += r.attribution.efficiency;
      }
    }
    const other = actual - (plan + vol + price + mix + fx + eff);
    return { plan, actual, vol, price, mix, fx, eff, other };
  }, [rows]);

  const steps = useMemo(() => {
    const list: { label: string; delta: number; cumulative: number; isTotal?: boolean }[] = [];
    let running = totals.plan;
    list.push({ label: "Plan Start", delta: totals.plan, cumulative: running, isTotal: true });

    const drivers = [
      { label: "Volume", delta: totals.vol },
      { label: "Price", delta: totals.price },
      { label: "Mix", delta: totals.mix },
      { label: "FX", delta: totals.fx },
      { label: "Efficiency", delta: totals.eff },
      { label: "Other / Unattributed", delta: totals.other },
    ];

    for (const d of drivers) {
      if (d.delta !== 0) {
        running += d.delta;
        list.push({ label: d.label, delta: d.delta, cumulative: running, isTotal: false });
      }
    }

    list.push({ label: "Actual End", delta: totals.actual, cumulative: totals.actual, isTotal: true });
    return list;
  }, [totals]);

  const width = 680;
  const height = 260;
  const padLeft = 70;
  const padRight = 30;
  const padTop = 30;
  const padBottom = 50;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const barCount = steps.length;
  const stepWidth = Math.floor(plotWidth / (barCount || 1));
  const barWidth = Math.min(48, Math.floor(stepWidth * 0.65));

  const allVals = steps.flatMap((s) => [s.cumulative, s.cumulative - s.delta, 0]);
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals, 100000);
  const range = maxVal - minVal || 1;

  const getY = (val: number) => {
    const ratio = (val - minVal) / range;
    return padTop + plotHeight - Math.floor(ratio * plotHeight);
  };

  return (
    <figure className="relative flex flex-col items-center rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-4 shadow-sm">
      <figcaption className="w-full text-sm font-semibold text-[var(--color-onetext)] mb-2 flex items-center justify-between">
        <span>Attribution Waterfall Bridge (Plan to Actual)</span>
        <span className="text-xs font-normal text-[var(--color-onetextsecondary)]">
          Net Variance: {renderMinor(totals.actual - totals.plan, currency)}
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Waterfall attribution bridge showing walk from Plan to Actual across Volume, Price, Mix, FX, and Efficiency"
        className="w-full max-w-2xl overflow-visible text-xs select-none"
      >
        {/* Zero baseline */}
        <line
          x1={padLeft}
          y1={getY(0)}
          x2={width - padRight}
          y2={getY(0)}
          stroke="var(--color-oneborder)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />

        {steps.map((step, idx) => {
          const centerX = padLeft + idx * stepWidth + Math.floor(stepWidth / 2);
          const barX = centerX - Math.floor(barWidth / 2);

          let barTop: number;
          let barHeight: number;
          let fill = "var(--color-oneprimary)";

          if (step.isTotal) {
            const topVal = Math.max(0, step.cumulative);
            const botVal = Math.min(0, step.cumulative);
            barTop = getY(topVal);
            barHeight = Math.max(4, getY(botVal) - barTop);
            fill = "#2563EB";
          } else {
            const prev = step.cumulative - step.delta;
            const cur = step.cumulative;
            const topVal = Math.max(prev, cur);
            const botVal = Math.min(prev, cur);
            barTop = getY(topVal);
            barHeight = Math.max(4, getY(botVal) - barTop);
            fill = step.delta >= 0 ? "var(--color-onefavorable)" : "var(--color-onerror)";
          }

          return (
            <g key={`step-${idx}-${step.label}`}>
              <rect
                x={barX}
                y={barTop}
                width={barWidth}
                height={barHeight}
                rx={2}
                fill={fill}
              >
                <title>{`${step.label}: ${renderMinor(step.delta, currency)} (Level: ${renderMinor(step.cumulative, currency)})`}</title>
              </rect>
              <text
                x={centerX}
                y={height - padBottom + 16}
                textAnchor="middle"
                fontSize={10}
                fill="var(--color-onetextsecondary)"
                className="font-medium"
              >
                {step.label}
              </text>
              <text
                x={centerX}
                y={barTop - 6}
                textAnchor="middle"
                fontSize={10}
                fill="var(--color-onetext)"
                className="font-mono"
              >
                {step.isTotal ? renderMinor(step.cumulative, currency) : (step.delta > 0 ? "+" : "") + renderMinor(step.delta, currency)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Commentary Modal / Popover dialog for Reason Code and Narrative Note */
export function CommentaryModal({
  row,
  onSave,
  onClose,
}: {
  row: VarianceRow;
  onSave: (accountId: string, reasonCode: ReasonCode, note: string) => void;
  onClose: () => void;
}) {
  const [selectedCode, setSelectedCode] = useState<ReasonCode>(
    row.reason_code ?? "VOLUME_SURGE",
  );
  const [noteText, setNoteText] = useState<string>(row.note ?? "");
  const modalTitleId = useId();
  const modalDescId = useId();

  const handleSave = () => {
    onSave(row.account_id, selectedCode, noteText.trim());
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={modalTitleId}
      aria-describedby={modalDescId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-lg rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-6 shadow-xl flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-[var(--color-oneborder)] pb-3">
          <div>
            <h2 id={modalTitleId} className="text-base font-semibold text-[var(--color-onetext)]">
              Variance Commentary & Reason Code
            </h2>
            <p id={modalDescId} className="text-xs text-[var(--color-onetextsecondary)]">
              {row.account_code} — {row.account_name} ({row.period_label} · {row.business_unit})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close commentary dialog"
            className="rounded p-1 text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurfacealt)]"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="reason-code-select" className="text-xs font-semibold text-[var(--color-onetextsecondary)]">
            Reason Code (Categorization)
          </label>
          <select
            id="reason-code-select"
            value={selectedCode}
            onChange={(e) => setSelectedCode(e.target.value as ReasonCode)}
            className="rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-3 py-2 text-sm text-[var(--color-onetext)] focus:outline-none focus:ring-2 focus:ring-[var(--color-oneprimary)]"
          >
            {REASON_CODE_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label} — {opt.description}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="variance-narrative-note" className="text-xs font-semibold text-[var(--color-onetextsecondary)]">
            Narrative Explanation
          </label>
          <textarea
            id="variance-narrative-note"
            rows={4}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Explain root cause, operational driver, and remediation plan for Board review..."
            className="w-full rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-2.5 text-sm text-[var(--color-onetext)] placeholder:text-[var(--color-onetextmuted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-oneprimary)]"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-oneborder)]">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave}>
            Save Commentary
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface VariancePageProps {
  initialState?: VarianceScreenState;
  initialRows?: VarianceRow[];
  initialError?: VarianceErrorDetail | null;
  onRetry?: () => void;
}

export function VariancePage({
  initialState = "populated",
  initialRows,
  initialError,
  onRetry,
}: VariancePageProps) {
  useTranslation();

  // Screen State
  const [state, setState] = useState<VarianceScreenState>(initialState);
  const [error, setError] = useState<VarianceErrorDetail | null>(
    initialError ?? null,
  );

  // Filters & Toggles
  const [filters, setFilters] = useState<VarianceFilterState>({
    period: "2027-P08",
    businessUnit: "all",
    accountCategory: "all",
    comparisonTarget: "budget",
    showThreeWay: false,
    viewMode: "table",
  });

  // Default seeded rows for realistic FP&A operations
  const [rows, setRows] = useState<VarianceRow[]>(
    initialRows ?? [
      {
        account_id: "acc-4001",
        account_code: "4001",
        account_name: "Enterprise Software Subscription",
        category: "revenue",
        business_unit: "North America",
        period_id: "fp-2027-p08",
        period_label: "2027-P08",
        actual_minor: 12500000,
        plan_minor: 10000000,
        commit_minor: 9800000,
        delta_minor: 2500000,
        delta_pct: 0.25,
        direction: "favorable",
        attribution: {
          volume: 1800000,
          price: 500000,
          mix: 200000,
          fx: 0,
          efficiency: null,
          is_attributable: true,
        },
        reason_code: "VOLUME_SURGE",
        note: "Expansion deals closed early in Q3 across cloud accounts.",
      },
      {
        account_id: "acc-5001",
        account_code: "5001",
        account_name: "Cloud Hosting & Datacenter COGS",
        category: "cogs",
        business_unit: "North America",
        period_id: "fp-2027-p08",
        period_label: "2027-P08",
        actual_minor: 3400000,
        plan_minor: 2800000,
        commit_minor: 2800000,
        delta_minor: -600000,
        delta_pct: -0.214,
        direction: "unfavorable",
        attribution: {
          volume: -400000,
          price: -100000,
          mix: 0,
          fx: 0,
          efficiency: -100000,
          is_attributable: true,
        },
        reason_code: "SUPPLIER_DISRUPTION",
        note: "Burst compute load due to unoptimized inference models.",
      },
      {
        account_id: "acc-6010",
        account_code: "6010",
        account_name: "Sales & Marketing Payroll",
        category: "opex",
        business_unit: "EMEA",
        period_id: "fp-2027-p08",
        period_label: "2027-P08",
        actual_minor: 4200000,
        plan_minor: 4500000,
        commit_minor: 4500000,
        delta_minor: 300000,
        delta_pct: 0.067,
        direction: "favorable",
        attribution: {
          volume: null,
          price: null,
          mix: null,
          fx: 120000,
          efficiency: 180000,
          is_attributable: true,
        },
        reason_code: "FX_HEADWIND",
        note: "Favorable GBP/USD exchange movement on London headcount.",
      },
      {
        account_id: "acc-6090",
        account_code: "6090",
        account_name: "Legal & Regulatory Compliance",
        category: "opex",
        business_unit: "Corporate",
        period_id: "fp-2027-p08",
        period_label: "2027-P08",
        actual_minor: 850000,
        plan_minor: 500000,
        commit_minor: 500000,
        delta_minor: -350000,
        delta_pct: -0.7,
        direction: "unfavorable",
        attribution: {
          volume: null,
          price: null,
          mix: null,
          fx: null,
          efficiency: null,
          is_attributable: false,
        },
        reason_code: "ONE_OFF_TIMING",
        note: "Annual patent defense outside counsel retainer billed upfront.",
      },
    ],
  );

  // Active commentary modal row
  const [commentaryRow, setCommentaryRow] = useState<VarianceRow | null>(null);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (filters.period !== "all" && r.period_label !== filters.period) return false;
      if (filters.businessUnit !== "all" && r.business_unit !== filters.businessUnit) return false;
      if (filters.accountCategory !== "all" && r.category !== filters.accountCategory) return false;
      return true;
    });
  }, [rows, filters]);

  // Attribution completeness summary
  const attributionStats = useMemo(() => {
    const total = filteredRows.length;
    const unattributable = filteredRows.filter((r) => !r.attribution.is_attributable).length;
    return { total, unattributable };
  }, [filteredRows]);

  // Handlers
  const handleCommentarySave = useCallback(
    (accountId: string, reasonCode: ReasonCode, note: string) => {
      setRows((prev) =>
        prev.map((row) =>
          row.account_id === accountId ? { ...row, reason_code: reasonCode, note } : row,
        ),
      );
    },
    [],
  );

  const handleRetry = useCallback(() => {
    if (onRetry) {
      onRetry();
    } else {
      setError(null);
      setState("loading");
      setTimeout(() => setState("populated"), 300);
    }
  }, [onRetry]);

  /* ── 1. LOADING STATE ── */
  if (state === "loading") {
    return (
      <main className="flex flex-col gap-6 p-6" aria-busy="true">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[var(--color-onetext)]">Variance & Attribution</h1>
            <p className="text-sm text-[var(--color-onetextsecondary)]">
              Period financial decomposition and attribution bridge
            </p>
          </div>
        </header>
        <StatePanel state="loading" message="Loading variance data and recalculating driver attribution…" />
      </main>
    );
  }

  /* ── 2. ERROR STATE ── */
  if (state === "error") {
    return (
      <main className="flex flex-col gap-6 p-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[var(--color-onetext)]">Variance & Attribution</h1>
            <p className="text-sm text-[var(--color-onetextsecondary)]">
              Period financial decomposition and attribution bridge
            </p>
          </div>
        </header>
        <StatePanel
          state="error"
          errorCode={error?.code ?? "VARIANCE_SOURCE_MIXED"}
          message={
            error?.userMessage ??
            "Selected periods mix Actual and Forecast, or calendar/currency scopes differ. Align scope or enable HYBRID label."
          }
          onRetry={error?.retryable !== false ? handleRetry : undefined}
        />
      </main>
    );
  }

  /* ── 3. EMPTY STATE ── */
  if (state === "empty") {
    return (
      <main className="flex flex-col gap-6 p-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[var(--color-onetext)]">Variance & Attribution</h1>
            <p className="text-sm text-[var(--color-onetextsecondary)]">
              Period financial decomposition and attribution bridge
            </p>
          </div>
        </header>
        <StatePanel
          state="empty"
          message="No Actuals yet — Plan-Only state. Nothing to compare."
          actionLabel="Load Sample Actuals"
          onAction={() => setState("populated")}
        />
      </main>
    );
  }

  /* ── 4 & 5. SUCCESS & POPULATED STATES ── */
  return (
    <main className="flex flex-col gap-5 p-6 min-w-0" aria-label="Variance and Attribution Analysis">
      {/* HEADER & TOP ACTIONS */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-onetext)]">
            Variance & Attribution
          </h1>
          <p className="text-xs text-[var(--color-onetextsecondary)]">
            S-054 · F-024 3-Way Plan/Commit/Actuals with Volume, Price, Mix, FX & Efficiency decomposition
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Attribution completeness chip */}
          <div
            role="status"
            aria-label="Attribution completeness"
            className="flex items-center gap-1.5 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2.5 py-1 text-xs text-[var(--color-onetextsecondary)]"
          >
            <Info aria-hidden="true" className="h-3.5 w-3.5 text-[var(--color-oneprimary)]" />
            <span>
              {attributionStats.unattributable > 0
                ? `${attributionStats.unattributable} of ${attributionStats.total} lines not attributable`
                : "All lines attributed to drivers"}
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => exportVarianceCsv(filteredRows, filters.showThreeWay)}
            aria-label="Export variance table as CSV"
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            <span>Export CSV</span>
          </Button>
        </div>
      </header>

      {/* SUCCESS BANNER WHEN APPLICABLE */}
      {state === "success" && (
        <div
          role="status"
          className="flex items-center justify-between rounded-md border border-[var(--color-onefavorable)]/30 bg-[var(--color-onefavorable)]/10 px-4 py-2.5 text-sm text-[var(--color-onefavorable)]"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>All variance reason codes and commentary submitted and reconciled cleanly.</span>
          </div>
          <button
            type="button"
            onClick={() => setState("populated")}
            aria-label="Dismiss success notice"
            className="text-xs font-semibold underline hover:opacity-80"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* TOOLBAR */}
      <section
        aria-label="Variance Toolbar Filters"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-3 shadow-xs"
      >
        <div className="flex flex-wrap items-center gap-3">
          {/* Period Filter */}
          <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-onetextsecondary)]">
            <span>Period:</span>
            <select
              aria-label="Filter by Period"
              value={filters.period}
              onChange={(e) => setFilters((f) => ({ ...f, period: e.target.value }))}
              className="rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1 text-xs text-[var(--color-onetext)] focus:outline-none focus:ring-1 focus:ring-[var(--color-oneprimary)]"
            >
              <option value="all">All Periods</option>
              <option value="2027-P08">2027-P08</option>
              <option value="2027-P07">2027-P07</option>
              <option value="2027-P06">2027-P06</option>
            </select>
          </label>

          {/* BU Filter */}
          <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-onetextsecondary)]">
            <span>BU:</span>
            <select
              aria-label="Filter by Business Unit"
              value={filters.businessUnit}
              onChange={(e) => setFilters((f) => ({ ...f, businessUnit: e.target.value }))}
              className="rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1 text-xs text-[var(--color-onetext)] focus:outline-none focus:ring-1 focus:ring-[var(--color-oneprimary)]"
            >
              <option value="all">All Business Units</option>
              <option value="North America">North America</option>
              <option value="EMEA">EMEA</option>
              <option value="Corporate">Corporate</option>
            </select>
          </label>

          {/* Accounts Filter */}
          <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-onetextsecondary)]">
            <span>Accounts:</span>
            <select
              aria-label="Filter by Account Category"
              value={filters.accountCategory}
              onChange={(e) => setFilters((f) => ({ ...f, accountCategory: e.target.value }))}
              className="rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1 text-xs text-[var(--color-onetext)] focus:outline-none focus:ring-1 focus:ring-[var(--color-oneprimary)]"
            >
              <option value="all">All Categories</option>
              <option value="revenue">Revenue</option>
              <option value="cogs">COGS</option>
              <option value="opex">Opex</option>
              <option value="capex">Capex</option>
            </select>
          </label>

          {/* Comparison Picker */}
          <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-onetextsecondary)]">
            <span>vs:</span>
            <select
              aria-label="Comparison Target"
              value={filters.comparisonTarget}
              onChange={(e) =>
                setFilters((f) => ({ ...f, comparisonTarget: e.target.value as ComparisonTarget }))
              }
              className="rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 py-1 text-xs font-medium text-[var(--color-onetext)] focus:outline-none focus:ring-1 focus:ring-[var(--color-oneprimary)]"
            >
              <option value="budget">Budget</option>
              <option value="forecast">Forecast</option>
              <option value="commit">Commit</option>
            </select>
          </label>

          {/* 3-Way Toggle */}
          <label className="flex items-center gap-2 text-xs font-medium text-[var(--color-onetext)] cursor-pointer select-none">
            <input
              type="checkbox"
              role="switch"
              aria-checked={filters.showThreeWay}
              checked={filters.showThreeWay}
              onChange={(e) => setFilters((f) => ({ ...f, showThreeWay: e.target.checked }))}
              className="h-4 w-4 rounded border-[var(--color-oneborder)] text-[var(--color-oneprimary)] focus:ring-[var(--color-oneprimary)]"
            />
            <span>3-Way View (Plan/Commit/Actuals)</span>
          </label>
        </div>

        {/* View Mode Toggle (Table vs Waterfall Chart) */}
        <div
          role="radiogroup"
          aria-label="View toggle"
          className="flex items-center gap-1 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-0.5 text-xs"
        >
          <button
            type="button"
            role="radio"
            aria-checked={filters.viewMode === "table"}
            onClick={() => setFilters((f) => ({ ...f, viewMode: "table" }))}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors ${
              filters.viewMode === "table"
                ? "bg-[var(--color-onesurface)] text-[var(--color-onetext)] shadow-xs"
                : "text-[var(--color-onetextsecondary)] hover:text-[var(--color-onetext)]"
            }`}
          >
            <TableIcon aria-hidden="true" className="h-3.5 w-3.5" />
            <span>Table</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={filters.viewMode === "waterfall"}
            onClick={() => setFilters((f) => ({ ...f, viewMode: "waterfall" }))}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors ${
              filters.viewMode === "waterfall"
                ? "bg-[var(--color-onesurface)] text-[var(--color-onetext)] shadow-xs"
                : "text-[var(--color-onetextsecondary)] hover:text-[var(--color-onetext)]"
            }`}
          >
            <BarChart3 aria-hidden="true" className="h-3.5 w-3.5" />
            <span>Waterfall</span>
          </button>
        </div>
      </section>

      {/* WATERFALL VIEW (WHEN TOGGLED) */}
      {filters.viewMode === "waterfall" && (
        <section aria-label="Attribution Waterfall Visualization">
          <VarianceWaterfallChart rows={filteredRows} />
        </section>
      )}

      {/* VARIANCE & ATTRIBUTION TABLE */}
      <section
        aria-label="Variance Data Table"
        className="overflow-x-auto rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] shadow-xs"
      >
        <table className="w-full border-collapse text-left text-xs">
          <caption className="sr-only">
            Detailed financial variance with attribution decomposition (Volume, Price, Mix, FX, Efficiency) and reason codes
          </caption>
          <thead>
            <tr className="border-b border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] text-[var(--color-onetextsecondary)]">
              <th scope="col" className="px-3 py-2.5 font-semibold">
                Account
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold">
                BU
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                Actual
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                Plan
              </th>
              {filters.showThreeWay && (
                <th scope="col" className="px-3 py-2.5 text-right font-semibold bg-blue-50/50 dark:bg-blue-950/20">
                  Commit
                </th>
              )}
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                Δ$
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                Δ%
              </th>
              <th scope="col" className="px-3 py-2.5 text-center font-semibold">
                F/U
              </th>
              {/* Attribution Columns */}
              <th scope="col" className="px-3 py-2.5 text-right font-semibold text-[var(--color-oneprimary)]">
                Volume
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold text-[var(--color-oneprimary)]">
                Price
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold text-[var(--color-oneprimary)]">
                Mix
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold text-[var(--color-oneprimary)]">
                FX
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold text-[var(--color-oneprimary)]">
                Efficiency
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold">
                Reason Code
              </th>
              <th scope="col" className="px-3 py-2.5 text-center font-semibold">
                Note
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-oneborder)] text-[var(--color-onetext)]">
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={filters.showThreeWay ? 16 : 15} className="py-8 text-center text-sm text-[var(--color-onetextmuted)]">
                  No records match the active filters.
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr
                  key={row.account_id}
                  className="hover:bg-[var(--color-onesurfacealt)]/50 transition-colors"
                >
                  <td className="px-3 py-2 font-medium">
                    <div>{row.account_name}</div>
                    <div className="font-mono text-[10px] text-[var(--color-onetextmuted)]">{row.account_code}</div>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-onetextsecondary)]">{row.business_unit}</td>
                  <td className="px-3 py-2 text-right font-mono font-medium">
                    {renderMinor(row.actual_minor)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-onetextsecondary)]">
                    {renderMinor(row.plan_minor)}
                  </td>
                  {filters.showThreeWay && (
                    <td className="px-3 py-2 text-right font-mono text-[var(--color-onetextsecondary)] bg-blue-50/30 dark:bg-blue-950/10">
                      {renderMinor(row.commit_minor)}
                    </td>
                  )}
                  <td
                    className={`px-3 py-2 text-right font-mono font-medium ${
                      row.direction === "favorable"
                        ? "text-[var(--color-onefavorable)]"
                        : row.direction === "unfavorable"
                          ? "text-[var(--color-onerror)]"
                          : ""
                    }`}
                  >
                    {row.delta_minor != null && row.delta_minor > 0 ? "+" : ""}
                    {renderMinor(row.delta_minor)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono text-[11px] ${
                      row.direction === "favorable"
                        ? "text-[var(--color-onefavorable)]"
                        : row.direction === "unfavorable"
                          ? "text-[var(--color-onerror)]"
                          : ""
                    }`}
                  >
                    {formatPercent(row.delta_pct)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <VarianceDirectionBadge direction={row.direction} />
                  </td>

                  {/* Decomposition Columns */}
                  {row.attribution.is_attributable ? (
                    <>
                      <td className="px-3 py-2 text-right font-mono text-[11px]">
                        {renderMinor(row.attribution.volume)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[11px]">
                        {renderMinor(row.attribution.price)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[11px]">
                        {renderMinor(row.attribution.mix)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[11px]">
                        {renderMinor(row.attribution.fx)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[11px]">
                        {renderMinor(row.attribution.efficiency)}
                      </td>
                    </>
                  ) : (
                    <td
                      colSpan={5}
                      className="px-3 py-2 text-center text-[10px] italic text-[var(--color-onetextmuted)] bg-[var(--color-onesurfacealt)]/40"
                    >
                      Not attributable — no driver feed for this line.
                    </td>
                  )}

                  {/* Reason Code Picker Cell */}
                  <td className="px-3 py-2">
                    {row.reason_code ? (
                      <span className="inline-flex items-center gap-1 rounded bg-[var(--color-oneprimary)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-oneprimary)] border border-[var(--color-oneprimary)]/20">
                        <Tag aria-hidden="true" className="h-3 w-3" />
                        <span>{row.reason_code.replace(/_/g, " ")}</span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-[var(--color-onetextmuted)] italic">
                        Unassigned
                      </span>
                    )}
                  </td>

                  {/* Note / Modal Launcher */}
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => setCommentaryRow(row)}
                      aria-label={`Open commentary for ${row.account_name}`}
                      className={`inline-flex items-center justify-center rounded p-1.5 transition-colors ${
                        row.note
                          ? "bg-[var(--color-oneprimary)]/10 text-[var(--color-oneprimary)] hover:bg-[var(--color-oneprimary)]/20"
                          : "text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurfacealt)]"
                      }`}
                    >
                      <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* COMMENTARY MODAL */}
      {commentaryRow && (
        <CommentaryModal
          row={commentaryRow}
          onSave={handleCommentarySave}
          onClose={() => setCommentaryRow(null)}
        />
      )}
    </main>
  );
}

export default VariancePage;

