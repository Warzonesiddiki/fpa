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

import { HyperFormula, type DetailedCellError, type SimpleCellAddress } from "hyperformula";
import Decimal from "decimal.js";
import { findUnsupportedFunction } from "@/api/schema";

/** Max formula length — mirrors the Rust `MAX_FORMULA_LEN` guard (FORMULA-ENGINE-SPEC §1). */
export const MAX_FORMULA_LEN = 2048;

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

export interface SetCellResult {
  recalc: EngineRecalcReport;
  cell: GridCellView;
}

/** YTD/FY are derived, read-only display columns (SCREENS-SPEC S-041) computed by the engine. */
export type DerivedColumnKind = "ytd" | "fy";

/** Column layout: the engine adds derived columns after the real periods. */
export interface GridLayout {
  lines: ModelGridLine[];
  periods: ModelGridPeriod[];
  /** Index (into `periods`) that YTD sums up to, inclusive. Defaults to the last period. */
  ytdThrough?: number;
}

const SHEET_NAME = "Model";

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

  constructor(scale = 2) {
    this.hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
    this.scale = scale;
  }

  /** Number of real period columns currently loaded. */
  get periodCount(): number {
    return this.periods.length;
  }

  /**
   * (Re)build the grid: one HyperFormula sheet with a label column, one column per period,
   * plus YTD/FY derived columns computed as formulas (SCREENS-SPEC S-041).
   */
  loadGrid(layout: GridLayout): void {
    this.lines = [...layout.lines];
    this.periods = [...layout.periods];
    this.lineRow.clear();
    this.periodCol.clear();
    this.dirtyLines.clear();
    this.manualAmounts.clear();
    this.overrides.clear();
    this.rowLine.clear();
    this.colPeriod.clear();

    if (this.sheetId !== null) {
      this.hf.removeSheet(this.sheetId);
    }
    const sheetName = this.hf.addSheet(SHEET_NAME);
    const sheetId = this.hf.getSheetId(sheetName);
    if (sheetId === undefined) {
      throw new Error("INTERNAL: could not resolve the Model sheet id");
    }
    this.sheetId = sheetId;

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
    if (input.formula != null) {
      this.hf.setCellContents(address, input.formula);
      this.manualAmounts.delete(cellKey);
    } else if (input.value != null) {
      // HF's numeric cells are float-based (Excel parity), so this is the ONLY float crossing —
      // and it is not a money boundary: the exact decimal string stays authoritative in
      // `manualAmounts` (surfaced as `amount_text` verbatim), and any float result is
      // commit-rounded to Currency Scale before display (MONEY-ROUNDING-SPEC §3). The Rust
      // commit boundary (`parse_value_minor`) is the exact i64 conversion; this mirrors it.
      this.hf.setCellContents(address, new Decimal(input.value).toNumber());
      this.manualAmounts.set(cellKey, input.value);
    } else {
      this.hf.setCellContents(address, null);
      this.manualAmounts.delete(cellKey);
    }
    if (input.manual_override) this.overrides.add(cellKey);
    else this.overrides.delete(cellKey);
    this.dirtyLines.add(input.line_id);
    this.hf.rebuildAndRecalculate();

    const after = this.readCell(input.line_id, input.period_id);
    const recalc = this.recalcReport([input.line_id], started);
    const cell: GridCellView = { ...after, line_id: input.line_id, period_id: input.period_id };
    return { recalc, cell };
  }

  /** Full deterministic recalc of the graph, returning the envelope (API-SPEC §2/§3 shape). */
  recalc(changedHint: string[] = []): EngineRecalcReport {
    const started = performance.now();
    if (this.sheetId !== null) this.hf.rebuildAndRecalculate();
    return this.recalcReport(changedHint, started);
  }

  /** Read one cell's rendered facts. */
  getCell(line_id: string, period_id: string): GridCellView {
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
    const formula = this.hf.getCellFormula(address) ?? null;
    const computed_text = this.cellAmount(line_id, period_id) ?? this.hfValueToText(raw);
    const error_code = this.hfErrorCode(raw);
    const is_cycle = error_code === "FORMULA_CYCLE";

    // Resolve HF cell addresses to our grid coordinates. `getCellPrecedents`/`getCellDependents`
    // return `(SimpleCellRange | SimpleCellAddress)[]` — we only trace single-cell refs for now
    // (range refs are expanded in a later milestone; this is the error-inspection path).
    const precedents = this.hf
      .getCellPrecedents(address)
      .filter((a): a is SimpleCellAddress => "col" in a)
      .map((a) => this.resolveRef(a));
    const dependents = this.hf
      .getCellDependents(address)
      .filter((a): a is SimpleCellAddress => "col" in a)
      .map((a) => this.resolveRef(a));

    // When the cell is a cycle, build the cycle path by tracing deep precedents.
    let cycle: CellRef[] | null = null;
    if (is_cycle) {
      cycle = this.traceCyclePath({ sheet: sheetId, col, row } as SimpleCellAddress);
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
    const formula = this.hf.getCellFormula({ sheet: this.sheetId as number, col, row }) ?? null;
    return {
      line_id,
      period_id,
      amount_text: amount,
      formula,
      // Manual cells display the exact stored string; formula cells commit-round the float
      // result to Currency Scale (MONEY-ROUNDING-SPEC §3) — never a raw float in the UI.
      computed_text: amount ?? this.hfValueToText(raw),
      error_code: this.hfErrorCode(raw),
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
      cycles: [],
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
}
