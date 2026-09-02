/**
 * M3-9 Excel-parity grid helpers — pure, fully unit-tested (F-012 · SCREENS-SPEC S-041).
 *
 * Everything here is money-safe: it never converts money to a JS float — values stay exact
 * decimal strings end-to-end, and column-letter / row math is plain integer arithmetic. Decimal
 * validation uses a precise regex plus `Decimal` for finiteness only (never for storage).
 *
 * These helpers back the store-level undo/redo, fill, paste, and copy behaviours. They contain no
 * IPC, no React, and no AG-Grid — so the Excel-parity semantics are verifiable in-process without
 * a browser (FORMULA-ENGINE-SPEC §5 single-source-of-truth principle, mirrored client-side).
 */

import Decimal from "decimal.js";
import type { GridCellView, SetCellInput } from "@/workers/modelEngine";

/** A grid rectangle defined by its anchor and focus corners (both inclusive). */
export interface SelectionRect {
  anchor: { lineId: string; periodId: string };
  focus: { lineId: string; periodId: string };
}

/* ── Snapshots & history ─────────────────────────────────────────────────────────────── */

/** The minimal, exact facts needed to restore a single cell (B3 — no float money). */
export interface CellSnapshot {
  line_id: string;
  period_id: string;
  /** Exact decimal string for a manual value; `null` for formula or empty cells. */
  value: string | null;
  /** `=`-prefixed formula; `null` for manual or empty cells. */
  formula: string | null;
  manual_override: boolean;
}

/** One undoable unit: the before/after of every cell it touched (one user action = one entry). */
export interface HistoryEntry {
  id: number;
  /** `edit` | `fill-down` | `fill-right` | `paste` | `clear` — for UX/telemetry only. */
  label: string;
  cells: { before: CellSnapshot; after: CellSnapshot }[];
}

/** ≥100 undo levels (HARD constraint: undo/redo ≥100). Cap comfortably above the floor. */
export const MAX_HISTORY = 250;

/**
 * In-memory, single-flight edit history. Undo/redo replay the stored snapshots through the real
 * graph (the store wraps each replay in the audited `model.cell.set.v1` path). Not persisted —
 * it is a client editing convenience, reset on `load`/`reset` (B14 — Rust stays the money owner).
 */
export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private seq = 0;

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Number of undoable entries currently held (for status/telemetry). */
  get depth(): number {
    return this.undoStack.length;
  }

  /** Record a new user action; clears the redo branch (standard editor semantics). */
  push(entry: Omit<HistoryEntry, "id">): HistoryEntry {
    const full: HistoryEntry = { ...entry, id: ++this.seq };
    this.undoStack.push(full);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    return full;
  }

  /** Pop the most recent action for undo, moving it onto the redo branch. */
  popUndo(): HistoryEntry | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    this.redoStack.push(e);
    if (this.redoStack.length > MAX_HISTORY) this.redoStack.shift();
    return e;
  }

  /** Pop the most recent undone action for redo, moving it back onto the undo branch. */
  popRedo(): HistoryEntry | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    this.undoStack.push(e);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    return e;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

/* ── Snapshot ↔ edit conversion ───────────────────────────────────────────────────────── */

/** Build a restore snapshot from a rendered cell view. */
export function snapshotFromView(view: GridCellView): CellSnapshot {
  if (view.formula != null) {
    return {
      line_id: view.line_id,
      period_id: view.period_id,
      value: null,
      formula: view.formula,
      manual_override: view.manual_override,
    };
  }
  return {
    line_id: view.line_id,
    period_id: view.period_id,
    value: view.amount_text,
    formula: null,
    manual_override: view.manual_override,
  };
}

/** Convert a snapshot back into a `model.cell.set.v1`-shaped edit (exactly one of value/formula). */
export function snapshotToInput(s: CellSnapshot): SetCellInput {
  return {
    line_id: s.line_id,
    period_id: s.period_id,
    value: s.value,
    formula: s.formula,
    manual_override: s.manual_override,
  };
}

/* ── Relative formula reference adjustment (fill down/right) ────────────────────────────── */

/** Excel A1 column letters → 1-based index. */
function colToNum(col: string): number {
  let n = 0;
  for (let i = 0; i < col.length; i += 1) n = n * 26 + (col.charCodeAt(i) - 64);
  return n;
}

