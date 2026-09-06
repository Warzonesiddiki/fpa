/**
 * S-046 Capital, Debt, Working Capital & 13-Week Cash store (F-017 · M3-7).
 *
 * Implements the 5 canonical screen states (loading, empty, error, success, populated)
 * and holds:
 * - Capital Projects (with depreciation preview, error CAPEX_IN_SERVICE_INVALID)
 * - Debt Facilities (with balances, interest calc, error DEBT_SCHEDULE_OVERDRAWN)
 * - Working Capital Drivers (DSO, DPO, DIO impact on AR, AP, Inventory cash flow)
 * - 13-Week Cash Flow Schedule
 * - Covenant Gauges (Net Debt / EBITDA, Interest Cover, alert COVENANT_BREACH)
 */
import { create } from "zustand";
import type { ScreenState } from "@/components/ui/StatePanel";
import type { BridgeError } from "@/api/bridge";
import {
  calculateCovenants,
  calculateDebtFacility,
  calculateDepreciationPreview,
  calculateWorkingCapitalImpact,
  generate13WeekCashFlow,
  validateCapitalProject,
  type CapitalProject,
  type CashWeekSchedule,
  type CovenantMetrics,
  type DebtFacility,
  type DebtFacilityCalculated,
  type MonthlyDepreciationPreview,
  type WorkingCapitalDrivers,
  type WorkingCapitalImpact,
} from "@/model/capital";

export interface CapitalStoreState {
  status: ScreenState;
  error: BridgeError | null;
  currency: string;
  activeTab: "capital" | "debt" | "working_capital" | "cash13" | "covenants";

  // Data
  projects: CapitalProject[];
  facilities: DebtFacility[];
  wcDrivers: WorkingCapitalDrivers;
  openingCashMinor: number;
  weeklyReceipts: number[];
  weeklyDisbursements: number[];
  weeklyFinancing: number[];
  ebitdaMinor: number;

  // Computed projections
  projectPreviews: Record<string, MonthlyDepreciationPreview>;
  calculatedFacilities: DebtFacilityCalculated[];
  wcImpact: WorkingCapitalImpact;
  cashSchedule: CashWeekSchedule[];
  covenants: CovenantMetrics;

  // Actions
  setActiveTab: (tab: "capital" | "debt" | "working_capital" | "cash13" | "covenants") => void;
  load: () => Promise<void>;
  addProject: (project: Omit<CapitalProject, "id">) => boolean;
  updateProject: (project: CapitalProject) => boolean;
  removeProject: (id: string) => void;
  addFacility: (facility: Omit<DebtFacility, "id">) => boolean;
  updateFacility: (facility: DebtFacility) => boolean;
  removeFacility: (id: string) => void;
  setWcDrivers: (drivers: Partial<WorkingCapitalDrivers>) => void;
  updateWeeklyCash: (
    weekIndex: number,
    values: { receipts?: number; disbursements?: number; financing?: number },
  ) => void;
  setEbitda: (ebitdaMinor: number) => void;
  setOpeningCash: (cashMinor: number) => void;
  triggerError: (
    code: "CAPEX_IN_SERVICE_INVALID" | "DEBT_SCHEDULE_OVERDRAWN" | "COVENANT_BREACH",
  ) => void;
  retry: () => Promise<void>;
  clearAll: () => void;
}

// User Story US-018 seed data:
// ₹40M capex project (in-service P05, 10-year SL depreciation)
// ₹25M term loan (6.5% interest, quarterly repayments)
export const INITIAL_PROJECTS: CapitalProject[] = [
  {
    id: "proj-001",
    name: "Warehouse Expansion",
    asset_class: "Buildings & Infrastructure",
    in_service_date: "2026-08-01",
    depreciation_start_date: "2026-08-01",
    life_years: 10,
    method: "SL",
    capex_minor: 40_000_000_00, // ₹40,000,000.00
  },
];

