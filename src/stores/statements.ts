/**
 * S-060 Statement store (F-027 · M6-1 · SCREENS-SPEC S-060).
 *
 * Owns the statement read state:
 *   * Load statement rows/totals via `statement.get.v1` IPC
 *     - company_id, type (pl|bs|cf|soce|segment), period_scope, preset, rounding, bu_scope
 *     - returns { rows, totals, tieout_status, rounding_status, findings }
 *   * 5 canonical screen states (loading/empty/error/success/populated)
 *   * Tie-out status chip + rounding integrity chip (display-only; the engine owns the math)
 *   * Drill-down on every line to source (planning path; here we expose the row shape)
 *   * Strict money rules: integer minor units in the store, decimal.js formatting only at render
 */

import { create } from "zustand";
import { call, toBridgeError, type BridgeError } from "@/api/bridge";
import type { ScreenState } from "@/components/ui/StatePanel";
import type {
  StatementGetData,
  StatementSection,
  StatementTotals,
  RoundingRequest,
  BuScope,
  StatementType,
  StatementPreset,
} from "@/api/schema";

export type StatementTypeValue = StatementType;
export type StatementPresetValue = StatementPreset;
export type RoundingModeValue = "major_units" | "thousands" | "two_decimals";

export interface StatementStoreState {
  /* ── 5 screen states & error ───────────────────────────────────── */
  status: ScreenState;
  error: BridgeError | null;

  /* ── Scoping & configuration ───────────────────────────────────── */
  companyId: string | null;
  type: StatementTypeValue;
  periodScope: string[];
  preset: StatementPresetValue;
  rounding: RoundingRequest;
  buScope: BuScope;
  currency: string | null;

  /* ── Raw engine response ───────────────────────────────────────── */
  rows: StatementSection[];
  totals: StatementTotals | null;
  tieoutStatus: "pass" | "fail" | null;
  roundingStatus: "exact" | "approximate" | null;
  findings: Array<{
    code: string;
    message: string;
    detail: string;
  }>;

  /* ── Actions ───────────────────────────────────────────────────── */
  setCompanyId: (companyId: string | null) => void;
  setType: (type: StatementTypeValue) => void;
  setPeriodScope: (periodScope: string[]) => void;
  setPreset: (preset: StatementPresetValue) => void;
  setRounding: (rounding: RoundingRequest) => void;
  setBuScope: (buScope: BuScope) => void;
  setCurrency: (currency: string) => void;

  loadStatement: (params?: {
    companyId?: string;
    type?: StatementTypeValue;
    periodScope?: string[];
    preset?: StatementPresetValue;
    rounding?: RoundingRequest;
    buScope?: BuScope;
  }) => Promise<boolean>;

  retry: () => Promise<boolean>;
  reset: () => void;
  clearError: () => void;

  /* ── Selectors ─────────────────────────────────────────────────── */
  getRows: () => StatementSection[];
  getTotals: () => StatementTotals | null;
  getTieoutStatus: () => "pass" | "fail" | null;
  getRoundingStatus: () => "exact" | "approximate" | null;
}

const DEFAULT_ROUNDING: RoundingRequest = {
  mode: "thousands",
  largest_remainder: true,
};

const DEFAULT_BU_SCOPE: BuScope = {
  kind: "all",
  bu_id: null,
};

export const useStatementStore = create<StatementStoreState>((set, get) => ({
  status: "empty",
  error: null,
  companyId: null,
  type: "pl",
  periodScope: [],
  preset: "us_gaap",
  rounding: DEFAULT_ROUNDING,
  buScope: DEFAULT_BU_SCOPE,
  currency: null,
  rows: [],
  totals: null,
  tieoutStatus: null,
  roundingStatus: null,
  findings: [],

  setCompanyId: (companyId) => set({ companyId }),
  setType: (type) => set({ type }),
  setPeriodScope: (periodScope) => set({ periodScope }),
  setPreset: (preset) => set({ preset }),
  setRounding: (rounding) => set({ rounding }),
  setBuScope: (buScope) => set({ buScope }),
  setCurrency: (currency) => set({ currency }),

  loadStatement: async (params) => {
    const current = get();
    const companyId =
      params?.companyId ?? current.companyId;
    const type = params?.type ?? current.type;
    const periodScope = params?.periodScope ?? current.periodScope;
    const preset = params?.preset ?? current.preset;
    const rounding = params?.rounding ?? current.rounding;
    const buScope = params?.buScope ?? current.buScope;      if (!companyId) {
        set({
          status: "empty",
          error: null,
          rows: [],
          totals: null,
          tieoutStatus: null,
          roundingStatus: null,
          findings: [],
          currency: null,
        });
        return false;
      }

    set({
      status: "loading",
      error: null,
      companyId,
      type,
      periodScope,
      preset,
      rounding,
      buScope,
    });

    try {
      const response = (await call("statement.get.v1" as never, {
        company_id: companyId,
        type,
        period_scope: periodScope,
        preset,
        rounding,
        bu_scope: buScope,
      } as never)) as StatementGetData;

      const tieoutStatus = response.tieout_status === "pass" ? "pass" : "fail";
      const roundingStatus = response.rounding_status;

      let computedStatus: ScreenState = "success";
      if (response.rows.length > 0) {
        computedStatus = "populated";
      } else if (tieoutStatus === "fail") {
        computedStatus = "success";
      }

      set({
        status: computedStatus,
        rows: response.rows,
        totals: response.totals,
        tieoutStatus,
        roundingStatus,
        findings: response.findings,
        currency: response.currency ?? null,
        error: null,
      });

      return true;
    } catch (err) {
      const bridgeError = toBridgeError(err);
      set({
        status: "error",
        error: bridgeError,
        rows: [],
        totals: null,
        tieoutStatus: null,
        roundingStatus: null,
        findings: [],
      });
      return false;
    }
  },

  retry: async () => {
    return get().loadStatement();
  },

  reset: () =>
    set({
      status: "empty",
      error: null,
      companyId: null,
      type: "pl",
      periodScope: [],
      preset: "us_gaap",
      rounding: DEFAULT_ROUNDING,
      buScope: DEFAULT_BU_SCOPE,
      currency: null,
      rows: [],
      totals: null,
      tieoutStatus: null,
      roundingStatus: null,
      findings: [],
    }),

  clearError: () => set({ error: null }),

  getRows: () => get().rows,
  getTotals: () => get().totals,
  getTieoutStatus: () => get().tieoutStatus,
  getRoundingStatus: () => get().roundingStatus,
}));
