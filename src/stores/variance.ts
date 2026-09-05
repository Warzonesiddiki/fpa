/**
 * S-054 Variance & Attribution store (F-024 · M5-1 · M5-2 · SCREENS-SPEC S-054).
 *
 * Owns the Variance & Attribution analysis state:
 *   * Load variance & attribution data: `variance.get` IPC
 *     - company_id, period_id, compare ("budget" | "forecast" | "commit" | "prior_period" | "prior_year"), attribution (boolean)
 *     - returns { rows, attribution, threeway }
 *   * Reason codes & notes: `variance.set_reason_code` IPC
 *     - line_id, period_id, code, note
 *     - returns { saved: boolean }
 *   * 5 canonical screen states (`empty`, `loading`, `error`, `success`, `populated`)
 *   * 3-way view toggle (P&L, Balance Sheet, Cash Flow columns)
 *   * Multi-dimensional filtering: period, business unit (BU), accounts
 *   * Error handling strictly mapped via `toBridgeError` (e.g. `VARIANCE_SOURCE_MIXED`, `VARIANCE_NO_ATTRIBUTION_DATA`)
 *   * Strict money rules: integer minor units / exact decimal strings, never JS float arithmetic
 */

import { create } from "zustand";
import { call, toBridgeError, type BridgeError } from "@/api/bridge";
import type { ScreenState } from "@/components/ui/StatePanel";

/** Comparison target types supported by the variance engine */
export type VarianceCompareTarget = "budget" | "forecast" | "commit" | "prior_period" | "prior_year";

/** 3-way view presentation mode */
export type ThreeWayViewMode = "all" | "pl" | "bs" | "cf";

/** Reason code category taxonomy per DATABASE-SCHEMA §9 & PRD */
export type ReasonCategory =
  | "volume"
  | "price"
  | "mix"
  | "fx"
  | "efficiency"
  | "one_time"
  | "seasonality"
  | "other";

/** Reason code descriptor */
export interface ReasonCodeItem {
  id: string;
  code: string;
  label: string;
  category: ReasonCategory;
  active: boolean;
}

/** Attribution breakdown for an account/line (Volume, Price, Mix, FX, Efficiency) in minor units */
export interface VarianceAttribution {
  line_id: string;
  period_id: string;
  /** Whether the line is attributable based on driver data availability */
  is_attributable: boolean;
  volume_minor: number | null;
  price_minor: number | null;
  mix_minor: number | null;
  fx_minor: number | null;
  efficiency_minor: number | null;
  /** Exact decimal strings for traceability */
  volume_decimal?: string | null;
  price_decimal?: string | null;
  mix_decimal?: string | null;
  fx_decimal?: string | null;
  efficiency_decimal?: string | null;
  notes?: string | null;
}

/** 3-Way statement linkage row */
export interface ThreeWayRow {
  line_id: string;
  account_code: string;
  statement_type: "pl" | "bs" | "cf";
  period_id: string;
  actual_minor: number;
  compare_minor: number;
  variance_minor: number;
}

/** Single row in the variance table */
export interface VarianceRow {
  line_id: string;
  account_id: string | null;
  account_code: string;
  account_name: string;
  business_unit_id: string | null;
  business_unit_name: string | null;
  statement_type: "pl" | "bs" | "cf";
  period_id: string;
  actual_minor: number;
  actual_decimal: string;
  compare_minor: number;
  compare_decimal: string;
  variance_minor: number;
  variance_decimal: string;
  variance_pct: string;
  /** Direction per DESIGN-SYSTEM: favorable (F) or unfavorable (U) */
  direction: "favorable" | "unfavorable" | "neutral";
  reason_code: string | null;
  reason_note: string | null;
  attribution?: VarianceAttribution | null;
}

/** Filter criteria for variance rows */
export interface VarianceFilters {
  periodId: string | null;
  businessUnitId: string | null;
  accountQuery: string;
  directionFilter: "all" | "favorable" | "unfavorable";
  onlyWithReasonCode: boolean;
}

export interface VarianceStoreState {
  /* ── 5 Screen states & error ───────────────────────────────────── */
  status: ScreenState;
  error: BridgeError | null;

  /* ── Scoping & Configuration ───────────────────────────────────── */
  companyId: string | null;
  compareTarget: VarianceCompareTarget;
  includeAttribution: boolean;

  /* ── 3-Way View toggle ─────────────────────────────────────────── */
  threeWayMode: ThreeWayViewMode;
  showThreeWayView: boolean;

  /* ── Raw data from core IPC ────────────────────────────────────── */
  rows: VarianceRow[];
  attributions: VarianceAttribution[];
  threeWayRows: ThreeWayRow[];

  /* ── Available reason codes catalog ────────────────────────────── */
  reasonCodes: ReasonCodeItem[];

  /* ── Filters ───────────────────────────────────────────────────── */
  filters: VarianceFilters;

