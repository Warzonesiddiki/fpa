import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowRight,
  ClipboardPaste,
  Copy,
  FunctionSquare,
  Search,
  Sigma,
  Snowflake,
  Sheet,
  Undo2,
  Redo2,
  TableProperties,
} from "lucide-react";
import { Button, StatePanel, MoneyCell } from "@/components/ui";
import type { ScreenState } from "@/components/ui/StatePanel";
import { ModelSectionNav } from "@/components/domain/ModelSectionNav";
import { useModelGridStore } from "@/stores/model";
import { useSessionStore } from "@/stores/session";
import { useSettingsStore } from "@/stores/settings";
import { tokens } from "@/theme/tokens";
import type { GridCellView } from "@/workers/modelEngine";
import {
  AllCommunityModule,
  ModuleRegistry,
  type CellClickedEvent,
  type CellDoubleClickedEvent,
  type CellFocusedEvent,
  type ColDef,
  type CellStyle,
  type GridApi,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";

ModuleRegistry.registerModules([AllCommunityModule]);

interface GridRow {
  line_id: string;
  label: string;
  method: string;
  values: Record<string, GridCellView>;
  ytd: string | null;
  fy: string | null;
}

/** S-041 Sheet Grid — flagship editing surface (F-012 · SCREENS-SPEC S-041). */
export function ModelGridPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const companyId = useSessionStore((s) => s.companyId);
  const density = useSettingsStore((s) => s.preferences.density);
  const status = useModelGridStore((s) => s.status);
  const error = useModelGridStore((s) => s.error);
  const lines = useModelGridStore((s) => s.lines);
  const periods = useModelGridStore((s) => s.periods);
  const cells = useModelGridStore((s) => s.cells);
  const derived = useModelGridStore((s) => s.derived);
  const recalc = useModelGridStore((s) => s.recalc);
  const auditId = useModelGridStore((s) => s.auditId);
  const currency = useModelGridStore((s) => s.currency);
  const scale = useModelGridStore((s) => s.scale);
  const active = useModelGridStore((s) => s.active);
  const selection = useModelGridStore((s) => s.selection);
  const canUndo = useModelGridStore((s) => s.canUndo);
  const canRedo = useModelGridStore((s) => s.canRedo);
  const load = useModelGridStore((s) => s.load);
  const setCell = useModelGridStore((s) => s.setCell);
  const recalcAll = useModelGridStore((s) => s.recalcAll);
  const retry = useModelGridStore((s) => s.retry);
  const undo = useModelGridStore((s) => s.undo);
  const redo = useModelGridStore((s) => s.redo);
  const fillSelection = useModelGridStore((s) => s.fillSelection);
  const pasteBlock = useModelGridStore((s) => s.pasteBlock);
  const copySelection = useModelGridStore((s) => s.copySelection);
  const setActiveCell = useModelGridStore((s) => s.setActiveCell);
  const extendSelection = useModelGridStore((s) => s.extendSelection);
  const selectTo = useModelGridStore((s) => s.selectTo);

  // Active (selected) cell drives the formula bar.
  const [formulaEdited, setFormulaEdited] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [frozen, setFrozen] = useState(true);
  const [showFormulas, setShowFormulas] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const formulaBarRef = useRef<HTMLInputElement | null>(null);
  const gridApiRef = useRef<GridApi | null>(null);
  // Live, mutable mirror of the selected cell keys so AG Grid's cellStyle re-evaluates on refresh.
  const selectedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (companyId) void load();
  }, [companyId, load]);

  // Reflect the current selection onto the grid (overlay) and force a cell-style refresh.
  useEffect(() => {
    const keys = new Set<string>();
    if (selection && lines.length > 0 && periods.length > 0) {
      const lineIds = lines.map((l) => l.id);
      const periodIds = periods.map((p) => p.id);
      const ai = lineIds.indexOf(selection.anchor.lineId);
      const aj = periodIds.indexOf(selection.anchor.periodId);
      const fi = lineIds.indexOf(selection.focus.lineId);
      const fj = periodIds.indexOf(selection.focus.periodId);
      if (ai >= 0 && aj >= 0 && fi >= 0 && fj >= 0) {
        const minI = Math.min(ai, fi);
        const maxI = Math.max(ai, fi);
        const minJ = Math.min(aj, fj);
        const maxJ = Math.max(aj, fj);
        for (let i = minI; i <= maxI; i += 1) {
          for (let j = minJ; j <= maxJ; j += 1) {
            keys.add(`${lineIds[i]}:${periodIds[j]}`);
          }
        }
      }
    }
    selectedKeysRef.current = keys;
    gridApiRef.current?.refreshCells({ force: true });
  }, [selection, lines, periods]);

  const activeCell: GridCellView | null =
    active && cells[`${active.lineId}:${active.periodId}`]
      ? cells[`${active.lineId}:${active.periodId}`]
      : null;
  // Resetting the edit on every selection change keeps the bar glued to the active cell.
  const formulaBar =
    formulaEdited ??
    activeCell?.formula ??
    activeCell?.amount_text ??
    activeCell?.computed_text ??
    "";

  const rowData: GridRow[] = useMemo(
    () =>
      lines.map((line) => {
        const values: Record<string, GridCellView> = {};
        for (const p of periods) {
          values[p.id] = cells[`${line.id}:${p.id}`] ?? {
            line_id: line.id,
            period_id: p.id,
            amount_text: null,
            formula: null,
            computed_text: null,
            error_code: null,
            manual_override: false,
          };
        }
        return {
          line_id: line.id,
          label: line.label,
          method: line.method,
          values,
          ytd: derived[line.id]?.ytd ?? null,
          fy: derived[line.id]?.fy ?? null,
        };
      }),
    [lines, periods, cells, derived],
  );

  const filteredRows = useMemo(() => {
    const q = find.trim().toLowerCase();
    if (!q) return rowData;
    return rowData.filter((r) => r.label.toLowerCase().includes(q));
  }, [rowData, find]);

  const columnDefs: ColDef<GridRow>[] = useMemo(() => {
    const lineCol: ColDef<GridRow> = {
      colId: "line",
      headerName: t("gridPage.column.line"),
      pinned: frozen ? "left" : undefined,
      minWidth: 220,
      sortable: false,
      cellRenderer: (params: { data: GridRow }) => {
        const r = params.data;
        const hasFormula = Object.values(r.values).some((c) => c.formula != null);
        return (
          <span className="flex items-center gap-2">
            <span className="truncate">{r.label}</span>
            <span className="rounded-full bg-[var(--color-onesurfacealt)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-onetextsecondary)]">
              {t(`gridPage.methods.${r.method}`)}
            </span>
            {hasFormula && (
              <FunctionSquare
                aria-label={t("gridPage.hasFormula")}
                className="h-3.5 w-3.5 text-[var(--color-oneprimary)]"
              />
            )}
          </span>
        );
      },
    };
    const periodCols: ColDef<GridRow>[] = periods.map((p) => ({
      colId: `p-${p.id}`,
      headerName: p.code,
      width: 120,
      sortable: false,
      valueGetter: (params) => params.data?.values[p.id]?.computed_text ?? null,
      cellStyle: (params): CellStyle | null => {
        const keys = selectedKeysRef.current;
        const lineId = params.data?.line_id;
        const periodId =
          typeof params.colDef.colId === "string"
            ? String(params.colDef.colId).replace(/^p-/, "")
            : null;
        if (keys.size > 0 && lineId && periodId && keys.has(`${lineId}:${periodId}`)) {
          return {
            backgroundColor: "rgba(99,102,241,0.18)",
            boxShadow: "inset 0 0 0 2px var(--color-oneprimary)",
          };
        }
        return null;
      },
      cellRenderer: (params: { data: GridRow }) => {
        const c = params.data.values[p.id];
        const value = showFormulas ? c.formula : c.computed_text;
        if (c.error_code) {
          return (
            <span role="alert" className="font-mono text-[var(--color-onerror)]">
              {c.computed_text ?? c.error_code}
            </span>
          );
        }
        return <MoneyCell decimal={value} currency={currency} scale={scale} />;
      },
    }));
    const derivedCols: ColDef<GridRow>[] = [
      {
        colId: "ytd",
        headerName: "YTD",
        width: 120,
        pinned: frozen ? "right" : undefined,
        sortable: false,
        valueGetter: (params) => params.data?.ytd ?? null,
        cellRenderer: (params: { data: GridRow }) => (
          <span className="font-semibold">
            <MoneyCell decimal={params.data.ytd} currency={currency} scale={scale} />
          </span>
        ),
      },
      {
        colId: "fy",
        headerName: "FY",
        width: 120,
        pinned: frozen ? "right" : undefined,
        sortable: false,
        valueGetter: (params) => params.data?.fy ?? null,
        cellRenderer: (params: { data: GridRow }) => (
          <span className="font-semibold">
            <MoneyCell decimal={params.data.fy} currency={currency} scale={scale} />
          </span>
        ),
      },
    ];
    return [lineCol, ...periodCols, ...derivedCols];
  }, [periods, frozen, showFormulas, currency, scale, t]);

  function onCellClicked(e: CellClickedEvent) {
    const lineId = e.data?.line_id;
    const periodId = e.colDef.colId ? String(e.colDef.colId).replace(/^p-/, "") : null;
    if (!lineId || !periodId) return; // label column — not selectable
    if (e.event && (e.event as MouseEvent).shiftKey) extendSelection(lineId, periodId);
    else setActiveCell(lineId, periodId);
    setFormulaEdited(null);
  }

  function onCellFocused(e: CellFocusedEvent) {
    if (e.rowIndex == null) return;
    const row = e.api.getDisplayedRowAtIndex(e.rowIndex);
    const lineId = row?.data?.line_id;
    const col = e.column as unknown as { colId?: string } | null | undefined;
    const periodId = col?.colId ? String(col.colId).replace(/^p-/, "") : null;
    if (lineId && periodId) setActiveCell(lineId, periodId);
  }

  function onCellDoubleClicked(e: CellDoubleClickedEvent) {
    const lineId = e.data?.line_id;
    const periodId = e.colDef.colId ? String(e.colDef.colId).replace(/^p-/, "") : null;
    if (!lineId || !periodId) return;
    setActiveCell(lineId, periodId);
    setFormulaEdited(null);
    formulaBarRef.current?.focus();
    formulaBarRef.current?.select();
  }

  // Capture-phase handler so we can pre-empt AG Grid for the Excel-parity keys we own.
  function onGridKeyDownCapture(e: ReactKeyboardEvent) {
    const target = e.target as HTMLElement;
    const typing =
      target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
    const meta = e.ctrlKey || e.metaKey;

    if (!typing && meta && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      e.stopPropagation();
      void (e.shiftKey ? redo() : undo());
      return;
    }
    if (!typing && meta && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      e.stopPropagation();
      void redo();
      return;
    }
    if (!typing && e.key === "F2") {
      e.preventDefault();
      e.stopPropagation();
      setFormulaEdited(null);
      formulaBarRef.current?.focus();
      formulaBarRef.current?.select();
      return;
    }
    if (
      !typing &&
      e.shiftKey &&
      (e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight")
    ) {
      e.preventDefault();
      e.stopPropagation();
      const deltas: Record<string, [number, number]> = {
        ArrowDown: [1, 0],
        ArrowUp: [-1, 0],
        ArrowRight: [0, 1],
        ArrowLeft: [0, -1],
      };
      const [dL, dP] = deltas[e.key];
      selectTo(dL, dP);
    }
  }

  async function applyFormulaBar() {
    if (!active) return;
    const text = formulaBar.trim();
    if (!text) return;
    const input = text.startsWith("=")
      ? { line_id: active.lineId, period_id: active.periodId, formula: text }
      : { line_id: active.lineId, period_id: active.periodId, value: text };
    const ok = await setCell(input);
    if (ok) setFormulaEdited(null);
  }

  async function handleCopy() {
    const tsv = copySelection();
    if (!tsv) return;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(tsv);
      } catch {
        // Clipboard may be unavailable (insecure context); the TSV is still returned by copySelection.
      }
    }
  }

  async function handlePasteApply() {
    const ok = await pasteBlock(pasteText);
    if (ok) {
      setPasteOpen(false);
      setPasteText("");
    }
    // On failure the store surfaces VALUE_INVALID via the error state; keep the dialog open.
  }

  const gridState: ScreenState = status;
  const noCompany = !companyId;
  const showsGrid = gridState === "success" || gridState === "populated";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("gridPage.title")}</h1>
      <ModelSectionNav />

      {/* Toolbar (undo/redo, fill, find, formula bar, formatting, freeze, sheet tabs — S-041). */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-oneborder)] p-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("gridPage.undo")}
          title={t("gridPage.undoHint")}
          onClick={() => void undo()}
          disabled={!canUndo}
        >
          <Undo2 aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("gridPage.redo")}
          title={t("gridPage.redoHint")}
          onClick={() => void redo()}
          disabled={!canRedo}
        >
          <Redo2 aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("gridPage.fillDown")}
          title={t("gridPage.fillDownHint")}
          onClick={() => void fillSelection("down")}
          disabled={!selection}
        >
          <ArrowDown aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("gridPage.fillRight")}
          title={t("gridPage.fillRightHint")}
          onClick={() => void fillSelection("right")}
          disabled={!selection}
        >
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Button>
        <span className="flex items-center gap-1 rounded-md border border-[var(--color-oneborder)] px-2">
          <Search aria-hidden="true" className="h-4 w-4 text-[var(--color-onetextmuted)]" />
          <input
            type="search"
            aria-label={t("gridPage.find")}
            value={find}
            onChange={(e) => setFind(e.target.value)}
            className="h-8 w-32 bg-transparent text-sm outline-none"
          />
        </span>
        <span className="flex-1" />
        <span className="flex items-center gap-1">
          <span className="text-xs font-medium text-[var(--color-onetextsecondary)]">
            {active ? (periods.find((p) => p.id === active.periodId)?.code ?? "") : "—"}
          </span>
          <input
            aria-label={t("gridPage.formulaBar")}
            ref={formulaBarRef}
            value={formulaBar}
            onChange={(e) => setFormulaEdited(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void applyFormulaBar();
              if (e.key === "Escape") setFormulaEdited(null);
            }}
            placeholder={t("gridPage.formulaPlaceholder")}
            className="h-8 w-64 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 font-mono text-sm"
          />
          <Button
            size="sm"
            onClick={() => void applyFormulaBar()}
            disabled={!active || !formulaBar.trim()}
          >
            {t("gridPage.apply")}
          </Button>
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void recalcAll()}
          aria-label={t("gridPage.recalc")}
        >
          <Sigma aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled
          title={t("gridPage.formatHint")}
          aria-label={t("gridPage.format")}
        >
          <TableProperties aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={frozen}
          onClick={() => setFrozen((f) => !f)}
          aria-label={t("gridPage.freeze")}
        >
          <Snowflake aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={showFormulas}
          onClick={() => setShowFormulas((s) => !s)}
          aria-label={t("gridPage.inspectFormulas")}
        >
          <FunctionSquare aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("gridPage.copy")}
          title={t("gridPage.copyHint")}
          onClick={() => void handleCopy()}
          disabled={!selection}
        >
          <Copy aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("gridPage.paste")}
          title={t("gridPage.pasteHint")}
          onClick={() => setPasteOpen(true)}
          disabled={!active}
        >
          <ClipboardPaste aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>

      {/* Sheet tabs — single "Model" sheet (multi-sheet is a later milestone). */}
      <div
        role="tablist"
        aria-label={t("gridPage.sheetTabs")}
        className="flex gap-1 border-b border-[var(--color-oneborder)] pb-1"
      >
        <span
          role="tab"
          aria-selected="true"
          className="flex items-center gap-1 rounded-t-md border border-b-0 border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] px-3 py-1.5 text-sm"
        >
          <Sheet aria-hidden="true" className="h-3.5 w-3.5" />
          {t("gridPage.sheetModel")}
        </span>
      </div>

      {recalc && (
        <p role="status" className="text-xs text-[var(--color-onetextsecondary)]">
          {t("gridPage.recalcStatus", {
            dirty: recalc.dirty_cells,
            changed: recalc.changed_cells.length,
            ms: recalc.duration_ms,
          })}
          {auditId !== null && t("gridPage.audited", { id: auditId })}
        </p>
      )}

      {noCompany && <StatePanel state="empty" message={t("gridPage.noCompany")} />}

      {!noCompany && gridState === "loading" && (
        <StatePanel state="loading" message={t("common.loading")} />
      )}

      {!noCompany && gridState === "empty" && (
        <StatePanel
          state="empty"
          message={t("gridPage.empty")}
          actionLabel={t("gridPage.emptyAction")}
          onAction={() => navigate("/app/model/packs")}
        />
      )}

      {!noCompany && gridState === "error" && (
        <StatePanel
          state="error"
          message={error?.userMessage ?? t("gridPage.error")}
          errorCode={error?.code}
          onRetry={() => void retry()}
        />
      )}

      {!noCompany && showsGrid && (
        <div
          role="region"
          aria-label={t("gridPage.gridRegion")}
          className="ag-theme-quartz overflow-hidden rounded-lg border border-[var(--color-oneborder)]"
          data-testid="model-grid"
          data-density={density}
          onKeyDownCapture={onGridKeyDownCapture}
        >
          <AgGridReact<GridRow>
            rowData={filteredRows}
            columnDefs={columnDefs}
            domLayout="autoHeight"
            rowHeight={tokens.density[density]}
            headerHeight={tokens.density[density]}
            suppressCellFocus={false}
            onGridReady={(params) => {
              gridApiRef.current = params.api;
            }}
            onCellClicked={onCellClicked}
            onCellFocused={onCellFocused}
            onCellDoubleClicked={onCellDoubleClicked}
            onFirstDataRendered={(params) => {
              if (rowData.length > 0 && periods.length > 0 && !active) {
                setActiveCell(rowData[0].line_id, periods[0].id);
              }
              void params;
            }}
          />
        </div>
      )}

      {pasteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("gridPage.pasteDialog")}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        >
          <div className="w-[min(92vw,560px)] rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-4 shadow-xl">
            <h2 className="mb-2 text-sm font-semibold">{t("gridPage.pasteDialog")}</h2>
            <p className="mb-2 text-xs text-[var(--color-onetextsecondary)]">
              {t("gridPage.pasteHelp")}
            </p>
            <textarea
              aria-label={t("gridPage.pastePlaceholder")}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setPasteOpen(false);
                  setPasteText("");
                }
              }}
              rows={6}
              className="mb-3 w-full rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-2 font-mono text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPasteOpen(false);
                  setPasteText("");
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={() => void handlePasteApply()}
                disabled={!pasteText.trim()}
              >
                {t("gridPage.pasteApply")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