/** 1-based index → Excel A1 column letters. */
function numToCol(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/**
 * Adjust every relative cell reference in a formula by `(dRow, dCol)` — the same delta the grid
 * applies when filling down/right. Absolute refs (`$B$2`) are pinned; mixed refs (`$B2`, `B$2`)
 * pin only their marked axis. Sheet-qualified refs (`Model!B2`, `Drivers!B3`) are preserved.
 *
 * The HyperFormula graph maps grid line index→row (`row = line + 1`) and period index→column
 * (`col = period + 1`), so a line delta is exactly an HF row delta and a period delta exactly an
 * HF column delta. Returns the formula unchanged when the delta is zero.
 *
 * Refs shifted off the grid (column < A or row < 1) are left untouched rather than corrupted
 * (Excel would surface `#REF!`; we keep the original reference to avoid silently breaking a
 * dependent formula).
 */
const REF_RE =
  /(?<![A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_]*!)?(\$?)([A-Z]+)(\$?)(\d+)(?![A-Za-z0-9_.])(?!\()/g;

export function adjustFormulaRefs(formula: string, dRow: number, dCol: number): string {
  if (dRow === 0 && dCol === 0) return formula;
  return formula.replace(
    REF_RE,
    (m, sheet: string | undefined, absCol: string, col: string, absRow: string, row: string) => {
      let newCol = col;
      if (!absCol) {
        const n = colToNum(col) + dCol;
        if (n < 1) return m; // off the left edge — keep as-is
        newCol = numToCol(n);
      }
      let newRow = row;
      if (!absRow) {
        const r = parseInt(row, 10) + dRow;
        if (r < 1) return m; // off the top edge — keep as-is
        newRow = String(r);
      }
      return `${sheet ?? ""}${absCol}${newCol}${absRow}${newRow}`;
    },
  );
}

/* ── Paste block parsing & validation (VALUE_INVALID, no silent cast) ───────────────────── */

export type ParsedPasteKind = "empty" | "formula" | "value";

export interface ParsedPasteCell {
  kind: ParsedPasteKind;
  value: string | null;
  formula: string | null;
}

/** Exact decimal string: optional sign, digits, optional fraction — never scientific/locale. */
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

function parsePasteCell(raw: string): ParsedPasteCell {
  if (raw === "") return { kind: "empty", value: null, formula: null };
  // A pasted formula is applied verbatim; the engine whitelist still gates it downstream.
  if (raw.startsWith("=")) return { kind: "formula", value: null, formula: raw };
  if (DECIMAL_RE.test(raw)) {
    // Finiteness check only — the string stays the source of truth (no float crossing).
    const d = new Decimal(raw);
    if (!d.isFinite()) throw new Error("VALUE_INVALID: amount is not a finite decimal.");
    return { kind: "value", value: raw, formula: null };
  }
  // Anything else (money text "USD 100", thousands "1,000", scientific "1e3", junk) is rejected.
  throw new Error(`VALUE_INVALID: '${raw}' is not a valid decimal or formula.`);
}

/**
 * Parse a TSV/CSV clipboard block into a matrix of paste cells. Throws `VALUE_INVALID` (the locked
 * code) on any non-empty cell that is not an exact decimal or a formula — no silent coercion.
 * Trailing blank lines (a common artifact of copy) are trimmed.
 */
export function parsePasteBlock(text: string): ParsedPasteCell[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawRows = normalized.split("\n");
  while (rawRows.length > 1 && rawRows[rawRows.length - 1].trim() === "") rawRows.pop();

  // One delimiter for the whole block: tabs win (TSV), otherwise CSV comma.
  const delimiter = text.includes("\t") ? "\t" : ",";
  const matrix: ParsedPasteCell[][] = [];
  for (const raw of rawRows) {
    if (raw.trim() === "" && matrix.length > 0) continue; // ignore blank interior lines
    matrix.push(raw.split(delimiter).map((c) => parsePasteCell(c.trim())));
  }
  if (matrix.length === 0) throw new Error("VALUE_INVALID: the clipboard block is empty.");
  return matrix;
}

/* ── Fill (down / right) edit construction ──────────────────────────────────────────────── */

export interface FillContext {
  direction: "down" | "right";
  anchor: { lineId: string; periodId: string };
  focus: { lineId: string; periodId: string };
  lines: { id: string }[];
  periods: { id: string }[];
  /** Read the current (source) cell view for a coordinate. */
  getCell: (lineId: string, periodId: string) => GridCellView | null;
}

function inclusiveRange(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i += 1) out.push(i);
  return out;
}

/**
 * Build the ordered list of edits that fill `direction` from the selection's source edge across
 * its target span. A single selected cell fills the rest of its column (down) or row (right);
 * a range fills only within the range. Formula sources have their references shifted by the
 * relative (line, period) delta so `=B2` becomes `=B3` when filled one row down.
 */
export function buildFillEdits(ctx: FillContext): SetCellInput[] {
  const lineIds = ctx.lines.map((l) => l.id);
  const periodIds = ctx.periods.map((p) => p.id);
  const ai = lineIds.indexOf(ctx.anchor.lineId);
  const aj = periodIds.indexOf(ctx.anchor.periodId);
  const fi = lineIds.indexOf(ctx.focus.lineId);
  const fj = periodIds.indexOf(ctx.focus.periodId);
  if (ai < 0 || aj < 0 || fi < 0 || fj < 0) return [];

  const minI = Math.min(ai, fi);
  const maxI = Math.max(ai, fi);
  const minJ = Math.min(aj, fj);
  const maxJ = Math.max(aj, fj);

  const edits: SetCellInput[] = [];

  if (ctx.direction === "down") {
    const srcI = minI;
    const targets =
      maxI > srcI ? inclusiveRange(srcI + 1, maxI) : inclusiveRange(srcI + 1, lineIds.length - 1);
    for (const c of inclusiveRange(minJ, maxJ)) {
      const src = ctx.getCell(lineIds[srcI], periodIds[c]);
      if (!src) continue;
      for (const ti of targets) {
        edits.push(snapshotToEdit(lineIds[ti], periodIds[c], src, ti - srcI, 0));
      }
    }
  } else {
    const srcJ = minJ;
    const targets =
      maxJ > srcJ ? inclusiveRange(srcJ + 1, maxJ) : inclusiveRange(srcJ + 1, periodIds.length - 1);
    for (const r of inclusiveRange(minI, maxI)) {
      const src = ctx.getCell(lineIds[r], periodIds[srcJ]);
      if (!src) continue;
      for (const tj of targets) {
        edits.push(snapshotToEdit(lineIds[r], periodIds[tj], src, 0, tj - srcJ));
      }
    }
  }
  return edits;
}

function snapshotToEdit(
  lineId: string,
  periodId: string,
  src: GridCellView,
  dRow: number,
  dCol: number,
): SetCellInput {
  if (src.formula != null) {
    return {
      line_id: lineId,
      period_id: periodId,
      formula: adjustFormulaRefs(src.formula, dRow, dCol),
      manual_override: src.manual_override,
    };
  }
  return {
    line_id: lineId,
    period_id: periodId,
    value: src.amount_text,
    manual_override: src.manual_override,
  };
}

/* ── Paste edit construction ─────────────────────────────────────────────────────────────── */

export interface PasteContext {
  text: string;
  anchor: { lineId: string; periodId: string };
  lines: { id: string }[];
  periods: { id: string }[];
}

/** Map a parsed clipboard block onto grid edits anchored at the active cell; clips overflow. */
export function buildPasteEdits(ctx: PasteContext): SetCellInput[] {
  const matrix = parsePasteBlock(ctx.text);
  const lineIds = ctx.lines.map((l) => l.id);
  const periodIds = ctx.periods.map((p) => p.id);
  const ai = lineIds.indexOf(ctx.anchor.lineId);
  const aj = periodIds.indexOf(ctx.anchor.periodId);
  if (ai < 0 || aj < 0) return [];

  const edits: SetCellInput[] = [];
  matrix.forEach((row, r) => {
    const ti = ai + r;
    if (ti < 0 || ti >= lineIds.length) return;
    row.forEach((cell, c) => {
      const tj = aj + c;
      if (tj < 0 || tj >= periodIds.length) return;
      if (cell.kind === "empty") {
        edits.push({
          line_id: lineIds[ti],
          period_id: periodIds[tj],
          value: null,
          formula: null,
          manual_override: false,
        });
      } else if (cell.kind === "formula") {
        edits.push({
          line_id: lineIds[ti],
          period_id: periodIds[tj],
          formula: cell.formula,
          manual_override: false,
        });
      } else {
        edits.push({
          line_id: lineIds[ti],
          period_id: periodIds[tj],
          value: cell.value,
          manual_override: false,
        });
      }
    });
  });
  return edits;
}

/* ── Selection serialization (copy) ─────────────────────────────────────────────────────── */

/** Render a rectangular block of cells as TSV (formula text when present, else exact decimal). */
export function serializeSelection(cells: (GridCellView | null)[][]): string {
  return cells
    .map((row) =>
      row.map((c) => (c?.formula != null ? c.formula : (c?.amount_text ?? ""))).join("\t"),
    )
    .join("\n");
}