  /* ── Actions ───────────────────────────────────────────────────── */
  setCompanyId: (companyId: string | null) => void;
  setCompareTarget: (target: VarianceCompareTarget) => void;
  setThreeWayMode: (mode: ThreeWayViewMode) => void;
  toggleThreeWayView: (show?: boolean) => void;
  setIncludeAttribution: (include: boolean) => void;

  setPeriodFilter: (periodId: string | null) => void;
  setBusinessUnitFilter: (businessUnitId: string | null) => void;
  setAccountQuery: (query: string) => void;
  setDirectionFilter: (direction: "all" | "favorable" | "unfavorable") => void;
  setOnlyWithReasonCode: (enabled: boolean) => void;
  resetFilters: () => void;

  /** Load variance report via variance.get */
  loadVariance: (params?: {
    companyId?: string;
    periodId?: string;
    compare?: VarianceCompareTarget;
    attribution?: boolean;
  }) => Promise<boolean>;

  /** Retry last query */
  retry: () => Promise<boolean>;

  /** Save reason code + note for a line/period */
  saveReasonCode: (lineId: string, periodId: string, code: string, note?: string) => Promise<boolean>;

  /** Filtered rows selector */
  getFilteredRows: () => VarianceRow[];

  /** Summary totals selector */
  getTotals: () => {
    totalActualMinor: number;
    totalCompareMinor: number;
    totalVarianceMinor: number;
    favorableCount: number;
    unfavorableCount: number;
  };

  /** Reset all store state */
  reset: () => void;
  clearError: () => void;
}

const DEFAULT_REASON_CODES: ReasonCodeItem[] = [
  { id: "rc-1", code: "volume", label: "Volume shortfall / surge", category: "volume", active: true },
  { id: "rc-2", code: "price", label: "Price / rate realization", category: "price", active: true },
  { id: "rc-3", code: "mix", label: "Product / channel mix shift", category: "mix", active: true },
  { id: "rc-4", code: "fx", label: "Foreign exchange fluctuation", category: "fx", active: true },
  { id: "rc-5", code: "efficiency", label: "Operational efficiency / scrap", category: "efficiency", active: true },
  { id: "rc-6", code: "one_time", label: "One-time non-recurring item", category: "one_time", active: true },
  { id: "rc-7", code: "seasonality", label: "Timing / seasonality shift", category: "seasonality", active: true },
  { id: "rc-8", code: "other", label: "Other / Uncategorized", category: "other", active: true },
];

const DEFAULT_FILTERS: VarianceFilters = {
  periodId: null,
  businessUnitId: null,
  accountQuery: "",
  directionFilter: "all",
  onlyWithReasonCode: false,
};