export const INITIAL_FACILITIES: DebtFacility[] = [
  {
    id: "debt-001",
    name: "Term Loan A",
    facility_type: "Term",
    interest_rate_bps: 650, // 6.50%
    opening_balance_minor: 25_000_000_00, // ₹25,000,000.00
    drawdowns_minor: 0,
    repayments_minor: 625_000_00, // ₹625,000.00 quarterly
  },
];

export const INITIAL_WC_DRIVERS: WorkingCapitalDrivers = {
  dso_days: 45,
  dpo_days: 30,
  dio_days: 60,
  annual_revenue_minor: 120_000_000_00, // ₹120M
  annual_cogs_minor: 72_000_000_00, // ₹72M
};

// 13 weeks of cash flow data
export const INITIAL_WEEKLY_RECEIPTS = [
  2_500_000_00, 2_300_000_00, 2_400_000_00, 2_600_000_00, 2_200_000_00, 2_700_000_00, 2_500_000_00,
  2_400_000_00, 2_800_000_00, 2_300_000_00, 2_600_000_00, 2_500_000_00, 2_900_000_00,
];

export const INITIAL_WEEKLY_DISBURSEMENTS = [
  1_800_000_00, 1_900_000_00, 1_850_000_00, 2_100_000_00, 1_750_000_00, 1_950_000_00, 1_800_000_00,
  2_000_000_00, 1_900_000_00, 1_850_000_00, 2_050_000_00, 1_900_000_00, 2_200_000_00,
];

export const INITIAL_WEEKLY_FINANCING = [
  0,
  0,
  0,
  0,
  -625_000_00,
  0,
  0,
  0, // Repayment in W05
  0,
  0,
  0,
  0,
  0,
];

export const INITIAL_OPENING_CASH = 10_000_000_00; // ₹10,000,000.00
export const INITIAL_EBITDA = 15_000_000_00; // ₹15,000,000.00

function recomputeAll(
  projects: CapitalProject[],
  facilities: DebtFacility[],
  wcDrivers: WorkingCapitalDrivers,
  openingCashMinor: number,
  weeklyReceipts: number[],
  weeklyDisbursements: number[],
  weeklyFinancing: number[],
  ebitdaMinor: number,
) {
  // Check project errors
  let capexError: BridgeError | null = null;
  const projectPreviews: Record<string, MonthlyDepreciationPreview> = {};
  for (const proj of projects) {
    const issue = validateCapitalProject(proj);
    if (issue) {
      capexError = {
        code: issue.code,
        userMessage: issue.message,
        httpStatus: 422,
        retryable: false,
        retryAfterMs: null,
        details: { project_id: proj.id },
      };
    }
    projectPreviews[proj.id] = calculateDepreciationPreview(proj);
  }

  // Debt calculations and overdrawn check
  let debtError: BridgeError | null = null;
  let totalDebtMinor = 0;
  let totalInterestExpenseMinor = 0;
  const calculatedFacilities = facilities.map((f) => {
    const calc = calculateDebtFacility(f);
    if (calc.is_overdrawn) {
      debtError = {
        code: "DEBT_SCHEDULE_OVERDRAWN",
        userMessage: "Debt repayments exceed facility balance or facility exceeds credit limit.",
        httpStatus: 422,
        retryable: false,
        retryAfterMs: null,
        details: { facility_id: f.id },
      };
    }
    totalDebtMinor += Math.max(0, calc.closing_balance_minor);
    totalInterestExpenseMinor += calc.annual_interest_minor;
    return calc;
  });

  // Working Capital Impact
  const wcImpact = calculateWorkingCapitalImpact(wcDrivers);

  // 13-Week Cash Schedule
  const cashSchedule = generate13WeekCashFlow(
    openingCashMinor,
    weeklyReceipts,
    weeklyDisbursements,
    weeklyFinancing,
  );
  const closingCashMinor =
    cashSchedule.length > 0
      ? cashSchedule[cashSchedule.length - 1].closing_cash_minor
      : openingCashMinor;

  // Covenants
  const covenants = calculateCovenants(
    totalDebtMinor,
    closingCashMinor,
    ebitdaMinor,
    totalInterestExpenseMinor,
  );

  let covenantError: BridgeError | null = null;
  if (covenants.is_breached) {
    covenantError = {
      code: "COVENANT_BREACH",
      userMessage: `Covenant breach detected: Net Debt / EBITDA (${covenants.net_debt_to_ebitda}x) or Interest Cover (${covenants.interest_cover}x) outside required thresholds.`,
      httpStatus: 422,
      retryable: false,
      retryAfterMs: null,
      details: {
        net_debt_to_ebitda: covenants.net_debt_to_ebitda,
        interest_cover: covenants.interest_cover,
      },
    };
  }

  // Error precedence: capexError || debtError || covenantError
  const activeError = capexError || debtError || covenantError;

  return {
    projectPreviews,
    calculatedFacilities,
    wcImpact,
    cashSchedule,
    covenants,
    error: activeError,
  };
}

