import { describe, expect, it } from "vitest";
import {
  History,
  MAX_HISTORY,
  adjustFormulaRefs,
  buildFillEdits,
  buildPasteEdits,
  parsePasteBlock,
  serializeSelection,
  snapshotFromView,
  snapshotToInput,
  type SelectionRect,
} from "./modelHistory";
import type { GridCellView } from "@/workers/modelEngine";

const LINES = [{ id: "L0" }, { id: "L1" }, { id: "L2" }];
const PERIODS = [{ id: "P0" }, { id: "P1" }, { id: "P2" }];

function cell(over: Partial<GridCellView>): GridCellView {
  return {
    line_id: "L0",
    period_id: "P0",
    amount_text: null,
    formula: null,
    computed_text: null,
    error_code: null,
    manual_override: false,
    ...over,
  };
}

function makeMap(
  entries: Record<string, GridCellView>,
): (lineId: string, periodId: string) => GridCellView | null {
  return (lineId, periodId) => entries[`${lineId}:${periodId}`] ?? null;
}

describe("History (M3-9 undo/redo stack)", () => {
  it("starts empty and tracks canUndo/canRedo", () => {
    const h = new History();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.depth).toBe(0);
  });

  it("pushes an entry and moves it between undo/redo branches", () => {
    const h = new History();
    const e = h.push({
      label: "edit",
      cells: [
        {
          before: {
            line_id: "L0",
            period_id: "P0",
            value: null,
            formula: null,
            manual_override: false,
          },
          after: {
            line_id: "L0",
            period_id: "P0",
            value: "1",
            formula: null,
            manual_override: false,
          },
        },
      ],
    });
    expect(e.id).toBe(1);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);

    const popped = h.popUndo();
    expect(popped?.id).toBe(1);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);

    const redone = h.popRedo();
    expect(redone?.id).toBe(1);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it("clears the redo branch on a new push (standard editor semantics)", () => {
    const h = new History();
    h.push({ label: "a", cells: [] });
    h.popUndo();
    expect(h.canRedo).toBe(true);
    h.push({ label: "b", cells: [] });
    expect(h.canRedo).toBe(false);
    // A new edit after undo drops the undone entry (standard editor semantics): only `b` remains.
    expect(h.depth).toBe(1);
  });

  it("caps the stack at MAX_HISTORY (≥100 levels)", () => {
    expect(MAX_HISTORY).toBeGreaterThanOrEqual(100);
    const h = new History();
    for (let i = 0; i < MAX_HISTORY + 50; i += 1) {
      h.push({ label: "e", cells: [] });
    }
    expect(h.depth).toBe(MAX_HISTORY);
  });

  it("clear() empties both branches", () => {
    const h = new History();
    h.push({ label: "e", cells: [] });
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});

describe("adjustFormulaRefs (relative fill references)", () => {
  it("shifts relative refs down/right by the grid delta", () => {
    expect(adjustFormulaRefs("=B2+1", 1, 0)).toBe("=B3+1");
    expect(adjustFormulaRefs("=B2+1", 0, 1)).toBe("=C2+1");
  });

  it("pins fully-absolute refs and only the marked axis of mixed refs", () => {
    expect(adjustFormulaRefs("=$B$2", 1, 1)).toBe("=$B$2");
    expect(adjustFormulaRefs("=B$2", 1, 0)).toBe("=B$2"); // row absolute → row pinned
    expect(adjustFormulaRefs("=$B2", 1, 0)).toBe("=$B3"); // col absolute, row relative
  });

  it("adjusts sheet-qualified refs and ranges", () => {
    expect(adjustFormulaRefs("=Model!B2+C2", 1, 0)).toBe("=Model!B3+C3");
    expect(adjustFormulaRefs("=Drivers!B2*2", 1, 0)).toBe("=Drivers!B3*2");
    expect(adjustFormulaRefs("=SUM(B2:C2)", 1, 0)).toBe("=SUM(B3:C3)");
  });

  it("leaves a ref unchanged when the shift would move it off the grid", () => {
    expect(adjustFormulaRefs("=A1", 0, -1)).toBe("=A1"); // col would become 0
    expect(adjustFormulaRefs("=A1", -1, 0)).toBe("=A1"); // row would become 0
  });

  it("is a no-op when the delta is zero", () => {
    expect(adjustFormulaRefs("=B2+1", 0, 0)).toBe("=B2+1");
  });

  it("does not corrupt function names (only true cell refs shift)", () => {
    expect(adjustFormulaRefs("=LOG10(A1)", 1, 0)).toBe("=LOG10(A2)");
    expect(adjustFormulaRefs("=FPERIOD(A1,B1)", 1, 1)).toBe("=FPERIOD(B2,C2)");
  });
});

describe("parsePasteBlock (VALUE_INVALID, no silent cast)", () => {
  it("parses a TSV block of exact decimals", () => {
    const m = parsePasteBlock("1.00\t2.00\n3.00\t4.00");
    expect(m).toEqual([
      [
        { kind: "value", value: "1.00", formula: null },
        { kind: "value", value: "2.00", formula: null },
      ],
      [
        { kind: "value", value: "3.00", formula: null },
        { kind: "value", value: "4.00", formula: null },
      ],
    ]);
  });

  it("parses a CSV block when there is no tab", () => {
    const m = parsePasteBlock("1,2,3");
    expect(m[0]).toEqual([
      { kind: "value", value: "1", formula: null },
      { kind: "value", value: "2", formula: null },
      { kind: "value", value: "3", formula: null },
    ]);
  });

  it("treats a leading = as a formula cell", () => {
    const m = parsePasteBlock("=B2+1");
    expect(m[0][0]).toEqual({ kind: "formula", value: null, formula: "=B2+1" });
  });

  it("trims a single trailing newline", () => {
    const m = parsePasteBlock("1.00\n2.00\n");
    expect(m).toHaveLength(2);
  });

  it("rejects non-decimal money text with VALUE_INVALID (no silent cast)", () => {
    expect(() => parsePasteBlock("USD 100")).toThrow(/VALUE_INVALID/);
    expect(() => parsePasteBlock("1.2.3")).toThrow(/VALUE_INVALID/);
    expect(() => parsePasteBlock("1.2e3")).toThrow(/VALUE_INVALID/);
    expect(() => parsePasteBlock("abc")).toThrow(/VALUE_INVALID/);
  });

  it("parses a single empty cell (no-op paste) without throwing", () => {
    expect(parsePasteBlock("")).toEqual([[{ kind: "empty", value: null, formula: null }]]);
  });
});

describe("serializeSelection (copy → TSV)", () => {
  it("emits formula text or exact decimal per cell, tab/row separated", () => {
    const matrix = [
      [
        cell({ line_id: "L0", period_id: "P0", amount_text: "1.00" }),
        cell({ line_id: "L0", period_id: "P1", formula: "=B2+1" }),
      ],
      [
        cell({ line_id: "L1", period_id: "P0", amount_text: "3.00" }),
        cell({ line_id: "L1", period_id: "P1", amount_text: null }),
      ],
    ];
    expect(serializeSelection(matrix)).toBe("1.00\t=B2+1\n3.00\t");
  });
});

describe("buildFillEdits (fill down / right)", () => {
  it("fills down within a 2-row selection from the source edge", () => {
    const map = makeMap({
      "L0:P0": cell({ line_id: "L0", period_id: "P0", amount_text: "100.00" }),
    });
    const rect: SelectionRect = {
      anchor: { lineId: "L0", periodId: "P0" },
      focus: { lineId: "L1", periodId: "P0" },
    };
    const edits = buildFillEdits({
      direction: "down",
      anchor: rect.anchor,
      focus: rect.focus,
      lines: LINES,
      periods: PERIODS,
      getCell: map,
    });
    expect(edits).toEqual([
      { line_id: "L1", period_id: "P0", value: "100.00", manual_override: false },
    ]);
  });

  it("fills the whole column below a single selected cell", () => {
    const map = makeMap({
      "L0:P0": cell({ line_id: "L0", period_id: "P0", amount_text: "100.00" }),
    });
    const edits = buildFillEdits({
      direction: "down",
      anchor: { lineId: "L0", periodId: "P0" },
      focus: { lineId: "L0", periodId: "P0" },
      lines: LINES,
      periods: PERIODS,
      getCell: map,
    });
    expect(edits).toEqual([
      { line_id: "L1", period_id: "P0", value: "100.00", manual_override: false },
      { line_id: "L2", period_id: "P0", value: "100.00", manual_override: false },
    ]);
  });

  it("fills right and shifts formula references relatively", () => {
    const map = makeMap({ "L0:P0": cell({ line_id: "L0", period_id: "P0", formula: "=B2+1" }) });
    const edits = buildFillEdits({
      direction: "right",
      anchor: { lineId: "L0", periodId: "P0" },
      focus: { lineId: "L0", periodId: "P0" },
      lines: LINES,
      periods: PERIODS,
      getCell: map,
    });
    expect(edits).toEqual([
      { line_id: "L0", period_id: "P1", formula: "=C2+1", manual_override: false },
      { line_id: "L0", period_id: "P2", formula: "=D2+1", manual_override: false },
    ]);
  });

  it("returns no edits for an unknown anchor", () => {
    const map = makeMap({});
    const edits = buildFillEdits({
      direction: "down",
      anchor: { lineId: "nope", periodId: "P0" },
      focus: { lineId: "nope", periodId: "P0" },
      lines: LINES,
      periods: PERIODS,
      getCell: map,
    });
    expect(edits).toEqual([]);
  });
});

describe("buildPasteEdits (paste anchoring + clipping)", () => {
  it("maps a block onto grid edits anchored at the active cell", () => {
    const edits = buildPasteEdits({
      text: "1.00\t2.00\n3.00\t4.00",
      anchor: { lineId: "L0", periodId: "P0" },
      lines: LINES,
      periods: PERIODS,
    });
    expect(edits).toEqual([
      { line_id: "L0", period_id: "P0", value: "1.00", manual_override: false },
      { line_id: "L0", period_id: "P1", value: "2.00", manual_override: false },
      { line_id: "L1", period_id: "P0", value: "3.00", manual_override: false },
      { line_id: "L1", period_id: "P1", value: "4.00", manual_override: false },
    ]);
  });

  it("clips rows/columns that fall outside the grid", () => {
    const edits = buildPasteEdits({
      text: "1\n2\n3\n4\n5",
      anchor: { lineId: "L1", periodId: "P1" },
      lines: LINES,
      periods: PERIODS,
    });
    // Only L1→L2 rows and P1 column fit (L3/P2 don't exist).
    expect(edits).toEqual([
      { line_id: "L1", period_id: "P1", value: "1", manual_override: false },
      { line_id: "L2", period_id: "P1", value: "2", manual_override: false },
    ]);
  });

  it("emits a clear edit for an empty pasted cell", () => {
    const edits = buildPasteEdits({
      text: "5.00\t",
      anchor: { lineId: "L0", periodId: "P0" },
      lines: LINES,
      periods: PERIODS,
    });
    expect(edits).toEqual([
      { line_id: "L0", period_id: "P0", value: "5.00", manual_override: false },
      { line_id: "L0", period_id: "P1", value: null, formula: null, manual_override: false },
    ]);
  });
});

describe("snapshot round-trip", () => {
  it("converts a view to a snapshot and back to an edit unchanged", () => {
    const v = cell({ line_id: "L0", period_id: "P0", formula: "=B2+1", manual_override: true });
    const snap = snapshotFromView(v);
    expect(snap).toEqual({
      line_id: "L0",
      period_id: "P0",
      value: null,
      formula: "=B2+1",
      manual_override: true,
    });
    const input = snapshotToInput(snap);
    expect(input).toEqual({
      line_id: "L0",
      period_id: "P0",
      value: null,
      formula: "=B2+1",
      manual_override: true,
    });
  });
});

describe("modelHistory guards (empty stacks, missing sources, interior blanks)", () => {
  it("popUndo/popRedo on empty branches answer null", () => {
    const h = new History();
    expect(h.popUndo()).toBeNull();
    expect(h.popRedo()).toBeNull();
  });

  it("skips interior blank lines when parsing a paste block", () => {
    const rows = parsePasteBlock("1\t2\n\n3\t4");
    expect(rows).toHaveLength(2);
    expect(rows[1][0].value).toBe("3");
  });

  it("fill down with a missing source cell produces no edits", () => {
    const edits = buildFillEdits({
      direction: "down",
      anchor: { lineId: "L0", periodId: "P0" },
      focus: { lineId: "L1", periodId: "P0" },
      lines: LINES,
      periods: PERIODS,
      getCell: makeMap({}),
    });
    expect(edits).toEqual([]);
  });

  it("fill right with a missing source cell produces no edits", () => {
    const edits = buildFillEdits({
      direction: "right",
      anchor: { lineId: "L0", periodId: "P0" },
      focus: { lineId: "L0", periodId: "P0" },
      lines: LINES,
      periods: PERIODS,
      getCell: makeMap({}),
    });
    expect(edits).toEqual([]);
  });

  it("paste with an unknown anchor resolves to zero edits", () => {
    expect(
      buildPasteEdits({
        text: "1\n2",
        anchor: { lineId: "nope", periodId: "P0" },
        lines: LINES,
        periods: PERIODS,
      }),
    ).toEqual([]);
  });
});