export const useVarianceStore = create<VarianceStoreState>((set, get) => ({
  status: "empty",
  error: null,
  companyId: null,
  compareTarget: "budget",
  includeAttribution: true,
  threeWayMode: "all",
  showThreeWayView: false,
  rows: [],
  attributions: [],
  threeWayRows: [],
  reasonCodes: DEFAULT_REASON_CODES,
  filters: { ...DEFAULT_FILTERS },

  setCompanyId: (companyId) => {
    set({ companyId });
  },

  setCompareTarget: (compareTarget) => {
    set({ compareTarget });
  },

  setThreeWayMode: (threeWayMode) => {
    set({ threeWayMode });
  },

  toggleThreeWayView: (show) => {
    set((state) => ({
      showThreeWayView: show !== undefined ? show : !state.showThreeWayView,
    }));
  },

  setIncludeAttribution: (includeAttribution) => {
    set({ includeAttribution });
  },

  setPeriodFilter: (periodId) => {
    set((state) => ({
      filters: { ...state.filters, periodId },
    }));
  },

  setBusinessUnitFilter: (businessUnitId) => {
    set((state) => ({
      filters: { ...state.filters, businessUnitId },
    }));
  },

  setAccountQuery: (accountQuery) => {
    set((state) => ({
      filters: { ...state.filters, accountQuery },
    }));
  },

  setDirectionFilter: (directionFilter) => {
    set((state) => ({
      filters: { ...state.filters, directionFilter },
    }));
  },

  setOnlyWithReasonCode: (onlyWithReasonCode) => {
    set((state) => ({
      filters: { ...state.filters, onlyWithReasonCode },
    }));
  },

  resetFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS } });
  },

  loadVariance: async (params) => {
    const current = get();
    const companyId = params?.companyId ?? current.companyId;
    const periodId = params?.periodId ?? current.filters.periodId;
    const compare = params?.compare ?? current.compareTarget;
    const attribution = params?.attribution ?? current.includeAttribution;

    if (!companyId || !periodId) {
      set({ status: "empty", error: null, rows: [], attributions: [], threeWayRows: [] });
      return false;
    }

    set({
      status: "loading",
      error: null,
      companyId,
      compareTarget: compare,
      includeAttribution: attribution,
      filters: { ...current.filters, periodId },
    });

    try {
      const response = (await call("variance.get" as never, {
        company_id: companyId,
        period_id: periodId,
        compare,
        attribution,
      } as never)) as {
        rows?: VarianceRow[];
        attribution?: VarianceAttribution[];
        threeway?: ThreeWayRow[];
      };

      const rows = response?.rows ?? [];
      const attributions = response?.attribution ?? [];
      const threeWayRows = response?.threeway ?? [];

      // Link attribution to rows if present
      const attributionMap = new Map<string, VarianceAttribution>();
      for (const attr of attributions) {
        attributionMap.set(`${attr.line_id}:${attr.period_id}`, attr);
      }

      const enrichedRows = rows.map((r) => ({
        ...r,
        attribution: attributionMap.get(`${r.line_id}:${r.period_id}`) ?? r.attribution ?? null,
      }));

      const hasData = enrichedRows.length > 0;
      set({
        status: hasData ? "populated" : "success",
        rows: enrichedRows,
        attributions,
        threeWayRows,
        error: null,
      });
      return true;
    } catch (cause) {
      const bridgeErr = toBridgeError(cause);
      set({
        status: "error",
        error: bridgeErr,
        rows: [],
        attributions: [],
        threeWayRows: [],
      });
      return false;
    }
  },

  retry: async () => {
    const current = get();
    if (!current.companyId || !current.filters.periodId) {
      return false;
    }
    return get().loadVariance({
      companyId: current.companyId,
      periodId: current.filters.periodId,
      compare: current.compareTarget,
      attribution: current.includeAttribution,
    });
  },

  saveReasonCode: async (lineId, periodId, code, note) => {
    const trimmedNote = note?.trim() || "";
    try {
      const response = (await call("variance.set_reason_code" as never, {
        line_id: lineId,
        period_id: periodId,
        code,
        note: trimmedNote,
      } as never)) as { saved?: boolean };

      if (response && response.saved === false) {
        throw new Error("Failed to save reason code");
      }

      // Optimistically update local row state
      set((state) => ({
        rows: state.rows.map((row) => {
          if (row.line_id === lineId && row.period_id === periodId) {
            return {
              ...row,
              reason_code: code,
              reason_note: trimmedNote,
            };
          }
          return row;
        }),
      }));
      return true;
    } catch (cause) {
      const bridgeErr = toBridgeError(cause);
      set({
        error: bridgeErr,
      });
      return false;
    }
  },

  getFilteredRows: () => {
    const { rows, filters, threeWayMode, showThreeWayView } = get();

    return rows.filter((row) => {
      // 3-way statement filter if enabled
      if (showThreeWayView && threeWayMode !== "all") {
        if (row.statement_type !== threeWayMode) {
          return false;
        }
      }

      // Period filter
      if (filters.periodId && row.period_id !== filters.periodId) {
        return false;
      }

      // BU filter
      if (filters.businessUnitId && row.business_unit_id !== filters.businessUnitId) {
        return false;
      }

      // Account query (match code or name case-insensitively)
      if (filters.accountQuery) {
        const q = filters.accountQuery.toLowerCase();
        const codeMatches = row.account_code.toLowerCase().includes(q);
        const nameMatches = row.account_name.toLowerCase().includes(q);
        if (!codeMatches && !nameMatches) {
          return false;
        }
      }

      // Direction filter
      if (filters.directionFilter !== "all" && row.direction !== filters.directionFilter) {
        return false;
      }

      // Reason code presence
      if (filters.onlyWithReasonCode && (!row.reason_code || row.reason_code.trim() === "")) {
        return false;
      }

      return true;
    });
  },

  getTotals: () => {
    const filtered = get().getFilteredRows();
    let totalActualMinor = 0;
    let totalCompareMinor = 0;
    let totalVarianceMinor = 0;
    let favorableCount = 0;
    let unfavorableCount = 0;

    for (const r of filtered) {
      totalActualMinor += r.actual_minor;
      totalCompareMinor += r.compare_minor;
      totalVarianceMinor += r.variance_minor;
      if (r.direction === "favorable") favorableCount += 1;
      else if (r.direction === "unfavorable") unfavorableCount += 1;
    }

    return {
      totalActualMinor,
      totalCompareMinor,
      totalVarianceMinor,
      favorableCount,
      unfavorableCount,
    };
  },

  reset: () => {
    set({
      status: "empty",
      error: null,
      companyId: null,
      compareTarget: "budget",
      includeAttribution: true,
      threeWayMode: "all",
      showThreeWayView: false,
      rows: [],
      attributions: [],
      threeWayRows: [],
      reasonCodes: DEFAULT_REASON_CODES,
      filters: { ...DEFAULT_FILTERS },
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));