export const useCapitalStore = create<CapitalStoreState>((set, get) => {
  const initialComputed = recomputeAll(
    INITIAL_PROJECTS,
    INITIAL_FACILITIES,
    INITIAL_WC_DRIVERS,
    INITIAL_OPENING_CASH,
    INITIAL_WEEKLY_RECEIPTS,
    INITIAL_WEEKLY_DISBURSEMENTS,
    INITIAL_WEEKLY_FINANCING,
    INITIAL_EBITDA,
  );

  return {
    status: "populated",
    error: initialComputed.error,
    currency: "INR",
    activeTab: "capital",

    projects: INITIAL_PROJECTS,
    facilities: INITIAL_FACILITIES,
    wcDrivers: INITIAL_WC_DRIVERS,
    openingCashMinor: INITIAL_OPENING_CASH,
    weeklyReceipts: INITIAL_WEEKLY_RECEIPTS,
    weeklyDisbursements: INITIAL_WEEKLY_DISBURSEMENTS,
    weeklyFinancing: INITIAL_WEEKLY_FINANCING,
    ebitdaMinor: INITIAL_EBITDA,

    projectPreviews: initialComputed.projectPreviews,
    calculatedFacilities: initialComputed.calculatedFacilities,
    wcImpact: initialComputed.wcImpact,
    cashSchedule: initialComputed.cashSchedule,
    covenants: initialComputed.covenants,

    setActiveTab: (tab) => set({ activeTab: tab }),

    load: async () => {
      set({ status: "loading", error: null });
      // Simulate loading state transitions
      await new Promise((resolve) => setTimeout(resolve, 50));
      const s = get();
      if (s.projects.length === 0 && s.facilities.length === 0) {
        set({ status: "empty" });
        return;
      }
      const comp = recomputeAll(
        s.projects,
        s.facilities,
        s.wcDrivers,
        s.openingCashMinor,
        s.weeklyReceipts,
        s.weeklyDisbursements,
        s.weeklyFinancing,
        s.ebitdaMinor,
      );
      if (comp.error) {
        set({
          status: "error",
          error: comp.error,
          projectPreviews: comp.projectPreviews,
          calculatedFacilities: comp.calculatedFacilities,
          wcImpact: comp.wcImpact,
          cashSchedule: comp.cashSchedule,
          covenants: comp.covenants,
        });
      } else {
        set({
          status: "populated",
          error: null,
          projectPreviews: comp.projectPreviews,
          calculatedFacilities: comp.calculatedFacilities,
          wcImpact: comp.wcImpact,
          cashSchedule: comp.cashSchedule,
          covenants: comp.covenants,
        });
      }
    },

    addProject: (p) => {
      const s = get();
      const newProj: CapitalProject = {
        ...p,
        id: `proj-${Date.now()}`,
      };
      const newProjects = [...s.projects, newProj];
      const comp = recomputeAll(
        newProjects,
        s.facilities,
        s.wcDrivers,
        s.openingCashMinor,
        s.weeklyReceipts,
        s.weeklyDisbursements,
        s.weeklyFinancing,
        s.ebitdaMinor,
      );
      if (comp.error) {
        set({
          projects: newProjects,
          projectPreviews: comp.projectPreviews,
          calculatedFacilities: comp.calculatedFacilities,
          wcImpact: comp.wcImpact,
          cashSchedule: comp.cashSchedule,
          covenants: comp.covenants,
          status: "error",
          error: comp.error,
        });
        return false;
      }
      set({
        projects: newProjects,
        projectPreviews: comp.projectPreviews,
        calculatedFacilities: comp.calculatedFacilities,
        wcImpact: comp.wcImpact,
        cashSchedule: comp.cashSchedule,
        covenants: comp.covenants,
        status: "populated",
        error: null,
      });
      return true;
    },

    updateProject: (p) => {
      const s = get();
      const newProjects = s.projects.map((proj) => (proj.id === p.id ? p : proj));
      const comp = recomputeAll(
        newProjects,
        s.facilities,
        s.wcDrivers,
        s.openingCashMinor,
        s.weeklyReceipts,
        s.weeklyDisbursements,
        s.weeklyFinancing,
        s.ebitdaMinor,
      );
      if (comp.error) {
        set({
          projects: newProjects,
          projectPreviews: comp.projectPreviews,
          status: "error",
          error: comp.error,
        });
        return false;
      }
      set({
        projects: newProjects,
        projectPreviews: comp.projectPreviews,
        status: "populated",
        error: null,
      });
      return true;
    },

    removeProject: (id) => {
      const s = get();
      const newProjects = s.projects.filter((p) => p.id !== id);
      const comp = recomputeAll(
        newProjects,
        s.facilities,
        s.wcDrivers,
        s.openingCashMinor,
        s.weeklyReceipts,
        s.weeklyDisbursements,
        s.weeklyFinancing,
        s.ebitdaMinor,
      );
      set({
        projects: newProjects,
        projectPreviews: comp.projectPreviews,
        status:
          newProjects.length === 0 && s.facilities.length === 0
            ? "empty"
            : comp.error
              ? "error"
              : "populated",
        error: comp.error,
      });
    },

    addFacility: (f) => {
      const s = get();
      const newFacility: DebtFacility = {
        ...f,
        id: `debt-${Date.now()}`,
      };
      const newFacilities = [...s.facilities, newFacility];
      const comp = recomputeAll(
        s.projects,
        newFacilities,
        s.wcDrivers,
        s.openingCashMinor,
        s.weeklyReceipts,
        s.weeklyDisbursements,
        s.weeklyFinancing,
        s.ebitdaMinor,
      );
      if (comp.error) {
        set({
          facilities: newFacilities,
          calculatedFacilities: comp.calculatedFacilities,
          covenants: comp.covenants,
          status: "error",
          error: comp.error,
        });
        return false;
      }
      set({
        facilities: newFacilities,
        calculatedFacilities: comp.calculatedFacilities,
        covenants: comp.covenants,
        status: "populated",
        error: null,
      });
      return true;
    },

    updateFacility: (f) => {
      const s = get();
      const newFacilities = s.facilities.map((fac) => (fac.id === f.id ? f : fac));
      const comp = recomputeAll(
        s.projects,
        newFacilities,
        s.wcDrivers,
        s.openingCashMinor,
        s.weeklyReceipts,
        s.weeklyDisbursements,
        s.weeklyFinancing,
        s.ebitdaMinor,
      );
      if (comp.error) {
        set({
          facilities: newFacilities,
          calculatedFacilities: comp.calculatedFacilities,
          covenants: comp.covenants,
          status: "error",
          error: comp.error,
        });
        return false;
      }
      set({
        facilities: newFacilities,
        calculatedFacilities: comp.calculatedFacilities,
        covenants: comp.covenants,
        status: "populated",
        error: null,
      });
      return true;
    },

    removeFacility: (id) => {
      const s = get();
      const newFacilities = s.facilities.filter((f) => f.id !== id);
      const comp = recomputeAll(
        s.projects,
        newFacilities,
        s.wcDrivers,
        s.openingCashMinor,
        s.weeklyReceipts,
        s.weeklyDisbursements,
        s.weeklyFinancing,
        s.ebitdaMinor,
      );
      set({
        facilities: newFacilities,
        calculatedFacilities: comp.calculatedFacilities,
        covenants: comp.covenants,
        status:
          s.projects.length === 0 && newFacilities.length === 0
            ? "empty"
            : comp.error
              ? "error"
              : "populated",
        error: comp.error,
      });
    },

    setWcDrivers: (drivers) => {
      const s = get();
      const updatedDrivers = { ...s.wcDrivers, ...drivers };
      const comp = recomputeAll(
        s.projects,
        s.facilities,
        updatedDrivers,
        s.openingCashMinor,
        s.weeklyReceipts,
        s.weeklyDisbursements,
        s.weeklyFinancing,
        s.ebitdaMinor,
      );
      set({
        wcDrivers: updatedDrivers,
        wcImpact: comp.wcImpact,
      });
    },

    updateWeeklyCash: (weekIndex, values) => {
      const s = get();
      const receipts = [...s.weeklyReceipts];
      const disbursements = [...s.weeklyDisbursements];
      const financing = [...s.weeklyFinancing];

      if (values.receipts !== undefined) receipts[weekIndex] = values.receipts;
      if (values.disbursements !== undefined) disbursements[weekIndex] = values.disbursements;
      if (values.financing !== undefined) financing[weekIndex] = values.financing;

      const comp = recomputeAll(
        s.projects,
        s.facilities,
        s.wcDrivers,
        s.openingCashMinor,
        receipts,
        disbursements,
        financing,
        s.ebitdaMinor,
      );
      set({
        weeklyReceipts: receipts,
        weeklyDisbursements: disbursements,
        weeklyFinancing: financing,
        cashSchedule: comp.cashSchedule,
        covenants: comp.covenants,
        error: comp.error,
        status: comp.error ? "error" : "populated",
      });
    },

    setEbitda: (ebitdaMinor) => {
      const s = get();
      const comp = recomputeAll(
        s.projects,
        s.facilities,
        s.wcDrivers,
        s.openingCashMinor,
        s.weeklyReceipts,
        s.weeklyDisbursements,
        s.weeklyFinancing,
        ebitdaMinor,
      );
      set({
        ebitdaMinor,
        covenants: comp.covenants,
        error: comp.error,
        status: comp.error ? "error" : "populated",
      });
    },

    setOpeningCash: (cashMinor) => {
      const s = get();
      const comp = recomputeAll(
        s.projects,
        s.facilities,
        s.wcDrivers,
        cashMinor,
        s.weeklyReceipts,
        s.weeklyDisbursements,
        s.weeklyFinancing,
        s.ebitdaMinor,
      );
      set({
        openingCashMinor: cashMinor,
        cashSchedule: comp.cashSchedule,
        covenants: comp.covenants,
        error: comp.error,
        status: comp.error ? "error" : "populated",
      });
    },

    triggerError: (code) => {
      let msg = "";
      if (code === "CAPEX_IN_SERVICE_INVALID") {
        msg = "Depreciation cannot start before the capital project's in-service date.";
      } else if (code === "DEBT_SCHEDULE_OVERDRAWN") {
        msg = "Debt repayments exceed facility balance or facility exceeds credit limit.";
      } else if (code === "COVENANT_BREACH") {
        msg = "Covenant breach detected: Net Debt / EBITDA or Interest Cover threshold violated.";
      }
      set({
        status: "error",
        error: {
          code,
          userMessage: msg,
          httpStatus: 422,
          retryable: true,
          retryAfterMs: null,
          details: {},
        },
      });
    },

    retry: async () => {
      const s = get();
      set({ status: "loading", error: null });
      await new Promise((r) => setTimeout(r, 20));
      const comp = recomputeAll(
        s.projects,
        s.facilities,
        s.wcDrivers,
        s.openingCashMinor,
        s.weeklyReceipts,
        s.weeklyDisbursements,
        s.weeklyFinancing,
        s.ebitdaMinor,
      );
      if (comp.error) {
        set({ status: "error", error: comp.error });
      } else {
        set({ status: "populated", error: null });
      }
    },

    clearAll: () => {
      set({
        projects: [],
        facilities: [],
        status: "empty",
        error: null,
      });
    },
  };
});
