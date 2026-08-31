import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, StatePanel, MoneyCell } from "@/components/ui";
import type { ScreenState } from "@/components/ui/StatePanel";
import { ModelSectionNav } from "@/components/domain/ModelSectionNav";
import { useModelGridStore } from "@/stores/model";
import { useSessionStore } from "@/stores/session";
import type { GridCellView, SetCellInput } from "@/workers/modelEngine";
import { AllCommunityModule, ModuleRegistry, type ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import {
  Undo2,
  Redo2,
  PaintBucket,
  Search,
  Sigma,
  TableProperties,
  Snowflake,
  Sheet,
  FunctionSquare,
} from "lucide-react";

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
  const load = useModelGridStore((s) => s.load);
  const setCell = useModelGridStore((s) => s.setCell);
  const recalcAll = useModelGridStore((s) => s.recalcAll);
  const retry = useModelGridStore((s) => s.retry);

  // Active (selected) cell drives the formula bar.
  const [active, setActive] = useState<{ lineId: string; periodId: string } | null>(null);
  // `formulaEdited` is the user's in-progress edit; when falsy the bar shows the active cell's
  // current content (derived during render, no sync effect needed).
  const [formulaEdited, setFormulaEdited] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [frozen, setFrozen] = useState(true);
  const [showFormulas, setShowFormulas] = useState(false);

  useEffect(() => {
    if (companyId) void load();
  }, [companyId, load]);

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

  function selectCell(lineId: string, periodId: string) {
    setActive({ lineId, periodId });
    setFormulaEdited(null);
  }

  async function applyFormulaBar() {
    if (!active) return;
    const text = formulaBar.trim();
    if (!text) return;
    const input: SetCellInput = text.startsWith("=")
      ? { line_id: active.lineId, period_id: active.periodId, formula: text }
      : { line_id: active.lineId, period_id: active.periodId, value: text };
    const ok = await setCell(input);
    if (ok) setFormulaEdited(null);
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
          disabled
          title={t("gridPage.m39Hint")}
          aria-label={t("gridPage.undo")}
        >
          <Undo2 aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled
          title={t("gridPage.m39Hint")}
          aria-label={t("gridPage.redo")}
        >
          <Redo2 aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled
          title={t("gridPage.m39Hint")}
          aria-label={t("gridPage.fill")}
        >
          <PaintBucket aria-hidden="true" className="h-4 w-4" />
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
            value={formulaBar}
            onChange={(e) => setFormulaEdited(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void applyFormulaBar();
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
          title={t("gridPage.m39Hint")}
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
        >
          <AgGridReact<GridRow>
            rowData={filteredRows}
            columnDefs={columnDefs}
            domLayout="autoHeight"
            suppressCellFocus={false}
            onCellClicked={(e) => {
              if (e.colDef.colId === "line") return;
              const lineId = e.data?.line_id;
              const periodId = e.colDef.colId?.replace(/^p-/, "");
              if (lineId && periodId) selectCell(lineId, periodId);
            }}
            onFirstDataRendered={(params) => {
              if (rowData.length > 0 && periods.length > 0 && !active) {
                selectCell(rowData[0].line_id, periods[0].id);
              }
              void params;
            }}
          />
        </div>
      )}
    </div>
  );
}
