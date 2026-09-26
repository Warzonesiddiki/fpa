/**
 * core model engine — single owner of the Model-grid edit/recalc computation (F-012, B14).
 *
 * This is the M3-1 HyperFormula graph (FORMULA-ENGINE-SPEC §5): a Web Worker owns the real
 * cell graph; this module is the pure, dependency-light core that the worker file wraps so the
 * exact same logic is unit-testable in-process (jsdom) and in the dedicated Worker.
 *
 * Zero-compromise invariants kept (mirror of `src-tauri/src/core/model.rs`):
 *  * Money never crosses as float: manual `value` stays an exact decimal string; the engine
 *    evaluates formulas in float for Excel parity and COMMIT-ROUNDS to Currency Scale via
 *    decimal.js (MONEY-ROUNDING-SPEC §1/§3) — the same contract as the Rust commit boundary.
 *  * Formula whitelist mirrored from `src/api/schema.ts` (`SUPPORTED_FUNCTIONS`) — the
 *    authoritative gate stays in Rust; the mirror rejects before IPC (B14 mirrored gates).
 *  * Cycle detection is explicit (`FORMULA_CYCLE`), never a silent fallback (FORMULA-ENGINE-SPEC §4).
 *  * No invented error codes — only the locked ERROR-HANDLING taxonomy (B20).
 */

import {
  HyperFormula,
  FunctionPlugin,
  FunctionArgumentType,
  CellError,
  ErrorType,
  SimpleRangeValue,
  type DetailedCellError,
  type SimpleCellAddress,
  type ImplementedFunctions,
} from "hyperformula";
import Decimal from "decimal.js";
import { findUnsupportedFunction } from "@/api/schema";
import {
  findFormulaReferences,
  findSCCs,
  isCyclicScc,
  rewriteFormulaReferences,
  solveCyclicScc,
  type CycleSolveRuntime,
  type FormulaReference,
} from "@/model/cycleSolver";

/** Max formula length — mirrors the Rust `MAX_FORMULA_LEN` guard (FORMULA-ENGINE-SPEC §1). */
export const MAX_FORMULA_LEN = 2048;

/**
 * Optional load behavior (FORMULA-ENGINE-SPEC §5 — Iterative Calculation Mode, AUDIT-04).
 * Additive: omitting the option (or passing nothing) keeps the historical behavior exactly.
 */
export interface LoadGridOptions {
  /**
   * Enable Iterative Calculation Mode: cyclic SCCs are relaxed to a dual-probe-validated fixed
   * point (α=0.5, ≤100 sweeps, 0.0001 minor-unit tolerance) instead of reporting `#CYCLE!`.
   * Default `false` — cycles keep emitting `FORMULA_CYCLE` exactly as before.
   */
  iterativeCalculation?: boolean;
}

/** A Model line row in the grid (GLOSSARY: Model / Line; a line is account-scoped). */
export interface ModelGridLine {
  /** line_id — a UUID (account-backed for M3-1; the Rust command takes any string). */
  id: string;
  /** Display label for the line row. */
  label: string;
  /** Planning Method chip (GLOSSARY: Planning Method — one of the 7). */
  method: "manual" | "static" | "driver" | "growth" | "yoy" | "seasonal" | "spread";
}

/** A Fiscal Period column in the grid (GLOSSARY: Fiscal Period). */
export interface ModelGridPeriod {
  /** period_id (`fp-...` per API-SPEC — derived from the calendar preview). */
  id: string;
  /** Short code e.g. "P08" for the column header. */
  code: string;
  /** Fiscal period start date (ISO `yyyy-mm-dd`) — carried from `calendar.preview` for the
   * fiscal-aware date functions FPERIOD/FPERIODSTART/PERIODLEN (FORMULA-ENGINE-SPEC §2, I5). */
  start_date?: string;
  /** Fiscal period end date (ISO `yyyy-mm-dd`, inclusive). */
  end_date?: string;
}

/** Input for a single cell edit — same shape as `model.cell.set.v1` args. */
export interface SetCellInput {
  line_id: string;
  period_id: string;
  /** Exact decimal string (never a JS number for money — B18-2). */
  value?: string | null;
  /** `=`-prefixed formula text. */
  formula?: string | null;
  manual_override?: boolean;
}

/** Rendered cell facts the grid displays. */
export interface GridCellView {
  line_id: string;
  period_id: string;
  /** Exact decimal string for a manual value (no float ever here). */
  amount_text: string | null;
  /** Formula text when the cell is formula-driven (formula icons on derived cells). */
  formula: string | null;
  /** Display value: manual amount or formula result commit-rounded to Currency Scale. */
  computed_text: string | null;
  /** Locked error code when the engine could not produce a value (`FORMULA_CYCLE` …). */
  error_code: string | null;
  manual_override: boolean;
}

/**
 * Inspection result for a single cell (M3-2 · FORMULA-ENGINE-SPEC §6).
 * `precedents`/`dependents` are `{line_id, period_id}` references resolved from the HF
 * address-space; `cycle` is the cycle path when `error_code === "FORMULA_CYCLE"`.
 */
export interface CellInspectResult {
  /** The inspected cell's coordinates. */
  line_id: string;
  period_id: string;
  /** Formula text, if any. */
  formula: string | null;
  /** Current computed display value. */
  computed_text: string | null;
  /** Error code (`FORMULA_CYCLE`, `REFERENCE_BROKEN`, or null). */
  error_code: string | null;
  /** Cells that this cell references (precedents). */
  precedents: CellRef[];
  /** Cells that reference this cell (dependents). */
  dependents: CellRef[];
  /** Cycle path when the cell is part of a cycle (ordered list of cell refs). */
  cycle: CellRef[] | null;
  /** Whether HF considers this cell part of a cycle. */
  is_cycle: boolean;
}

/** A resolved reference within the grid: `{line_id, period_id, sheet, col, row}`. */
export interface CellRef {
  line_id: string | null;
  period_id: string | null;
  /** Raw HF address sheet index (0-based). */
  sheet: number;
  col: number;
  row: number;
}

/** A recalc envelope in the API-SPEC §3 shape the grid/worker exchange. */
export interface EngineRecalcReport {
  dirty_cells: number;
  cycles: { path: string[] }[];
  changed_cells: string[];
  issues: { code: string; cell: string; details: Record<string, unknown> }[];
  duration_ms: number;
}

/** A Driver Table definition (F-013 · DATABASE-SCHEMA §6 `drivers` row). */
export interface DriverDef {
  /** `dr-…` slug (DB `drivers.id`). */
  id: string;
  name: string;
  driver_type:
    | "volume_x_rate"
    | "headcount"
    | "growth"
    | "seasonal"
    | "spread"
    | "ratio"
    | "manual";
  unit: string | null;
  source: "global" | "bu_override" | "collection" | "imported";
  is_core: boolean;
  /** Exact decimal string bounds (nullable when unbounded). */
  bounds_low: string | null;
  bounds_high: string | null;
}

/** A rendered Driver Table value (exact decimal string — never a float at this boundary). */
export interface DriverValueView {
  driver_id: string;
  period_id: string;
  amount_text: string | null;
}

/** A model-grid cell that references a driver's value (S-043 "driver → lines impact"). */
export interface DriverImpactRow {
  line_id: string;
  period_id: string;
  formula: string | null;
}

export interface SetCellResult {
  recalc: EngineRecalcReport;
  cell: GridCellView;
}

/** YTD/FY are derived, read-only display columns (SCREENS-SPEC S-041) computed by the engine. */
export type DerivedColumnKind = "ytd" | "fy";

/** A hardcoded numeric literal inside a formula (M3-4 · F-014 · US-015). The span indexes the
 *  ORIGINAL formula text, so `formula.slice(start, end)` is exactly the literal to replace. */
export interface HardcodedLiteral {
  literal: string;
  start: number;
  end: number;
}

/** A formula cell that hardcodes a value instead of referencing the Assumption Register. */
export interface HardcodedFinding {
  line_id: string;
  period_id: string;
  formula: string;
  literals: HardcodedLiteral[];
}

/** Fiscal metadata for one loaded period column (dates optional — legacy grids omit them). */
export interface PeriodMeta {
  id: string;
  code: string;
  start_date?: string;
  end_date?: string;
}

/** Column layout: the engine adds derived columns after the real periods. */
export interface GridLayout {
  lines: ModelGridLine[];
  periods: ModelGridPeriod[];
  /** Index (into `periods`) that YTD sums up to, inclusive. Defaults to the last period. */
  ytdThrough?: number;
}

const SHEET_NAME = "Model";
/** The permanent scratch sheet for Iterative Calculation Mode (AUDIT-04) — A = solved-value
 *  inputs the rewired Model cells point at, B = the rewritten SCC formulas (audit trail). */
const CYCLE_SHEET_NAME = "CycleSolver";

/* ── Analysis Functions Plugin (M3-10 · FORMULA-ENGINE-SPEC §2/§3) ─────────────────────
 * Registers the 8 OneFP&A-declared Analysis Functions as native HyperFormula functions so they
 * evaluate in the cell graph (`=CAGR(C2, C14, 12)` produces a value, not `#NAME?`). The calendar-
 * aware trio (`YOY`, `PRIORPERIOD`, `PRIORYEAR`) resolves their cell reference to a fiscal period
 * via the engine's period mapping, then reads the resolved cell value from the same sheet/row.
 *
 * The plugin is registered statically on the HyperFormula class (required before any HF instance
 * is built — §5: "Dependency graph built at load"). Calendar-aware functions access the engine
 * through a module-level reference set by the constructor; the reference is cleared on dispose.
 *
 * No float money at the boundary: HF cell values are IEEE-754 internally (Excel parity), but
 * the engine's exact decimal strings stay authoritative for display/persistence (B3/B18-2).
 */

/** Module-level engine reference — set by the ModelEngine constructor, cleared on dispose. */
let _engineRef: ModelEngine | null = null;

/** Parse `fp-{year}-p{period_no}` → `{year, periodNo}`. Returns null for non-matching ids. */
/** Convert a HyperFormula date serial (1900 system, `leapYear1900` default) to a UTC date.
 * Excel-compatible serials count days since 1899-12-30; the floor takes the date part. */
function serialToUtcDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Convert an ISO `yyyy-mm-dd` string to a UTC-midnight date (calendar metadata is date-only). */
function utcOfIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Convert a UTC-midnight date back to a HyperFormula date serial (1900 system). */
function dateSerial(d: Date): number {
  return Math.floor((d.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** The loaded period with the given period number (fiscal functions: FPERIODSTART/PERIODLEN). */
function findLoadedPeriod(periodNo: number): PeriodMeta | null {
  const engine = _engineRef;
  if (engine === null) return null;
  const n = Math.floor(periodNo);
  if (n !== periodNo || n < 1 || n > engine.periodMeta.length) return null;
  const exact = engine.periodMeta.find((p) => {
    const parsed = parsePeriodId(p.id);
    return parsed !== null && parsed.periodNo === n;
  });
  return exact ?? null;
}

function parsePeriodId(id: string): { year: number; periodNo: number } | null {
  const match = /^fp-(\d+)-p(\d+)$/.exec(id);
  if (!match) return null;
  return { year: parseInt(match[1], 10), periodNo: parseInt(match[2], 10) };
}

/** The total number of periods per fiscal year, auto-detected from the loaded period set. */
function detectPeriodsPerYear(periods: ModelGridPeriod[]): number {
  if (periods.length === 0) return 12;
  const years = new Set<number>();
  for (const p of periods) {
    const parsed = parsePeriodId(p.id);
    if (parsed) years.add(parsed.year);
  }
  if (years.size === 0) return 12;
  // Pick a year and count its periods (works for 12- and 13-period calendars).
  const sampleYear = years.values().next().value as number;
  return periods.filter((p) => {
    const parsed = parsePeriodId(p.id);
    return parsed !== null && parsed.year === sampleYear;
  }).length;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- HF 3.4.0 does not export the internal
 * `Ast`/`InterpreterState`/`InterpreterValue` types from its public entry; the plugin methods
 * match the parent `FunctionPlugin` signatures by position and are never called by user code. */
class OneFPAPlugin extends FunctionPlugin {
  static implementedFunctions: ImplementedFunctions = {
    CAGR: {
      method: "cagr",
      parameters: [
        { argumentType: FunctionArgumentType.NUMBER },
        { argumentType: FunctionArgumentType.NUMBER },
        { argumentType: FunctionArgumentType.NUMBER, minValue: 1 },
      ],
    },
    RATIO: {
      method: "ratio",
      parameters: [
        { argumentType: FunctionArgumentType.NUMBER },
        { argumentType: FunctionArgumentType.NUMBER },
      ],
    },
    MOVINGAVG: {
      method: "movingavg",
      parameters: [
        { argumentType: FunctionArgumentType.RANGE },
        { argumentType: FunctionArgumentType.NUMBER, minValue: 2 },
      ],
    },
    TREND: {
      method: "trend",
      parameters: [
        { argumentType: FunctionArgumentType.RANGE },
        { argumentType: FunctionArgumentType.NUMBER, minValue: 1 },
      ],
    },
    SEASONALITY: {
      method: "seasonality",
      parameters: [{ argumentType: FunctionArgumentType.RANGE }],
    },
    YOY: {
      method: "yoy",
      parameters: [{ argumentType: FunctionArgumentType.NUMBER }],
    },
    PRIORPERIOD: {
      method: "priorperiod",
      parameters: [{ argumentType: FunctionArgumentType.NUMBER }],
    },
    PRIORYEAR: {
      method: "prioryear",
      parameters: [{ argumentType: FunctionArgumentType.NUMBER }],
    },
    FPERIOD: {
      method: "fperiod",
      parameters: [{ argumentType: FunctionArgumentType.NUMBER }],
    },
    FQTR: {
      method: "fqtr",
      parameters: [{ argumentType: FunctionArgumentType.NUMBER }],
    },
    FYEAR: {
      method: "fyear",
      parameters: [{ argumentType: FunctionArgumentType.NUMBER }],
    },
    FPERIODSTART: {
      method: "fperiodstart",
      parameters: [{ argumentType: FunctionArgumentType.NUMBER }],
    },
    PERIODLEN: {
      method: "periodlen",
      parameters: [{ argumentType: FunctionArgumentType.NUMBER }],
    },
  };

  cagr(ast: any, state: any): any {
    return this.runFunction(
      ast.args,
      state,
      this.metadata("CAGR"),
      (start: number, end: number, periods: number) => {
        if (start === 0) return new CellError(ErrorType.VALUE);
        if (periods <= 0) return new CellError(ErrorType.VALUE);
        return Math.pow(end / start, 1 / periods) - 1;
      },
    );
  }

  ratio(ast: any, state: any): any {
    return this.runFunction(ast.args, state, this.metadata("RATIO"), (a: number, b: number) => {
      if (b === 0) return new CellError(ErrorType.DIV_BY_ZERO);
      return a / b;
    });
  }

  movingavg(ast: any, state: any): any {
    return this.runFunction(
      ast.args,
      state,
      this.metadata("MOVINGAVG"),
      (range: SimpleRangeValue, window: number) => {
        const raw = range.valuesFromTopLeftCorner();
        const nums = raw.filter((v): v is number => typeof v === "number");
        if (nums.length === 0 || window < 2) return new CellError(ErrorType.VALUE);
        const w = Math.floor(window);
        // Return the LAST moving average value (the most recent window).
        const start = Math.max(0, nums.length - w);
        const slice = nums.slice(start);
        return slice.reduce((s, v) => s + v, 0) / slice.length;
      },
    );
  }

  trend(ast: any, state: any): any {
    return this.runFunction(
      ast.args,
      state,
      this.metadata("TREND"),
      (range: SimpleRangeValue, points: number) => {
        const raw = range.valuesFromTopLeftCorner();
        const nums = raw.filter((v): v is number => typeof v === "number");
        if (nums.length < 2 || points < 1) return new CellError(ErrorType.VALUE);
        const n = nums.length;
        const sumX = (n * (n - 1)) / 2;
        const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
        const sumY = nums.reduce((s, v) => s + v, 0);
        const sumXY = nums.reduce((s, v, i) => s + v * i, 0);
        const denom = n * sumX2 - sumX * sumX;
        if (denom === 0) return new CellError(ErrorType.VALUE);
        const slope = (n * sumXY - sumX * sumY) / denom;
        const intercept = (sumY - slope * sumX) / n;
        // Return the FIRST projected point (period n+1, index = nums.length).
        return intercept + slope * nums.length;
      },
    );
  }

  seasonality(ast: any, state: any): any {
    return this.runFunction(
      ast.args,
      state,
      this.metadata("SEASONALITY"),
      (range: SimpleRangeValue) => {
        const raw = range.valuesFromTopLeftCorner();
        const nums = raw.filter((v): v is number => typeof v === "number");
        if (nums.length === 0) return new CellError(ErrorType.VALUE);
        const total = nums.reduce((s, v) => s + v, 0);
        if (total === 0) return 0;
        // Return the LAST seasonal index (share of the final period).
        return nums[nums.length - 1] / total;
      },
    );
  }

  /**
   * YOY(cell) — the VALUE of the cell at the same row, same period number, prior fiscal year.
   * The engine resolves the caller's column → period → prior-year period → column, then reads
   * the HF cell value at that address. Returns `#REF!` when the prior-year period is not loaded.
   */
  yoy(ast: any, state: any): any {
    return this.runFunctionWithReferenceArgument(
      ast.args,
      state,
      this.metadata("YOY"),
      () => new CellError(ErrorType.REF),
      (ref: SimpleCellAddress) => this.resolvePriorYearCell(ref),
    );
  }

  priorperiod(ast: any, state: any): any {
    return this.runFunctionWithReferenceArgument(
      ast.args,
      state,
      this.metadata("PRIORPERIOD"),
      () => new CellError(ErrorType.REF),
      (ref: SimpleCellAddress) => this.resolvePriorPeriodCell(ref),
    );
  }

  prioryear(ast: any, state: any): any {
    return this.runFunctionWithReferenceArgument(
      ast.args,
      state,
      this.metadata("PRIORYEAR"),
      () => new CellError(ErrorType.REF),
      (ref: SimpleCellAddress) => this.resolvePriorYearCell(ref),
    );
  }

  /** Resolve the same-row, prior-year-period cell value (YOY / PRIORYEAR). */
  private resolvePriorYearCell(ref: SimpleCellAddress): number | CellError {
    const engine = _engineRef;
    if (engine === null) return new CellError(ErrorType.REF);
    const periodId = engine.getPeriodIdForColumn(ref.col);
    if (periodId === null) return new CellError(ErrorType.REF);
    const parsed = parsePeriodId(periodId);
    if (parsed === null) return new CellError(ErrorType.REF);
    const priorId = `fp-${parsed.year - 1}-p${String(parsed.periodNo).padStart(2, "0")}`;
    return engine.getCellNumberAtPeriod(ref.row, priorId);
  }

  /** Resolve the same-row, previous-period cell value (PRIORPERIOD). */
  private resolvePriorPeriodCell(ref: SimpleCellAddress): number | CellError {
    const engine = _engineRef;
    if (engine === null) return new CellError(ErrorType.REF);
    const periodId = engine.getPeriodIdForColumn(ref.col);
    if (periodId === null) return new CellError(ErrorType.REF);
    const parsed = parsePeriodId(periodId);
    if (parsed === null) return new CellError(ErrorType.REF);
    const ppy = engine.periodsPerYear;
    let priorYear = parsed.year;
    let priorNo = parsed.periodNo - 1;
    if (priorNo < 1) {
      priorYear -= 1;
      priorNo = ppy;
    }
    const priorId = `fp-${priorYear}-p${String(priorNo).padStart(2, "0")}`;
    return engine.getCellNumberAtPeriod(ref.row, priorId);
  }

  /* ── Fiscal-aware date functions (FORMULA-ENGINE-SPEC §2, computed against the loaded
   * fiscal grid — I5: the calendar engine owns the periods; these only read them). ── */

  /** FPERIOD(date) — the fiscal period number (1–13) whose [start,end] contains the date. */
  fperiod(ast: any, state: any): any {
    return this.runFunction(ast.args, state, this.metadata("FPERIOD"), (serial: number) => {
      const engine = _engineRef;
      if (engine === null) return new CellError(ErrorType.VALUE);
      const d = serialToUtcDate(serial);
      if (d === null) return new CellError(ErrorType.VALUE);
      for (const p of engine.periodMeta) {
        if (!p.start_date || !p.end_date) continue;
        const s = utcOfIso(p.start_date);
        const e = utcOfIso(p.end_date);
        if (s && e && d >= s && d <= e) {
          const parsed = parsePeriodId(p.id);
          return parsed === null ? new CellError(ErrorType.VALUE) : parsed.periodNo;
        }
      }
      return new CellError(ErrorType.VALUE);
    });
  }

  /** FQTR(date) — the fiscal quarter (1–4) containing the date (3 periods per quarter, or 4×13w). */
  fqtr(ast: any, state: any): any {
    return this.runFunction(ast.args, state, this.metadata("FQTR"), (serial: number) => {
      const engine = _engineRef;
      if (engine === null) return new CellError(ErrorType.VALUE);
      const d = serialToUtcDate(serial);
      if (d === null) return new CellError(ErrorType.VALUE);
      for (const p of engine.periodMeta) {
        if (!p.start_date || !p.end_date) continue;
        const s = utcOfIso(p.start_date);
        const e = utcOfIso(p.end_date);
        if (s && e && d >= s && d <= e) {
          const parsed = parsePeriodId(p.id);
          if (parsed === null) return new CellError(ErrorType.VALUE);
          const per = engine.periodsPerYear >= 13 ? 4 : 3;
          return Math.ceil(parsed.periodNo / per);
        }
      }
      return new CellError(ErrorType.VALUE);
    });
  }

  /** FYEAR(date) — the fiscal year (calendar year of the FY start) containing the date. */
  fyear(ast: any, state: any): any {
    return this.runFunction(ast.args, state, this.metadata("FYEAR"), (serial: number) => {
      const engine = _engineRef;
      if (engine === null) return new CellError(ErrorType.VALUE);
      const d = serialToUtcDate(serial);
      if (d === null) return new CellError(ErrorType.VALUE);
      for (const p of engine.periodMeta) {
        if (!p.start_date || !p.end_date) continue;
        const s = utcOfIso(p.start_date);
        const e = utcOfIso(p.end_date);
        if (s && e && d >= s && d <= e) {
          const parsed = parsePeriodId(p.id);
          if (parsed === null) return new CellError(ErrorType.VALUE);
          // The period id's year IS the fiscal-year designator (`FY2026` → `fp-2026-*`).
          return parsed.year;
        }
      }
      return new CellError(ErrorType.VALUE);
    });
  }

  /** FPERIODSTART(p) — the start date of fiscal period `p` (1–13) of the loaded fiscal year, as a date serial. */
  fperiodstart(ast: any, state: any): any {
    return this.runFunction(ast.args, state, this.metadata("FPERIODSTART"), (periodNo: number) => {
      const target = findLoadedPeriod(periodNo);
      if (target === null || !target.start_date) return new CellError(ErrorType.VALUE);
      const d = utcOfIso(target.start_date);
      return d === null ? new CellError(ErrorType.VALUE) : dateSerial(d);
    });
  }

  /** PERIODLEN(p) — the length in days of fiscal period `p` (1–13) of the loaded fiscal year. */
  periodlen(ast: any, state: any): any {
    return this.runFunction(ast.args, state, this.metadata("PERIODLEN"), (periodNo: number) => {
      const target = findLoadedPeriod(periodNo);
      if (target === null || !target.start_date || !target.end_date)
        return new CellError(ErrorType.VALUE);
      const s = utcOfIso(target.start_date);
      const e = utcOfIso(target.end_date);
      if (s === null || e === null) return new CellError(ErrorType.VALUE);
      return Math.floor((e.getTime() - s.getTime()) / 86_400_000) + 1;
    });
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// Register the plugin statically with English translations — must happen before any HF instance
// is created (§5). HF requires translations for every registered function name; without them the
// formula parser returns `#NAME?` (the function is unknown to the language pack).
HyperFormula.registerFunctionPlugin(OneFPAPlugin, {
  enGB: {
    CAGR: "CAGR",
    RATIO: "RATIO",
    MOVINGAVG: "MOVINGAVG",
    TREND: "TREND",
    SEASONALITY: "SEASONALITY",
    YOY: "YOY",
    PRIORPERIOD: "PRIORPERIOD",
    PRIORYEAR: "PRIORYEAR",
    FPERIOD: "FPERIOD",
    FQTR: "FQTR",
    FYEAR: "FYEAR",
    FPERIODSTART: "FPERIODSTART",
    PERIODLEN: "PERIODLEN",
  },
});

/**
 * The M3-1 grid engine. One HyperFormula instance per engine (each Worker / store gets its own),
 * deterministic, and free of float money at the boundary.
 */
export class ModelEngine {
  private readonly hf: HyperFormula;
  private readonly scale: number;
  private sheetId: number | null = null;
  private lines: ModelGridLine[] = [];
  private periods: ModelGridPeriod[] = [];
  /** line_id → row index in the sheet (rows 1..N; row 0 is reserved for nothing). */
  private lineRow = new Map<string, number>();
  /** period_id → column index (cols 1..N; col 0 reserved for the line label). */
  private periodCol = new Map<string, number>();
  private dirtyLines = new Set<string>();
  /** Manual (non-formula) amounts keyed `line_id:period_id` — the exact decimal string. */
  private manualAmounts = new Map<string, string>();
  /** Manual-override flag per cell (GLOSSARY: Manual Override — an audited escape hatch). */
  private overrides = new Set<string>();
  /** Reverse lookup: row index → line_id. */
  private rowLine = new Map<number, string>();
  /** Reverse lookup: col index → period_id. */
  private colPeriod = new Map<number, string>();

  /** The dedicated "Drivers" sheet (M3-3 · MODELING-METHODS-SPEC §2) — driver values live in the
   *  same HyperFormula workbook as the Model grid so formulas can reference `Drivers!B2` etc. */
  private driversSheetId: number | null = null;
  /** Loaded driver definitions, indexed by driver_id. */
  private driverDefs = new Map<string, DriverDef>();
  /** driver_id → row index in the Drivers sheet (header row 0, drivers from row 1). */
  private driverRow = new Map<string, number>();
  /** Reverse lookup: driver sheet row index → driver_id. */
  private rowDriver = new Map<number, string>();
  /** Exact decimal strings for driver values keyed `driver_id:period_id` (B3 — never float here). */
  private driverAmounts = new Map<string, string>();
  /** Model lines loaded for the impact scan (mirrors `this.lines`). */
  private modelLines: ModelGridLine[] = [];
  /** Periods backing the Drivers sheet (mirrors the model grid's periods; separate so the Driver
   *  table is usable even before `loadGrid` runs). */
  private driverPeriods: ModelGridPeriod[] = [];
  /** Periods per fiscal year (12 for standard, 13 for 4-5-4; auto-detected from loaded periods). */
  private _periodsPerYear = 12;
  /** Fiscal metadata for the loaded period columns (dates carried from `calendar.preview`) —
   * consumed by the fiscal-aware date functions FPERIOD/FQTR/FYEAR/FPERIODSTART/PERIODLEN (I5). */
  private _periodMeta: PeriodMeta[] = [];

  /* ── Iterative Calculation Mode (AUDIT-04 · FORMULA-ENGINE-SPEC §5) ─────────────────────
   * Opt-in per load (default OFF — `#CYCLE!` exactly as before). Cyclic SCCs are relaxed to a
   * dual-probe-validated fixed point by `src/model/cycleSolver.ts` (Tarjan + damped
   * Gauss–Seidel, α=0.5, ≤100 sweeps, 0.0001 minor-unit tolerance). Solved members are rewired
   * to the permanent "CycleSolver" scratch sheet, so every dependent cell — including the
   * YTD/FY derived columns — picks the solved value up through HyperFormula's own propagation.
   * Unsolvable SCCs keep their original formula and therefore keep reporting `FORMULA_CYCLE`. */
  /** Iterative Calculation Mode flag (per load; default OFF — FORMULA-ENGINE-SPEC §5). */
  private iterativeCalculation = false;
  /** Original formula of a rewired (pointer) cycle cell, keyed `row:col` (Model-sheet coords).
   *  The live HF formula of a solved cell is a `=CycleSolver!A…` pointer; this map keeps the
   *  user's formula authoritative for graph detection, the formula bar, and the hardcoded scan.
   *  `""` = the cell is logically empty (a value/empty edit overwrote the pointer). */
  private cycleFormulas = new Map<string, string>();
  /** Solved cycle cells, keyed `row:col` → the relaxed float (the engine's float space —
   *  commit-rounded at display exactly like every other formula result). */
  private cycleSolved = new Map<string, number>();
  /** Every member of the current cyclic SCCs (solved and unsolved), keyed `row:col`. */
  private cycleMembers = new Set<string>();
  /** Unresolved cyclic SCCs — one ordered path per SCC, for the recalc envelope's `cycles`. */
  private unsolvedCycles: { path: string[] }[] = [];
  /** Member → its SCC's ordered member path (for `inspectCell.cycle`). */
  private cyclePaths = new Map<string, CellRef[]>();
  /** The "CycleSolver" scratch sheet id (null when no SCC is currently solved). */
  private cycleSheetId: number | null = null;

  constructor(scale = 2) {
    this.hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
    this.scale = scale;
    // Publish the engine reference so the custom function plugin's calendar-aware functions
    // (YOY/PRIORPERIOD/PRIORYEAR) can resolve prior-period cells (M3-10).
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- module-level ref for plugin.
    _engineRef = this;
  }

  /** Number of real period columns currently loaded. */
  get periodCount(): number {
    return this.periods.length;
  }

  /** Periods per fiscal year (12 or 13), auto-detected when the grid loads (M3-10). */
  get periodsPerYear(): number {
    return this._periodsPerYear;
  }

  /** Fiscal metadata (id/code/dates) for the loaded period columns. */
  get periodMeta(): PeriodMeta[] {
    return this._periodMeta;
  }

  /* ── Named Ranges (M3-10 · FORMULA-ENGINE-SPEC §1) ───────────────────────────────────
   * Named Ranges wrap HyperFormula's global named expressions. Each Assumption Register entry
   * (e.g. `wage_inflation = 0.05`) becomes a global named expression so formulas like
   * `=B2 * wage_inflation` resolve the name to the value without a sheet prefix.
   * Values are exact decimal strings; the HF cell is the float mirror for formula evaluation
   * (same commit-rounding contract as manual cell values — MONEY-ROUNDING-SPEC §3). */

  /**
   * Define or update a named range. The value is stored as the exact decimal string; HF
   * receives the numeric equivalent for formula evaluation. Throws on invalid names
   * (must be snake_case per the Assumption Register convention).
   */
  addNamedRange(name: string, value: string): void {
    if (!isValidAssumptionName(name)) {
      throw new Error("VALUE_INVALID: named range must be lowercase snake_case");
    }
    const numericValue = new Decimal(value).toNumber();
    // Update any prior definition in-place (changeNamedExpression preserves dependent formulas
    // and triggers a recalc). Only add when the name is entirely new.
    const existing = this.hf.listNamedExpressions();
    if (existing.includes(name)) {
      this.hf.changeNamedExpression(name, numericValue);
    } else {
      this.hf.addNamedExpression(name, numericValue);
    }
    // Named values feed formulas (constants) — a changed value can change a solved SCC's
    // fixed point, so re-solve (no-op when Iterative Calculation is OFF).
    this.refreshCycleSolves();
  }

  /** Remove a named range. No-op if the name is not defined. */
  removeNamedRange(name: string): void {
    const existing = this.hf.listNamedExpressions();
    if (existing.includes(name)) {
      this.hf.removeNamedExpression(name);
      this.refreshCycleSolves();
    }
  }

  /** List all currently defined named ranges (global). */
  listNamedRanges(): string[] {
    return this.hf.listNamedExpressions();
  }

  /** Read a named range's current HF-evaluated value (or null when undefined). */
  getNamedRangeValue(name: string): string | null {
    const raw = this.hf.getNamedExpressionValue(name);
    if (raw === undefined || raw === null) return null;
    if (typeof raw === "number") {
      return new Decimal(raw).toDecimalPlaces(this.scale, Decimal.ROUND_HALF_UP).toString();
    }
    return String(raw);
  }

  /** The period id at a given column (for the calendar-aware custom functions). */
  getPeriodIdForColumn(col: number): string | null {
    return this.colPeriod.get(col) ?? null;
  }

  /**
   * Read the HF-evaluated numeric value at a given (row, period_id) in the Model sheet.
   * Returns the float number on success, or a `#REF!` error when the period/row is absent.
   * Used by YOY/PRIORPERIOD/PRIORYEAR to resolve the prior-period cell.
   */
  getCellNumberAtPeriod(row: number, periodId: string): number | CellError {
    if (this.sheetId === null) return new CellError(ErrorType.REF);
    const col = this.periodCol.get(periodId);
    if (col === undefined) return new CellError(ErrorType.REF);
    const raw = this.hf.getCellValue({ sheet: this.sheetId, col, row });
    if (typeof raw === "number") return raw;
    return new CellError(ErrorType.REF);
  }

  /**
   * (Re)build the grid: one HyperFormula sheet with a label column, one column per period,
   * plus YTD/FY derived columns computed as formulas (SCREENS-SPEC S-041).
   */
  loadGrid(layout: GridLayout, options: LoadGridOptions = {}): void {
    this.lines = [...layout.lines];
    this.modelLines = [...layout.lines];
    this.periods = [...layout.periods];
    this._periodsPerYear = detectPeriodsPerYear(this.periods);
    this._periodMeta = this.periods.map((p) => ({
      id: p.id,
      code: p.code,
      start_date: p.start_date,
      end_date: p.end_date,
    }));
    this.lineRow.clear();
    this.periodCol.clear();
    this.dirtyLines.clear();
    this.manualAmounts.clear();
    this.overrides.clear();
    this.rowLine.clear();
    this.colPeriod.clear();
    // A fresh grid means a fresh Iterative Calculation solve: drop the prior state and scratch.
    this.iterativeCalculation = options.iterativeCalculation ?? false;
    this.cycleFormulas.clear();
    this.cycleSolved.clear();
    this.cycleMembers.clear();
    this.cyclePaths.clear();
    this.unsolvedCycles = [];
    this.removeCycleSheet();

    if (this.sheetId !== null) {
      this.hf.removeSheet(this.sheetId);
    }
    const sheetName = this.hf.addSheet(SHEET_NAME);
    const sheetId = this.hf.getSheetId(sheetName);
    if (sheetId === undefined) {
      throw new Error("INTERNAL: could not resolve the Model sheet id");
    }
    this.sheetId = sheetId;

    this.hf.batch(() => {
      // Row 0 = header (line label + period codes) so A1 refs in formulas are 1-based & readable.
      this.hf.setCellContents({ sheet: sheetId, col: 0, row: 0 }, "Line");
      this.periods.forEach((p, ci) => {
        const col = ci + 1;
        this.periodCol.set(p.id, col);
        this.colPeriod.set(col, p.id);
        this.hf.setCellContents({ sheet: sheetId, col, row: 0 }, p.code);
      });
      // Derived columns after the real periods.
      const ytdCol = this.periods.length + 1;
      const fyCol = this.periods.length + 2;
      this.hf.setCellContents({ sheet: sheetId, col: ytdCol, row: 0 }, "YTD");
      this.hf.setCellContents({ sheet: sheetId, col: fyCol, row: 0 }, "FY");

      this.lines.forEach((line, ri) => {
        const row = ri + 1;
        this.lineRow.set(line.id, row);
        this.rowLine.set(row, line.id);
        this.hf.setCellContents({ sheet: sheetId, col: 0, row }, line.label);
        // YTD = SUM(period1..periodYTD); FY = SUM(period1..periodN). Deterministic formulas.
        const first = 1;
        const last = Math.max(1, this.periods.length);
        const ytdTo = Math.max(first, Math.min(this.periods.length, layout.ytdThrough ?? last));
        const rangeYtd = this.range(sheetId, row, first, ytdTo);
        const rangeFy = this.range(sheetId, row, first, last);
        this.hf.setCellContents({ sheet: sheetId, col: ytdCol, row }, `=SUM(${rangeYtd})`);
        this.hf.setCellContents({ sheet: sheetId, col: fyCol, row }, `=SUM(${rangeFy})`);
      });
    });
    this.refreshCycleSolves();
  }

  private range(sheetId: number, row: number, colFrom: number, colTo: number): string {
    const sheetName = this.hf.getSheetName(sheetId);
    const from = this.hf.simpleCellAddressToString({ sheet: sheetId, col: colFrom, row }, 0);
    const to = this.hf.simpleCellAddressToString({ sheet: sheetId, col: colTo, row }, 0);
    return `${sheetName}!${from}:${to}`;
  }

  /**
   * Apply a cell edit to the graph and return the deterministic recalc envelope.
   * Validates the formula whitelist (mirror) and never writes a float as the stored amount.
   */
  setCell(input: SetCellInput): SetCellResult {
    if (this.sheetId === null) {
      throw new Error("INTERNAL: loadGrid must run before setCell");
    }
    const started = performance.now();
    const row = this.lineRow.get(input.line_id);
    const col = this.periodCol.get(input.period_id);
    if (row === undefined || col === undefined) {
      throw new Error("REFERENCE_BROKEN: unknown line or period in the loaded grid");
    }

    if (input.value == null && input.formula == null) {
      throw new Error("VALUE_INVALID: provide a value or a formula");
    }
    if (input.formula != null) {
      if (input.formula.length > MAX_FORMULA_LEN) {
        throw new Error("VALUE_INVALID: formula too long (max 2048 characters)");
      }
      if (!input.formula.startsWith("=")) {
        throw new Error("VALUE_INVALID: formulas must start with '='");
      }
      const unsupported = findUnsupportedFunction(input.formula);
      if (unsupported !== null) {
        throw new Error(`FORMULA_UNSUPPORTED_FUNCTION: ${unsupported}`);
      }
    }

    const sheetId = this.sheetId;
    const address = { sheet: sheetId, col, row };
    const cellKey = this.key(input.line_id, input.period_id);
    // Keep the logical (pre-pointer) formula current: if this cell is rewired to the
    // CycleSolver scratch, the stored original is what detection/display use (AUDIT-04).
    if (input.formula != null) {
      this.hf.setCellContents(address, input.formula);
      this.manualAmounts.delete(cellKey);
      this.cycleFormulas.set(this.coordKey(row, col), input.formula);
    } else if (input.value != null) {
      // Boundary guard: values must arrive as plain exact decimal strings — the
      // entry points (S-041 formula bar, paste) normalize Excel-style financial
      // text via parseFinancialNumber (AUDIT-02). A raw malformed string fails
      // with the locked code, never a raw Decimal error.
      if (!/^-?\d+(\.\d+)?$/.test(input.value)) {
        throw new Error(`VALUE_INVALID: '${input.value}' is not a valid amount`);
      }
      // HF's numeric cells are float-based (Excel parity), so this is the ONLY float crossing —
      // and it is not a money boundary: the exact decimal string stays authoritative in
      // `manualAmounts` (surfaced as `amount_text` verbatim), and any float result is
      // commit-rounded to Currency Scale before display (MONEY-ROUNDING-SPEC §3). The Rust
      // commit boundary (`parse_value_minor`) is the exact i64 conversion; this mirrors it.
      this.hf.setCellContents(address, new Decimal(input.value).toNumber());
      this.manualAmounts.set(cellKey, input.value);
      this.cycleFormulas.set(this.coordKey(row, col), "");
    } else {
      this.hf.setCellContents(address, null);
      this.manualAmounts.delete(cellKey);
      this.cycleFormulas.set(this.coordKey(row, col), "");
    }
    if (input.manual_override) this.overrides.add(cellKey);
    else this.overrides.delete(cellKey);
    this.dirtyLines.add(input.line_id);
    this.hf.rebuildAndRecalculate();
    this.refreshCycleSolves();

    const after = this.readCell(input.line_id, input.period_id);
    const recalc = this.recalcReport([input.line_id], started);
    const cell: GridCellView = { ...after, line_id: input.line_id, period_id: input.period_id };
    return { recalc, cell };
  }

  /** Full deterministic recalc of the graph, returning the envelope (API-SPEC §2/§3 shape). */
  recalc(changedHint: string[] = []): EngineRecalcReport {
    const started = performance.now();
    if (this.sheetId !== null) this.hf.rebuildAndRecalculate();
    this.refreshCycleSolves();
    return this.recalcReport(changedHint, started);
  }

  /** Read one cell's rendered facts. */
  getCell(line_id: string, period_id: string): GridCellView {
    return this.readCell(line_id, period_id);
  }

  /**
   * Clear a single cell back to empty (delete its content) and recompute the graph. Used by
   * undo-to-empty (the catalogued `model.cell.set.v1` requires a value or formula, so a clear is
   * a graph-only reconciliation — see `M3-9` store notes). Never leaves a float as the stored
   * amount: the cell simply has no `amount_text`/`formula` afterward.
   */
  clearCell(line_id: string, period_id: string): GridCellView {
    if (this.sheetId === null) {
      throw new Error("INTERNAL: loadGrid must run before clearCell");
    }
    const row = this.lineRow.get(line_id);
    const col = this.periodCol.get(period_id);
    if (row === undefined || col === undefined) {
      throw new Error("REFERENCE_BROKEN: unknown line or period in the loaded grid");
    }
    this.hf.setCellContents({ sheet: this.sheetId, col, row }, null);
    this.manualAmounts.delete(this.key(line_id, period_id));
    this.overrides.delete(this.key(line_id, period_id));
    this.cycleFormulas.set(this.coordKey(row, col), "");
    this.dirtyLines.add(line_id);
    this.hf.rebuildAndRecalculate();
    this.refreshCycleSolves();
    return this.readCell(line_id, period_id);
  }

  /** Snapshot the whole grid (lines × real periods) for rendering. */
  getGrid(): GridCellView[] {
    const out: GridCellView[] = [];
    for (const line of this.lines) {
      for (const period of this.periods) {
        out.push(this.readCell(line.id, period.id));
      }
    }
    return out;
  }

  /** Computed YTD/FY display values per line (derived columns; never persisted to cell.set). */
  getDerived(line_id: string): { ytd: string | null; fy: string | null } {
    if (this.sheetId === null || this.periods.length === 0) return { ytd: null, fy: null };
    const row = this.lineRow.get(line_id);
    if (row === undefined) return { ytd: null, fy: null };
    const sheetId = this.sheetId;
    const ytdCol = this.periods.length + 1;
    const fyCol = this.periods.length + 2;
    const ytd = this.hfValueToText(this.hf.getCellValue({ sheet: sheetId, col: ytdCol, row }));
    const fy = this.hfValueToText(this.hf.getCellValue({ sheet: sheetId, col: fyCol, row }));
    return { ytd, fy };
  }

  /* ── Driver Tables (M3-3 · F-013 · MODELING-METHODS-SPEC §2) ───────────────────────────
   * Driver values live in a dedicated "Drivers" sheet in the same HyperFormula workbook, so a
   * Model formula can reference them (`=Drivers!B2 * price`) and recompute when a value changes.
   * Every value is stored as the exact decimal string; bounds are enforced at `setDriverValue`
   * (DRIVER_OUT_OF_BOUNDS, never a silent clamp). */

  /**
   * (Re)build the Drivers sheet: one row per driver (name label at col 0), one column per period.
   * Removes any prior Drivers sheet first, so repeated loads are idempotent.
   */
  loadDrivers(drivers: DriverDef[], periods: ModelGridPeriod[]): void {
    if (this.driversSheetId !== null) {
      this.hf.removeSheet(this.driversSheetId);
    }
    this.driverDefs.clear();
    this.driverRow.clear();
    this.rowDriver.clear();
    this.driverAmounts.clear();
    this.driverPeriods = [...periods];
    if (drivers.length === 0) {
      this.driversSheetId = null;
      return;
    }
    const sheetName = this.hf.addSheet("Drivers");
    const sheetId = this.hf.getSheetId(sheetName);
    if (sheetId === undefined) {
      throw new Error("INTERNAL: could not resolve the Drivers sheet id");
    }
    this.driversSheetId = sheetId;
    this.hf.setCellContents({ sheet: sheetId, col: 0, row: 0 }, "Driver");
    periods.forEach((p, ci) => {
      this.hf.setCellContents({ sheet: sheetId, col: ci + 1, row: 0 }, p.code);
    });
    drivers.forEach((d, ri) => {
      const row = ri + 1;
      this.driverRow.set(d.id, row);
      this.rowDriver.set(row, d.id);
      this.driverDefs.set(d.id, d);
      this.hf.setCellContents({ sheet: sheetId, col: 0, row }, d.name);
    });
  }

  /**
   * Write a driver value for a period. Enforces the driver's bounds_low/bounds_high →
   * DRIVER_OUT_OF_BOUNDS (exact decimal comparison, never a float clamp), stores the exact string,
   * and recomputes the graph so dependent Model formulas update.
   */
  setDriverValue(
    driverId: string,
    periodId: string,
    valueText: string,
  ): { ok: true; recalc: EngineRecalcReport } {
    const sheetId = this.driversSheetId;
    const def = this.driverDefs.get(driverId);
    const row = this.driverRow.get(driverId);
    if (sheetId === null || def === undefined || row === undefined) {
      throw new Error("DRIVER_FEED_MISSING: driver is not loaded (define it first)");
    }
    const ci = this.driverPeriods.findIndex((p) => p.id === periodId);
    if (ci === -1) {
      throw new Error("REFERENCE_BROKEN: unknown period in the driver table");
    }

    const bounds = this.driverBounds(def);
    const parsed = new Decimal(valueText);
    if (bounds.low !== null && parsed.lessThan(bounds.low)) {
      throw new Error(
        `DRIVER_OUT_OF_BOUNDS: value ${valueText} is below its lower bound ${bounds.low.toString()}`,
      );
    }
    if (bounds.high !== null && parsed.greaterThan(bounds.high)) {
      throw new Error(
        `DRIVER_OUT_OF_BOUNDS: value ${valueText} is above its upper bound ${bounds.high.toString()}`,
      );
    }

    const started = performance.now();
    const col = ci + 1;
    const cellKey = this.driverKey(driverId, periodId);
    // HF's numeric cell is float-based (Excel parity); the exact decimal string stays authoritative
    // in `driverAmounts` and is what `getDriverValue` returns. Non-money driver values (units,
    // headcount) are surfaced verbatim — never a rounded float at this boundary.
    this.hf.setCellContents({ sheet: sheetId, col, row }, parsed.toNumber());
    this.driverAmounts.set(cellKey, valueText);
    this.hf.rebuildAndRecalculate();
    // Driver values are constant inputs to the SCC formulas — a change moves the fixed point.
    this.refreshCycleSolves();

    return { ok: true, recalc: this.driverRecalcReport(driverId, started) };
  }

  /** Read a driver value back as the exact decimal string (or null when unset). */
  getDriverValue(driverId: string, periodId: string): string | null {
    return this.driverAmounts.get(this.driverKey(driverId, periodId)) ?? null;
  }

  /** Snapshot all driver values (driver × period) for the S-043 table. */
  getDriverGrid(): DriverValueView[] {
    const out: DriverValueView[] = [];
    for (const driverId of this.driverRow.keys()) {
      for (const period of this.driverPeriods) {
        out.push({
          driver_id: driverId,
          period_id: period.id,
          amount_text: this.getDriverValue(driverId, period.id),
        });
      }
    }
    return out;
  }

  /** The loaded driver definitions (works alongside the store's own working set). */
  getDrivers(): DriverDef[] {
    return [...this.driverDefs.values()];
  }

  /**
   * Which model-grid cells reference a driver's value (S-043 "driver → lines impact"). Scans the
   * loaded Model grid's single-cell precedents for an address in the Drivers sheet at the driver's
   * row. Returns [] when the Model grid is not loaded or the driver has no referencing cells.
   */
  getDriverImpact(driverId: string): DriverImpactRow[] {
    if (this.sheetId === null) return [];
    const driverRow = this.driverRow.get(driverId);
    const driversSheet = this.hf.getSheetId("Drivers");
    if (driverRow === undefined || driversSheet === undefined) return [];
    const rows: DriverImpactRow[] = [];
    for (const line of this.modelLines) {
      for (const period of this.driverPeriods) {
        const row = this.lineRow.get(line.id);
        const col = this.periodCol.get(period.id);
        if (row === undefined || col === undefined) continue;
        const pre = this.hf.getCellPrecedents({ sheet: this.sheetId, col, row });
        const referencesDriver =
          pre.some((a) => "col" in a && a.sheet === driversSheet && a.row === driverRow) ||
          this.logicalFormulaReferencesDriver(row, col, driverRow);
        if (referencesDriver) {
          rows.push({
            line_id: line.id,
            period_id: period.id,
            formula: this.hf.getCellFormula({ sheet: this.sheetId, col, row }) ?? null,
          });
        }
      }
    }
    return rows;
  }

  /* ── Hardcoded-assumption detection (M3-4 · F-014 · US-015 · GLOSSARY Assumption Register) ──
   * A formula that hardcodes a value where an Assumption Register reference belongs is a
   * `HARDCODED_ASSUMPTION` finding (ERROR-HANDLING §E). The scan is read-only and deterministic;
   * `convertHardcoded` rewrites a single literal into a bare named-range reference
   * (FORMULA-ENGINE-SPEC §1: `wage_inflation`, case-insensitive) and recomputes the graph. */

  /** Scan every formula cell in the loaded grid for hardcoded numeric literals. */
  scanHardcoded(): HardcodedFinding[] {
    if (this.sheetId === null) return [];
    const findings: HardcodedFinding[] = [];
    for (const line of this.lines) {
      for (const period of this.periods) {
        const row = this.lineRow.get(line.id);
        const col = this.periodCol.get(period.id);
        if (row === undefined || col === undefined) continue;
        // Solved cycle cells hold a pointer live — scan the user's original formula.
        const formula = this.logicalFormula(row, col);
        if (formula == null) continue;
        const literals = findHardcodedLiterals(formula);
        if (literals.length > 0) {
          findings.push({ line_id: line.id, period_id: period.id, formula, literals });
        }
      }
    }
    return findings;
  }

  /**
   * Replace one hardcoded literal in a cell's formula with an Assumption Register reference and
   * recompute the graph. The reference is the bare named-range form (`wage_inflation`), per
   * FORMULA-ENGINE-SPEC §1; the `@name` form is the Driver-grammar / register-UI convention only.
   */
  convertHardcoded(
    line_id: string,
    period_id: string,
    literal: HardcodedLiteral,
    assumption_name: string,
  ): SetCellResult {
    if (this.sheetId === null) {
      throw new Error("INTERNAL: loadGrid must run before convertHardcoded");
    }
    const row = this.lineRow.get(line_id);
    const col = this.periodCol.get(period_id);
    if (row === undefined || col === undefined) {
      throw new Error("REFERENCE_BROKEN: unknown line or period in the loaded grid");
    }
    // Solved cycle cells hold a pointer live — convert the user's original formula.
    const formula = this.logicalFormula(row, col);
    if (formula == null) {
      throw new Error("REFERENCE_BROKEN: cell has no formula to convert");
    }
    const converted = convertHardcodedFormula(formula, literal, assumption_name);
    return this.setCell({ line_id, period_id, formula: converted });
  }

  private driverKey(driverId: string, periodId: string): string {
    return `${driverId}:${periodId}`;
  }

  /** Decimal bounds as a `{low, high}` pair (null when unbounded) for comparison. */
  private driverBounds(def: DriverDef): { low: Decimal | null; high: Decimal | null } {
    return {
      low: def.bounds_low === null ? null : new Decimal(def.bounds_low),
      high: def.bounds_high === null ? null : new Decimal(def.bounds_high),
    };
  }

  /** Standard recalc envelope after a driver value change, marking dependent lines dirty. */
  private driverRecalcReport(driverId: string, started: number): EngineRecalcReport {
    if (this.sheetId !== null) {
      const driverRow = this.driverRow.get(driverId);
      const driversSheet = this.hf.getSheetId("Drivers");
      if (driverRow !== undefined && driversSheet !== undefined) {
        for (const line of this.modelLines) {
          for (const period of this.driverPeriods) {
            const row = this.lineRow.get(line.id);
            const col = this.periodCol.get(period.id);
            if (row === undefined || col === undefined) continue;
            const pre = this.hf.getCellPrecedents({ sheet: this.sheetId, col, row });
            if (pre.some((a) => "col" in a && a.sheet === driversSheet && a.row === driverRow)) {
              this.dirtyLines.add(line.id);
            }
          }
        }
      }
    }
    return this.recalcReport([driverId], started);
  }

  /**
   * Inspect a single cell (M3-2 · FORMULA-ENGINE-SPEC §6): return its formula, computed text,
   * error code, and the set of precedent/dependent cells in the grid. Read-only, never mutates.
   */
  inspectCell(line_id: string, period_id: string): CellInspectResult {
    if (this.sheetId === null) {
      return {
        line_id,
        period_id,
        formula: null,
        computed_text: null,
        error_code: null,
        precedents: [],
        dependents: [],
        cycle: null,
        is_cycle: false,
      };
    }
    const row = this.lineRow.get(line_id);
    const col = this.periodCol.get(period_id);
    if (row === undefined || col === undefined) {
      return {
        line_id,
        period_id,
        formula: null,
        computed_text: null,
        error_code: "REFERENCE_BROKEN",
        precedents: [],
        dependents: [],
        cycle: null,
        is_cycle: false,
      };
    }

    const sheetId = this.sheetId;
    const address = { sheet: sheetId, col, row };
    const raw = this.hf.getCellValue(address);
    // Solved cycle cells hold a `=CycleSolver!A…` pointer live — surface the user's formula.
    const formula = this.logicalFormula(row, col);
    const computed_text = this.cellAmount(line_id, period_id) ?? this.hfValueToText(raw);
    const error_code = this.hfErrorCode(raw);
    const coordK = this.coordKey(row, col);
    // A solved member is still a cycle member (its value is relaxed, not non-cyclic).
    const is_cycle = this.cycleMembers.has(coordK) || error_code === "FORMULA_CYCLE";

    // Resolve HF cell addresses to our grid coordinates. `getCellPrecedents`/`getCellDependents`
    // return `(SimpleCellRange | SimpleCellAddress)[]` — we only trace single-cell refs for now
    // (range refs are expanded in a later milestone; this is the error-inspection path). A
    // rewired cycle cell's live precedents point at the scratch sheet, so its precedents come
    // from the original formula's text instead.
    const precedents =
      this.cycleFormulas.has(coordK) && formula !== null
        ? this.formulaPrecedents(formula, sheetId)
        : this.hf
            .getCellPrecedents(address)
            .filter((a): a is SimpleCellAddress => "col" in a)
            .map((a) => this.resolveRef(a));
    const dependents = this.hf
      .getCellDependents(address)
      .filter((a): a is SimpleCellAddress => "col" in a)
      .map((a) => this.resolveRef(a));

    // When the cell is a cycle, build the cycle path by tracing deep precedents (the solve
    // path is stored for solved/unsolved members in Iterative Calculation Mode).
    let cycle: CellRef[] | null = null;
    if (is_cycle) {
      cycle = this.cyclePaths.get(coordK) ?? this.traceCyclePath(address as SimpleCellAddress);
    }

    return {
      line_id,
      period_id,
      formula,
      computed_text,
      error_code,
      precedents,
      dependents,
      cycle,
      is_cycle,
    };
  }

  /**
   * Resolve an HF `SimpleCellAddress` back to our grid coordinates. The label column (col 0) or
   * derived columns (col > periodCount) have no period_id. Returns `null` placeholders when the
   * address falls outside the loaded grid.
   */
  private resolveRef(addr: SimpleCellAddress): CellRef {
    const line_id = this.rowLine.get(addr.row) ?? null;
    const period_id = this.colPeriod.get(addr.col) ?? null;
    return { line_id, period_id, sheet: addr.sheet, col: addr.col, row: addr.row };
  }

  /**
   * Walk precedents recursively to find the full cycle path. A cycle is detected when a cell
   * (indirectly) references itself. Returns the path ordered from the inspected cell through the
   * cycle loop, or `null` if no cycle is found.
   */
  private traceCyclePath(
    start: SimpleCellAddress,
    visited = new Set<string>(),
    path: CellRef[] = [],
  ): CellRef[] {
    const key = `${start.sheet}:${start.col}:${start.row}`;
    if (visited.has(key)) {
      // Found a loop — close the cycle.
      const loopStart = path.findIndex(
        (r) => r.sheet === start.sheet && r.col === start.col && r.row === start.row,
      );
      return loopStart >= 0 ? path.slice(loopStart) : [...path, this.resolveRef(start)];
    }
    if (visited.size > 64) return []; // safety limit
    visited.add(key);

    const pre = this.hf.getCellPrecedents(start).filter((a): a is SimpleCellAddress => "col" in a);
    for (const p of pre) {
      const subPath = this.traceCyclePath(p, visited, [...path, this.resolveRef(start)]);
      if (subPath.length > 0) return subPath;
    }
    return [];
  }

  private readCell(line_id: string, period_id: string): GridCellView {
    const row = this.lineRow.get(line_id);
    const col = this.periodCol.get(period_id);
    const amount = this.cellAmount(line_id, period_id);
    if (row === undefined || col === undefined) {
      return {
        line_id,
        period_id,
        amount_text: null,
        formula: null,
        computed_text: null,
        error_code: null,
        manual_override: false,
      };
    }
    const raw = this.hf.getCellValue({ sheet: this.sheetId as number, col, row });
    // Solved cycle cells hold a `=CycleSolver!A…` pointer live — surface the user's formula
    // and display the authoritative relaxed value (never a transient pointer read).
    const formula = this.logicalFormula(row, col);
    const solved = this.cycleSolved.get(this.coordKey(row, col));
    return {
      line_id,
      period_id,
      amount_text: amount,
      formula,
      // Manual cells display the exact stored string; formula cells commit-round the float
      // result to Currency Scale (MONEY-ROUNDING-SPEC §3) — never a raw float in the UI.
      // A solved cycle cell is a value, not an error, whatever the pointer cell holds.
      computed_text: amount ?? this.hfValueToText(solved ?? raw),
      error_code: solved !== undefined ? null : this.hfErrorCode(raw),
      manual_override: this.overrides.has(this.key(line_id, period_id)),
    };
  }

  /** The exact decimal string stored by the user (manual cells), or null for formula cells. */
  private cellAmount(line_id: string, period_id: string): string | null {
    // For manual values we stored the number in HF; reformatting a Decimal from the raw number
    // could reintroduce float drift — so the authoritative amount is tracked separately.
    return this.manualAmounts.get(this.key(line_id, period_id)) ?? null;
  }

  private key(line_id: string, period_id: string): string {
    return `${line_id}:${period_id}`;
  }

  private hfValueToText(raw: unknown): string | null {
    if (typeof raw === "number") {
      return new Decimal(raw).toDecimalPlaces(this.scale, Decimal.ROUND_HALF_UP).toString();
    }
    if (typeof raw === "string") return raw;
    if (raw !== null && typeof raw === "object") {
      const cell = raw as DetailedCellError;
      if (cell.type === "CYCLE") return "#CYCLE!";
      return cell.value != null ? String(cell.value) : null;
    }
    return null;
  }

  private hfErrorCode(raw: unknown): string | null {
    if (raw !== null && typeof raw === "object") {
      const cell = raw as DetailedCellError;
      if (cell.type === "CYCLE") return "FORMULA_CYCLE";
      if (cell.type === "REF") return "REFERENCE_BROKEN";
      if (cell.type === "DIV_BY_ZERO") return "VALUE_INVALID";
      if (cell.type === "VALUE") return "VALUE_INVALID";
      if (cell.type === "NA") return "REFERENCE_BROKEN";
    }
    return null;
  }

  private recalcReport(changedHint: string[], started: number): EngineRecalcReport {
    const changed = new Set<string>();
    for (const id of changedHint) changed.add(id);
    for (const line of this.lines) if (this.dirtyLines.has(line.id)) changed.add(line.id);
    this.dirtyLines.clear();

    const issues: EngineRecalcReport["issues"] = [];
    for (const cell of this.getGrid()) {
      if (cell.error_code === "FORMULA_CYCLE") {
        issues.push({
          code: "FORMULA_CYCLE",
          cell: this.ref(cell.line_id, cell.period_id),
          details: {},
        });
      }
    }

    const durationMs = Math.max(0, Math.floor(performance.now() - started));
    return {
      dirty_cells: changed.size,
      // Unresolved cyclic SCCs (Iterative Calculation Mode, AUDIT-04). Solved SCCs are
      // resolved, not cycles — they surface no issue and no path.
      cycles: this.unsolvedCycles,
      changed_cells: [...changed].sort(),
      issues,
      duration_ms: durationMs,
    };
  }

  private ref(line_id: string, period_id: string): string {
    const row = this.lineRow.get(line_id);
    const col = this.periodCol.get(period_id);
    if (row === undefined || col === undefined || this.sheetId === null)
      return `${line_id}:${period_id}`;
    return (
      this.hf.simpleCellAddressToString({ sheet: this.sheetId, col, row }, 0) ??
      `${line_id}:${period_id}`
    );
  }

  /* ── Iterative Calculation Mode — solver integration (AUDIT-04) ──────────────────────────
   * `refreshCycleSolves` runs on every graph mutation (loadGrid/setCell/clearCell/recalc/
   * setDriverValue/named ranges). It is a no-op when the mode is OFF (default) — the grid
   * keeps the `#CYCLE!` behavior exactly as before. When ON: cyclic SCCs are relaxed by
   * `solveCyclicScc` (dual-probe validated); solved members get rewired to the scratch sheet
   * so dependents resolve through HyperFormula's own propagation; unsolvable SCCs keep their
   * original formula and their `FORMULA_CYCLE`. */

  private coordKey(row: number, col: number): string {
    return `${row}:${col}`;
  }

  /** Excel-style address text for a Model-sheet coordinate (e.g. `B2` — 1-based). */
  private modelCellText(row: number, col: number): string {
    return this.hf.simpleCellAddressToString(
      { sheet: this.sheetId as number, col, row },
      0,
    ) as string;
  }

  /** The user's formula for a cell: the stored original for rewired cycle cells, the live HF
   *  formula otherwise. `null` = no formula (constant/empty). */
  private logicalFormula(row: number, col: number): string | null {
    const stored = this.cycleFormulas.get(this.coordKey(row, col));
    if (stored !== undefined) return stored === "" ? null : stored;
    if (this.sheetId === null) return null;
    return this.hf.getCellFormula({ sheet: this.sheetId, col, row }) ?? null;
  }

  private removeCycleSheet(): void {
    if (this.cycleSheetId !== null) {
      this.hf.removeSheet(this.cycleSheetId);
      this.cycleSheetId = null;
    }
  }

  /**
   * (Re)solve the cyclic SCCs of the loaded grid. Deterministic end to end: nodes/edges come
   * from the logical formulas in grid order, SCCs are solved in dependency (reverse
   * topological) order, and members are swept in (row, col) order by the solver.
   */
  private refreshCycleSolves(): void {
    this.cycleSolved.clear();
    this.cycleMembers.clear();
    this.cyclePaths.clear();
    this.unsolvedCycles = [];
    const sheetId = this.sheetId;
    if (
      !this.iterativeCalculation ||
      sheetId === null ||
      this.lines.length === 0 ||
      this.periods.length === 0
    ) {
      this.applyCyclePointers(new Map());
      this.removeCycleSheet();
      return;
    }

    // ── 1. Nodes: every in-grid cell with a logical formula (rows 1..N, cols 1..P+2 = YTD/FY).
    const lastRow = this.lines.length;
    const lastCol = this.periods.length + 2;
    const nodeCoord = new Map<string, { row: number; col: number }>();
    const formulaOf = new Map<string, string>();
    const nodes: string[] = [];
    for (let row = 1; row <= lastRow; row += 1) {
      for (let col = 1; col <= lastCol; col += 1) {
        const f = this.logicalFormula(row, col);
        if (f === null) continue;
        const id = this.coordKey(row, col);
        nodes.push(id);
        nodeCoord.set(id, { row, col });
        formulaOf.set(id, f);
      }
    }

    // ── 2. Edges: every in-grid reference target (ranges expanded to their full rectangle;
    //    other-sheet refs are constant inputs and can never be part of a grid cycle).
    const formulaIds = new Set(nodes);
    const edges = new Map<string, string[]>();
    for (const id of nodes) {
      const refs = findFormulaReferences(formulaOf.get(id) as string);
      if (refs.length === 0) continue;
      const list: string[] = [];
      for (const r of refs) {
        if (r.sheet !== null && r.sheet !== SHEET_NAME) continue;
        const rowMin = Math.min(r.startRow, r.endRow);
        const rowMax = Math.max(r.startRow, r.endRow);
        const colMin = Math.min(r.startCol, r.endCol);
        const colMax = Math.max(r.startCol, r.endCol);
        for (let rr = rowMin; rr <= rowMax; rr += 1) {
          for (let cc = colMin; cc <= colMax; cc += 1) {
            const to = this.coordKey(rr, cc);
            if (
              rr >= 1 &&
              rr <= lastRow &&
              cc >= 1 &&
              cc <= lastCol &&
              formulaIds.has(to) &&
              !list.includes(to)
            ) {
              list.push(to);
            }
          }
        }
      }
      if (list.length > 0) edges.set(id, list);
    }

    const cyclicSccs = findSCCs(nodes, edges).filter((scc) => isCyclicScc(scc, edges));
    const byCoord = (a: string, b: string): number => {
      const ca = nodeCoord.get(a) as { row: number; col: number };
      const cb = nodeCoord.get(b) as { row: number; col: number };
      return ca.row - cb.row || ca.col - cb.col;
    };

    // ── 3. No cycles: restore any stale pointers and drop the scratch sheet.
    if (cyclicSccs.length === 0) {
      this.applyCyclePointers(new Map());
      this.removeCycleSheet();
      return;
    }

    // Deterministic solve order: SCCs whose members reference another SCC are solved AFTER
    // their dependency, so a dependent formula can read the already-solved values.
    const sccIndexOf = new Map<string, number>();
    cyclicSccs.forEach((scc, i) => {
      for (const m of scc) sccIndexOf.set(m, i);
    });
    const dependsOn = cyclicSccs.map((scc, i) => {
      const deps = new Set<number>();
      for (const m of scc) {
        for (const t of edges.get(m) ?? []) {
          const j = sccIndexOf.get(t);
          // Intra-SCC edges are internal — a dependency is only ANOTHER SCC.
          if (j !== undefined && j !== i) deps.add(j);
        }
      }
      return deps;
    });
    const order: number[] = [];
    const placed = new Set<number>();
    for (;;) {
      const next = cyclicSccs
        .map((_, i) => i)
        .filter((i) => !placed.has(i) && [...(dependsOn[i] ?? [])].every((j) => placed.has(j)))
        .sort((a, b) => a - b)[0];
      if (next === undefined) break; // safety net — an SCC graph is always a DAG
      order.push(next);
      placed.add(next);
    }

    this.removeCycleSheet();
    const scratchHandle = this.hf.addSheet(CYCLE_SHEET_NAME);
    const scratchSheet = this.hf.getSheetId(scratchHandle);
    if (scratchSheet === undefined) {
      throw new Error("INTERNAL: could not resolve the CycleSolver sheet id");
    }
    this.cycleSheetId = scratchSheet;

    const cyclicMemberIds = new Set<string>();
    for (const scc of cyclicSccs) for (const m of scc) cyclicMemberIds.add(m);

    // ── 4. Solve SCCs in dependency order; one scratch row per member (offset per SCC).
    const solvedMembers = new Map<string, number>(); // node id → scratch row
    try {
      let rowOffset = 0;
      for (const si of order) {
        const scc = cyclicSccs[si] as string[];
        const members = [...scc].sort(byCoord);
        for (const m of members) this.cycleMembers.add(m);
        const scratchRows = new Map<string, number>();
        members.forEach((m, i) => scratchRows.set(m, rowOffset + i));
        rowOffset += members.length;

        const pathRefs: CellRef[] = members.map((m) => {
          const c = nodeCoord.get(m) as { row: number; col: number };
          return this.resolveRef({ sheet: sheetId, col: c.col, row: c.row });
        });
        for (const m of members) this.cyclePaths.set(m, pathRefs);

        // Rewrite every member's logical formula for the scratch sheet. Any ref shape that
        // cannot be rewritten safely refuses the WHOLE SCC — it keeps its original formula
        // and therefore its `FORMULA_CYCLE` (honest refusal, never a guessed rewrite).
        const rewritten: (string | null)[] = [];
        for (const m of members) {
          const f = formulaOf.get(m) as string;
          rewritten.push(
            rewriteFormulaReferences(f, (ref) =>
              this.rewriteCycleRef(
                ref,
                f,
                scratchRows,
                solvedMembers,
                cyclicMemberIds,
                lastRow,
                lastCol,
              ),
            ),
          );
        }
        if (rewritten.some((w) => w === null)) {
          this.unsolvedCycles.push({ path: pathRefs.map((r) => this.modelCellText(r.row, r.col)) });
          continue;
        }

        // Build the scratch rows: A = input (seed 0), B = the rewritten formula.
        this.hf.batch(() => {
          members.forEach((m, i) => {
            const scratchRow = scratchRows.get(m) as number;
            this.hf.setCellContents({ sheet: scratchSheet, col: 0, row: scratchRow }, 0);
            this.hf.setCellContents(
              { sheet: scratchSheet, col: 1, row: scratchRow },
              rewritten[i] as string,
            );
          });
        });

        // The live scratch IS the runtime state: writing a member's input lets later members'
        // evaluations see it (strict Gauss–Seidel through HyperFormula's own propagation).
        const runtime: CycleSolveRuntime = {
          evaluate: (nodeId) => {
            const raw = this.hf.getCellValue({
              sheet: scratchSheet,
              col: 1,
              row: scratchRows.get(nodeId) as number,
            });
            // A formula error inside the SCC (e.g. #DIV/0!) means no numeric solution.
            return typeof raw === "number" ? raw : null;
          },
          write: (nodeId, value) => {
            this.hf.setCellContents(
              { sheet: scratchSheet, col: 0, row: scratchRows.get(nodeId) as number },
              value,
            );
          },
        };
        const result = solveCyclicScc(members, runtime, { scale: this.scale });
        if (result.converged) {
          // Commit the canonical (primary-probe) values into the A inputs the pointers read.
          members.forEach((m, i) => {
            const value = (result.values[i] as [string, number])[1];
            const scratchRow = scratchRows.get(m) as number;
            this.hf.setCellContents({ sheet: scratchSheet, col: 0, row: scratchRow }, value);
            solvedMembers.set(m, scratchRow);
            this.cycleSolved.set(m, value);
          });
        } else {
          this.unsolvedCycles.push({ path: pathRefs.map((r) => this.modelCellText(r.row, r.col)) });
        }
      }
    } catch (err) {
      // Never leave a half-solved state behind: restore every pointer and drop the scratch.
      this.applyCyclePointers(new Map());
      this.removeCycleSheet();
      throw err;
    }

    // ── 5. Rewire the solved members to their scratch inputs; restore the rest.
    this.applyCyclePointers(solvedMembers);
    if (solvedMembers.size === 0) this.removeCycleSheet();
  }

  /**
   * Rewrite one reference of a cycle member's formula for the scratch sheet. Returns the
   * replacement text, or `null` when the shape cannot be rewritten safely (the whole SCC
   * then stays `#CYCLE!`). Rules: member of this SCC or an already-solved SCC → scratch input;
   * member of another (not-yet-settled) SCC → refuse; anything else in the Model grid →
   * qualified `Model!` ref; other sheets → pass through as written.
   */
  private rewriteCycleRef(
    ref: FormulaReference,
    formula: string,
    scratchRows: Map<string, number>,
    solvedMembers: Map<string, number>,
    cyclicMemberIds: ReadonlySet<string>,
    lastRow: number,
    lastCol: number,
  ): string | null {
    if (ref.sheet !== null && ref.sheet !== SHEET_NAME) {
      return formula.slice(ref.start, ref.end); // other sheets: absolute, as written
    }
    const rowMin = Math.min(ref.startRow, ref.endRow);
    const rowMax = Math.max(ref.startRow, ref.endRow);
    const colMin = Math.min(ref.startCol, ref.endCol);
    const colMax = Math.max(ref.startCol, ref.endCol);
    if (rowMin === rowMax && colMin === colMax) {
      const key = this.coordKey(rowMin, colMin);
      const own = scratchRows.get(key);
      if (own !== undefined) return `CycleSolver!A${own + 1}`;
      const solved = solvedMembers.get(key);
      if (solved !== undefined) return `CycleSolver!A${solved + 1}`;
      if (cyclicMemberIds.has(key)) return null; // another SCC — value not settled here
      return `Model!${this.modelCellText(rowMin, colMin)}`;
    }
    // Range: rewritable when the WHOLE rectangle is single-column members of this SCC with
    // contiguous scratch rows; otherwise an all-Model rectangle stays a qualified `Model!`
    // range; anything mixed (members + non-members) is refused.
    let allOwn = colMin === colMax;
    const ownRows: number[] = [];
    for (let rr = rowMin; rr <= rowMax && allOwn; rr += 1) {
      for (let cc = colMin; cc <= colMax; cc += 1) {
        const own = scratchRows.get(this.coordKey(rr, cc));
        if (own === undefined) {
          allOwn = false;
          break;
        }
        ownRows.push(own);
      }
    }
    if (allOwn) {
      const lo = Math.min(...ownRows);
      const hi = Math.max(...ownRows);
      if (hi - lo + 1 === ownRows.length) {
        return `CycleSolver!A${lo + 1}:CycleSolver!A${hi + 1}`;
      }
      return null; // interleaved with another member's scratch rows — refuse
    }
    if (rowMin >= 1 && rowMax <= lastRow && colMin >= 1 && colMax <= lastCol) {
      return `Model!${this.modelCellText(rowMin, colMin)}:${this.modelCellText(rowMax, colMax)}`;
    }
    return null; // mixed/out-of-grid range — refuse
  }

  /**
   * Point solved cycle cells at their scratch inputs and restore every cell that is no longer
   * a solved member. Only cells whose live content is still a pointer (or that are becoming
   * one) are touched — a cell the user edited in the meantime keeps its edit.
   */
  private applyCyclePointers(solved: Map<string, number>): void {
    const sheetId = this.sheetId;
    if (sheetId === null) return;
    const keys = new Set<string>([...this.cycleFormulas.keys(), ...solved.keys()]);
    if (keys.size === 0) return;
    this.hf.batch(() => {
      for (const k of keys) {
        const sep = k.indexOf(":");
        const row = parseInt(k.slice(0, sep), 10);
        const col = parseInt(k.slice(sep + 1), 10);
        const address = { sheet: sheetId, col, row };
        const scratchRow = solved.get(k);
        const live = this.hf.getCellFormula(address);
        const isPointer = typeof live === "string" && live.startsWith("=CycleSolver!");
        if (scratchRow !== undefined) {
          // (Re)wire the pointer — covers new solves, moved scratch rows, and re-solved edits.
          this.cycleFormulas.set(k, this.cycleFormulas.get(k) ?? live ?? "");
          this.hf.setCellContents(address, `=CycleSolver!A${scratchRow + 1}`);
        } else if (isPointer) {
          const original = this.cycleFormulas.get(k);
          this.hf.setCellContents(
            address,
            original === undefined || original === "" ? null : original,
          );
          this.cycleFormulas.delete(k);
        } else {
          this.cycleFormulas.delete(k); // changed underneath us (user edit) — drop the stale entry
        }
      }
    });
  }

  /** Precedent refs derived from a formula's text (the path for rewired cycle cells, whose
   *  live formula is a scratch pointer). Ranges are expanded to their grid cells. */
  private formulaPrecedents(formula: string, sheetId: number): CellRef[] {
    const refs: CellRef[] = [];
    for (const r of findFormulaReferences(formula)) {
      if (r.sheet === null || r.sheet === SHEET_NAME) {
        const rowMin = Math.min(r.startRow, r.endRow);
        const rowMax = Math.max(r.startRow, r.endRow);
        const colMin = Math.min(r.startCol, r.endCol);
        const colMax = Math.max(r.startCol, r.endCol);
        for (let rr = rowMin; rr <= rowMax; rr += 1) {
          for (let cc = colMin; cc <= colMax; cc += 1) {
            refs.push(this.resolveRef({ sheet: sheetId, col: cc, row: rr }));
          }
        }
      } else {
        const targetSheet = this.hf.getSheetId(r.sheet);
        if (targetSheet === undefined) continue;
        refs.push(this.resolveRef({ sheet: targetSheet, col: r.startCol, row: r.startRow }));
      }
    }
    return refs;
  }

  /** Whether a rewired cycle cell's original formula references the given Drivers row — the
   *  live formula is a scratch pointer and its precedents no longer see the original refs. */
  private logicalFormulaReferencesDriver(row: number, col: number, driverRow: number): boolean {
    const stored = this.cycleFormulas.get(this.coordKey(row, col));
    if (stored === undefined || stored === "") return false;
    return findFormulaReferences(stored).some(
      (r) =>
        r.sheet === "Drivers" &&
        Math.min(r.startRow, r.endRow) <= driverRow &&
        driverRow <= Math.max(r.startRow, r.endRow),
    );
  }
}

/** Exact-decimal analysis helpers declared by FORMULA-ENGINE-SPEC §3.
 * These are intentionally exposed as engine calculations rather than IPC commands; callers
 * can use them while the HyperFormula graph remains the sole owner of cell dependencies.
 */
export type AnalysisFunction = "CAGR" | "MOVINGAVG" | "TREND" | "SEASONALITY";

export function computeAnalysisFunction(
  fn: AnalysisFunction,
  values: readonly string[],
  argument?: string,
): string[] {
  const decimals = values.map((value) => new Decimal(value));
  if (decimals.length === 0) return [];
  if (fn === "CAGR") {
    if (decimals.length < 2 || argument === undefined)
      throw new Error("VALUE_INVALID: CAGR requires periods");
    const periods = new Decimal(argument);
    if (periods.lte(0) || decimals[0].isZero())
      throw new Error("VALUE_INVALID: invalid CAGR inputs");
    return [
      decimals[decimals.length - 1]
        .div(decimals[0])
        .pow(new Decimal(1).div(periods))
        .sub(1)
        .toString(),
    ];
  }
  if (fn === "MOVINGAVG") {
    const window = parseInt(argument ?? "0", 10);
    if (window < 2) throw new Error("VALUE_INVALID: moving-average window must be at least 2");
    return decimals.map((_, index) => {
      const start = Math.max(0, index - window + 1);
      const slice = decimals.slice(start, index + 1);
      return slice
        .reduce((sum, value) => sum.plus(value), new Decimal(0))
        .div(slice.length)
        .toString();
    });
  }
  if (fn === "TREND") {
    const points = parseInt(argument ?? "0", 10);
    if (points < 1 || decimals.length < 2)
      throw new Error("VALUE_INVALID: trend requires points and two values");
    const n = new Decimal(decimals.length);
    const sumX = n.mul(n.sub(1)).div(2);
    const sumX2 = n.mul(n.sub(1)).mul(n.mul(2).sub(1)).div(6);
    const sumY = decimals.reduce((sum, value) => sum.plus(value), new Decimal(0));
    const sumXY = decimals.reduce(
      (sum, value, index) => sum.plus(value.mul(index)),
      new Decimal(0),
    );
    const slope = n
      .mul(sumXY)
      .sub(sumX.mul(sumY))
      .div(n.mul(sumX2).sub(sumX.mul(sumX)));
    const intercept = sumY.sub(slope.mul(sumX)).div(n);
    return Array.from({ length: points }, (_, index) =>
      intercept.plus(slope.mul(decimals.length + index)).toString(),
    );
  }
  const total = decimals.reduce((sum, value) => sum.plus(value), new Decimal(0));
  if (total.isZero()) return decimals.map(() => "0");
  return decimals.map((value) => value.div(total).toString());
}

/** Assumption names are lowercase snake_case identifiers (matches the Rust `valid_name` gate). */
export function isValidAssumptionName(name: string): boolean {
  return /^[a-z_][a-z0-9_]*$/.test(name);
}

/**
 * Find hardcoded numeric literals in a formula (M3-4 · FORMULA-ENGINE-SPEC §4 · US-015).
 *
 * A literal is "hardcoded" when it is a decimal/percent number that is NOT part of a string
 * literal, a cell reference (`B2`, `Drivers!B2`, `'Opex Detail'!C10`, `$A$1`, `A1:B10`), or an
 * identifier (function / named-range name such as `SUM`, `wage_inflation`, `log10`). The returned
 * spans index the original formula, so a caller can swap `formula.slice(start, end)` for a
 * register reference. Purely deterministic; no float arithmetic.
 */
export function findHardcodedLiterals(formula: string): HardcodedLiteral[] {
  if (formula.length === 0) return [];
  let masked = formula;
  // 1. Quoted string literals — their contents are data, never an assumption to convert. Each
  //    replacement keeps the same length, so every later span still indexes the original text.
  masked = masked.replace(/"[^"]*"/g, (m) => " ".repeat(m.length));
  // 2. Cell references. The column letters must not be preceded by an identifier char so names
  //    like `log10` / `wage_inflation2` stay names instead of being misread as `g10`-style refs.
  masked = masked.replace(/(?<![A-Za-z0-9_.])\$?[A-Za-z]{1,4}\$?\d+/g, (m) => " ".repeat(m.length));
  // 3. Identifiers (function + named-range names) — never hardcoded values.
  masked = masked.replace(/[A-Za-z_][A-Za-z0-9_.]*/g, (m) => " ".repeat(m.length));
  // 4. What remains as a number token is a hardcoded literal.
  const findings: HardcodedLiteral[] = [];
  const token = /\d+(?:\.\d+)?%?|\.\d+%?/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(masked)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    // Defensive: a number still glued to a leftover identifier char belongs to a name we could
    // not fully mask (steps 2/3 should have handled it) — skip rather than misreport.
    if (start > 0 && /[A-Za-z0-9_.]/.test(formula[start - 1])) continue;
    findings.push({ literal: match[0], start, end });
  }
  return findings;
}

/**
 * Rewrite `formula`, replacing the literal at `literal.start..end` with `assumptionName` as a
 * bare named-range reference (FORMULA-ENGINE-SPEC §1). Never silently edits: the span must still
 * hold the exact literal, and the name must be a valid snake_case identifier.
 */
export function convertHardcodedFormula(
  formula: string,
  literal: HardcodedLiteral,
  assumptionName: string,
): string {
  if (!isValidAssumptionName(assumptionName)) {
    throw new Error("VALUE_INVALID: assumption name must be lowercase snake_case");
  }
  if (formula.slice(literal.start, literal.end) !== literal.literal) {
    throw new Error("VALUE_INVALID: literal no longer matches the cell formula");
  }
  return formula.slice(0, literal.start) + assumptionName + formula.slice(literal.end);
}
