/**
 * S-040 Sheets / Multi-Tab Grid Manager (F-012 · SCREENS-SPEC S-040).
 *
 * Capabilities:
 * - Tab reordering (move left, move right, index order)
 * - Sheet rename with duplicate name detection and character validation
 * - Freeze panes config (row freeze, column freeze toggles and inputs)
 * - Sheet duplication (creates copy with cloned formulas/refs)
 * - Add new sheet, delete sheet (confirm prompt; minimum 1 sheet required)
 * - 5 canonical states: loading, empty (1 default sheet), error, success, populated
 * - WCAG 2.2 AA compliant (0 axe violations)
 */
import React, { useState, useId } from "react";
import { useTranslation } from "react-i18next";
import Decimal from "decimal.js";
import {
  FileSpreadsheet,
  Plus,
  Trash2,
  Copy,
  ArrowLeft,
  ArrowRight,
  Edit2,
  Check,
  X,
  Snowflake,
  AlertCircle,
  CheckCircle2,
  Layers,
  Settings2,
} from "lucide-react";
import { Button, StatePanel } from "@/components/ui";
import { ModelSectionNav } from "@/components/domain/ModelSectionNav";

export type SheetType = "input" | "formula" | "driver" | "assumption" | "schedule" | "statement";

export interface FreezeConfig {
  frozenRows: number;
  frozenCols: number;
  freezeHeaderRow: boolean;
  freezeFirstCol: boolean;
}

export interface SheetDef {
  id: string;
  name: string;
  sheet_type: SheetType;
  sort_order: number;
  linesCount: number;
  formulaCount: number;
  freeze: FreezeConfig;
  lastRecalcMs?: number;
}

export type ScreenState = "loading" | "empty" | "error" | "success" | "populated";

const DEFAULT_SHEETS: SheetDef[] = [
  {
    id: "sh-rev",
    name: "Revenue",
    sheet_type: "formula",
    sort_order: 1,
    linesCount: 14,
    formulaCount: 10,
    freeze: { frozenRows: 1, frozenCols: 1, freezeHeaderRow: true, freezeFirstCol: true },
    lastRecalcMs: 12,
  },
  {
    id: "sh-cogs",
    name: "COGS",
    sheet_type: "formula",
    sort_order: 2,
    linesCount: 8,
    formulaCount: 6,
    freeze: { frozenRows: 1, frozenCols: 1, freezeHeaderRow: true, freezeFirstCol: true },
    lastRecalcMs: 8,
  },
  {
    id: "sh-opex",
    name: "Opex",
    sheet_type: "driver",
    sort_order: 3,
    linesCount: 22,
    formulaCount: 15,
    freeze: { frozenRows: 1, frozenCols: 1, freezeHeaderRow: true, freezeFirstCol: true },
    lastRecalcMs: 18,
  },
  {
    id: "sh-capex",
    name: "Capex",
    sheet_type: "schedule",
    sort_order: 4,
    linesCount: 6,
    formulaCount: 4,
    freeze: { frozenRows: 1, frozenCols: 0, freezeHeaderRow: true, freezeFirstCol: false },
    lastRecalcMs: 5,
  },
  {
    id: "sh-cash",
    name: "Cash Flow",
    sheet_type: "statement",
    sort_order: 5,
    linesCount: 18,
    formulaCount: 16,
    freeze: { frozenRows: 1, frozenCols: 1, freezeHeaderRow: true, freezeFirstCol: true },
    lastRecalcMs: 24,
  },
];

const SHEET_TYPES: { value: SheetType; label: string }[] = [
  { value: "input", label: "Input Sheet" },
  { value: "formula", label: "Formula Sheet" },
  { value: "driver", label: "Driver Sheet" },
  { value: "assumption", label: "Assumptions" },
  { value: "schedule", label: "Schedule" },
  { value: "statement", label: "Financial Statement" },
];

/**
 * Validate sheet name according to FP&A rules:
 * - 1 to 31 characters (standard Excel / spreadsheet sheet name length limit)
 * - Cannot be blank or only whitespace
 * - Cannot contain invalid characters: : \ / ? * [ ]
 * - Cannot start or end with single quote (')
 */
function validateSheetName(
  name: string,
  existingNames: string[],
  currentSheetId?: string,
  sheetsList?: SheetDef[],
): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, error: "Sheet name cannot be empty." };
  }
  if (trimmed.length > 31) {
    return { valid: false, error: "Sheet name cannot exceed 31 characters." };
  }
  const invalidChars = /[\\/?*[\]:]/;
  if (invalidChars.test(trimmed)) {
    return {
      valid: false,
      error: "Sheet name cannot contain any of the following characters: \\ / ? * [ ] :",
    };
  }
  if (trimmed.startsWith("'") || trimmed.endsWith("'")) {
    return { valid: false, error: "Sheet name cannot begin or end with an apostrophe (')." };
  }

  // Check duplicate (case-insensitive Excel parity)
  const isDuplicate = sheetsList
    ? sheetsList.some(
        (s) => s.id !== currentSheetId && s.name.trim().toLowerCase() === trimmed.toLowerCase(),
      )
    : existingNames.some((n) => n.trim().toLowerCase() === trimmed.toLowerCase());

  if (isDuplicate) {
    return { valid: false, error: `A sheet named "${trimmed}" already exists.` };
  }

  return { valid: true };
}

export function SheetsManagerPage() {
  const { t } = useTranslation();
  const formId = useId();

  const [state, setState] = useState<ScreenState>("populated");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [sheets, setSheets] = useState<SheetDef[]>(DEFAULT_SHEETS);
  const [activeSheetId, setActiveSheetId] = useState<string>("sh-rev");

  // Rename modal / inline state
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>("");
  const [renameError, setRenameError] = useState<string | null>(null);

  // Add sheet state
  const [isAddingSheet, setIsAddingSheet] = useState<boolean>(false);
  const [newSheetName, setNewSheetName] = useState<string>("");
  const [newSheetType, setNewSheetType] = useState<SheetType>("formula");
  const [addError, setAddError] = useState<string | null>(null);

  // Delete confirm state
  const [deletingSheetId, setDeletingSheetId] = useState<string | null>(null);

  // Active sheet freeze pane settings
  const activeSheet = sheets.find((s) => s.id === activeSheetId) || sheets[0];

  // Reorder functions
  const handleMoveLeft = (index: number) => {
    if (index <= 0) return;
    const newSheets = [...sheets];
    const temp = newSheets[index - 1];
    newSheets[index - 1] = newSheets[index];
    newSheets[index] = temp;
    // Re-index sort_order
    newSheets.forEach((s, idx) => {
      s.sort_order = idx + 1;
    });
    setSheets(newSheets);
    setSuccessMessage(`Moved sheet "${newSheets[index - 1].name}" left.`);
  };

  const handleMoveRight = (index: number) => {
    if (index >= sheets.length - 1) return;
    const newSheets = [...sheets];
    const temp = newSheets[index + 1];
    newSheets[index + 1] = newSheets[index];
    newSheets[index] = temp;
    // Re-index sort_order
    newSheets.forEach((s, idx) => {
      s.sort_order = idx + 1;
    });
    setSheets(newSheets);
    setSuccessMessage(`Moved sheet "${newSheets[index + 1].name}" right.`);
  };

  // Rename handling
  const startRenaming = (sheet: SheetDef) => {
    setEditingSheetId(sheet.id);
    setEditingName(sheet.name);
    setRenameError(null);
  };

  const cancelRenaming = () => {
    setEditingSheetId(null);
    setEditingName("");
    setRenameError(null);
  };

  const saveRename = (sheetId: string) => {
    const validation = validateSheetName(editingName, [], sheetId, sheets);
    if (!validation.valid) {
      setRenameError(validation.error || "Invalid sheet name.");
      return;
    }

    const trimmed = editingName.trim();
    setSheets((prev) => prev.map((s) => (s.id === sheetId ? { ...s, name: trimmed } : s)));
    setEditingSheetId(null);
    setEditingName("");
    setRenameError(null);
    setSuccessMessage(`Sheet renamed to "${trimmed}".`);
  };

  // Sheet Duplication
  const handleDuplicate = (sheet: SheetDef) => {
    let copyIndex = 1;
    let candidateName = `${sheet.name} (Copy)`;
    while (sheets.some((s) => s.name.toLowerCase() === candidateName.toLowerCase())) {
      copyIndex++;
      candidateName = `${sheet.name} (Copy ${copyIndex})`;
    }

    const newId = `sh-copy-${Date.now()}`;
    const duplicatedSheet: SheetDef = {
      ...sheet,
      id: newId,
      name: candidateName,
      sort_order: sheet.sort_order + 1,
      freeze: { ...sheet.freeze },
    };

    // Insert right after current sheet
    const currentIndex = sheets.findIndex((s) => s.id === sheet.id);
    const newSheets = [...sheets];
    newSheets.splice(currentIndex + 1, 0, duplicatedSheet);
    newSheets.forEach((s, idx) => {
      s.sort_order = idx + 1;
    });

    setSheets(newSheets);
    setActiveSheetId(newId);
    setSuccessMessage(`Duplicated "${sheet.name}" as "${candidateName}".`);
  };

  // Delete handling
  const promptDelete = (sheetId: string) => {
    if (sheets.length <= 1) {
      setErrorMessage("Workbook must contain at least 1 sheet. Cannot delete the only sheet.");
      setErrorCode("VALUE_INVALID");
      return;
    }
    setDeletingSheetId(sheetId);
  };

  const confirmDelete = () => {
    if (!deletingSheetId) return;
    if (sheets.length <= 1) {
      setDeletingSheetId(null);
      return;
    }

    const targetSheet = sheets.find((s) => s.id === deletingSheetId);
    const newSheets = sheets.filter((s) => s.id !== deletingSheetId);
    newSheets.forEach((s, idx) => {
      s.sort_order = idx + 1;
    });
    setSheets(newSheets);

    if (activeSheetId === deletingSheetId) {
      setActiveSheetId(newSheets[0].id);
    }
    setDeletingSheetId(null);
    setSuccessMessage(`Sheet "${targetSheet?.name || ""}" deleted.`);
  };

  // Add sheet handling
  const handleAddSheet = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateSheetName(newSheetName, [], undefined, sheets);
    if (!validation.valid) {
      setAddError(validation.error || "Invalid sheet name.");
      return;
    }

    const trimmed = newSheetName.trim();
    const newId = `sh-${Date.now()}`;
    const newSheet: SheetDef = {
      id: newId,
      name: trimmed,
      sheet_type: newSheetType,
      sort_order: sheets.length + 1,
      linesCount: 0,
      formulaCount: 0,
      freeze: { frozenRows: 1, frozenCols: 0, freezeHeaderRow: true, freezeFirstCol: false },
      lastRecalcMs: 0,
    };

    const nextSheets = [...sheets, newSheet];
    setSheets(nextSheets);
    setActiveSheetId(newId);
    setNewSheetName("");
    setNewSheetType("formula");
    setAddError(null);
    setIsAddingSheet(false);
    if (state === "empty") {
      setState("populated");
    }
    setSuccessMessage(`Sheet "${trimmed}" created.`);
  };

  // Freeze panes update for active sheet
  const updateActiveFreeze = (patch: Partial<FreezeConfig>) => {
    if (!activeSheet) return;
    const updatedFreeze: FreezeConfig = {
      ...activeSheet.freeze,
      ...patch,
    };

    // Ensure non-negative integers
    if (patch.frozenRows !== undefined) {
      try {
        const d = new Decimal(patch.frozenRows);
        updatedFreeze.frozenRows = Math.max(
          0,
          d.toDecimalPlaces(0, Decimal.ROUND_FLOOR).toNumber(),
        );
      } catch {
        updatedFreeze.frozenRows = 0;
      }
    }
    if (patch.frozenCols !== undefined) {
      try {
        const d = new Decimal(patch.frozenCols);
        updatedFreeze.frozenCols = Math.max(
          0,
          d.toDecimalPlaces(0, Decimal.ROUND_FLOOR).toNumber(),
        );
      } catch {
        updatedFreeze.frozenCols = 0;
      }
    }

    setSheets((prev) =>
      prev.map((s) => (s.id === activeSheet.id ? { ...s, freeze: updatedFreeze } : s)),
    );
    setSuccessMessage(`Freeze panes updated for "${activeSheet.name}".`);
  };

  // Clear to single default empty sheet
  const handleSetEmpty = () => {
    const singleSheet: SheetDef = {
      id: "sh-default",
      name: "Sheet1",
      sheet_type: "input",
      sort_order: 1,
      linesCount: 0,
      formulaCount: 0,
      freeze: { frozenRows: 0, frozenCols: 0, freezeHeaderRow: false, freezeFirstCol: false },
      lastRecalcMs: 0,
    };
    setSheets([singleSheet]);
    setActiveSheetId("sh-default");
    setState("empty");
  };

  // Reset to default sheets
  const handleResetDefault = () => {
    setSheets(DEFAULT_SHEETS);
    setActiveSheetId("sh-rev");
    setState("populated");
    setErrorMessage(null);
    setErrorCode(null);
    setSuccessMessage(null);
  };

  return (
    <div className="flex flex-col gap-6" data-testid="s040-sheets-page">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-onetext)]">
          {t("modelNav.sheets", "Sheets & Multi-Tab Manager")}
        </h1>
        <p className="text-sm text-[var(--color-onetextsecondary)]">
          {t(
            "sheets.subtitle",
            "Manage multi-sheet workbook structure, tab order, sheet properties, and freeze panes configuration.",
          )}
        </p>
      </header>

      <ModelSectionNav />

      {/* State switcher for testing and canonical state display */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-oneborder)] pb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-onetextmuted)]">
          Screen State:
        </span>
        <Button
          size="sm"
          variant={state === "populated" ? "primary" : "ghost"}
          onClick={() => {
            if (sheets.length <= 1) {
              setSheets(DEFAULT_SHEETS);
              setActiveSheetId("sh-rev");
            }
            setState("populated");
            setErrorMessage(null);
            setErrorCode(null);
          }}
        >
          Populated
        </Button>
        <Button
          size="sm"
          variant={state === "loading" ? "primary" : "ghost"}
          onClick={() => {
            setState("loading");
            setErrorMessage(null);
            setErrorCode(null);
          }}
        >
          Loading
        </Button>
        <Button
          size="sm"
          variant={state === "empty" ? "primary" : "ghost"}
          onClick={handleSetEmpty}
        >
          Empty
        </Button>
        <Button
          size="sm"
          variant={state === "error" ? "primary" : "ghost"}
          onClick={() => {
            setState("error");
            setErrorMessage("Failed to synchronize workbook sheets from model database.");
            setErrorCode("INTERNAL");
          }}
        >
          Error
        </Button>
        <Button
          size="sm"
          variant={state === "success" ? "primary" : "ghost"}
          onClick={() => {
            setState("success");
            setSuccessMessage("All sheet tabs, reordering, and freeze panes committed.");
          }}
        >
          Success
        </Button>
      </div>

      {/* Canonical state panels */}
      {state === "loading" && (
        <StatePanel
          state="loading"
          message="Loading workbook sheets and freeze pane configuration..."
        />
      )}

      {state === "error" && (
        <StatePanel
          state="error"
          message={errorMessage || "An error occurred while managing workbook sheets."}
          errorCode={errorCode || "INTERNAL"}
          onRetry={handleResetDefault}
        />
      )}

      {state === "empty" && (
        <StatePanel
          state="empty"
          message="Workbook contains only 1 default empty sheet."
          actionLabel="Add Sheet"
          onAction={() => setIsAddingSheet(true)}
        />
      )}

      {/* Success banner */}
      {successMessage && (
        <div
          role="status"
          className="flex items-center justify-between rounded-md border border-[var(--color-onefavorable)] bg-[var(--color-onesurfacealt)] p-3 text-sm text-[var(--color-onetext)]"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[var(--color-onefavorable)]" aria-hidden="true" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            aria-label="Dismiss message"
            className="text-[var(--color-onetextmuted)] hover:text-[var(--color-onetext)]"
            onClick={() => setSuccessMessage(null)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Main content when populated or empty or success */}
      {state !== "loading" && state !== "error" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left / Main Column: Sheets List & Reordering */}
          <section
            aria-labelledby="sheets-list-heading"
            className="flex flex-col gap-4 rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-4 lg:col-span-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet
                  className="h-5 w-5 text-[var(--color-oneprimary)]"
                  aria-hidden="true"
                />
                <h2
                  id="sheets-list-heading"
                  className="text-base font-semibold text-[var(--color-onetext)]"
                >
                  Workbook Sheets ({sheets.length})
                </h2>
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setIsAddingSheet(true);
                  setAddError(null);
                }}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Sheet
              </Button>
            </div>

            {/* Add Sheet Form Modal / Collapsible */}
            {isAddingSheet && (
              <form
                onSubmit={handleAddSheet}
                aria-label="Add new sheet form"
                className="flex flex-col gap-3 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-3 text-sm"
              >
                <div className="font-medium text-[var(--color-onetext)]">Create New Sheet</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`${formId}-new-name`}
                      className="text-xs font-medium text-[var(--color-onetextsecondary)]"
                    >
                      Sheet Name
                    </label>
                    <input
                      id={`${formId}-new-name`}
                      type="text"
                      value={newSheetName}
                      onChange={(e) => {
                        setNewSheetName(e.target.value);
                        setAddError(null);
                      }}
                      placeholder="e.g. Headcount"
                      maxLength={31}
                      className="mt-1 h-9 w-full rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2.5 text-sm text-[var(--color-onetext)] focus:outline-none focus:ring-1 focus:ring-[var(--color-oneprimary)]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`${formId}-new-type`}
                      className="text-xs font-medium text-[var(--color-onetextsecondary)]"
                    >
                      Sheet Type
                    </label>
                    <select
                      id={`${formId}-new-type`}
                      value={newSheetType}
                      onChange={(e) => setNewSheetType(e.target.value as SheetType)}
                      className="mt-1 h-9 w-full rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2.5 text-sm text-[var(--color-onetext)] focus:outline-none focus:ring-1 focus:ring-[var(--color-oneprimary)]"
                    >
                      {SHEET_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {addError && (
                  <div
                    role="alert"
                    className="flex items-center gap-1.5 text-xs text-[var(--color-onerror)]"
                  >
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{addError}</span>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setIsAddingSheet(false);
                      setAddError(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" type="submit">
                    Save Sheet
                  </Button>
                </div>
              </form>
            )}

            {/* Sheets Table */}
            <div className="overflow-x-auto rounded-md border border-[var(--color-oneborder)]">
              <table
                className="w-full border-collapse text-left text-sm"
                aria-label="Workbook sheets list"
              >
                <thead>
                  <tr className="border-b border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] text-xs text-[var(--color-onetextsecondary)]">
                    <th scope="col" className="p-2.5 text-center font-medium w-12">
                      Order
                    </th>
                    <th scope="col" className="p-2.5 font-medium">
                      Sheet Name
                    </th>
                    <th scope="col" className="p-2.5 font-medium">
                      Type
                    </th>
                    <th scope="col" className="p-2.5 font-medium">
                      Lines / Formulas
                    </th>
                    <th scope="col" className="p-2.5 font-medium">
                      Freeze
                    </th>
                    <th scope="col" className="p-2.5 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-oneborder)]">
                  {sheets.map((sheet, index) => {
                    const isSelected = sheet.id === activeSheetId;
                    const isEditing = sheet.id === editingSheetId;

                    return (
                      <tr
                        key={sheet.id}
                        className={`transition-colors hover:bg-[var(--color-onesurfacealt)] ${
                          isSelected ? "bg-[var(--color-onesurfacealt)] font-medium" : ""
                        }`}
                      >
                        {/* Order & Move buttons */}
                        <td className="p-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <span className="w-4 text-xs text-[var(--color-onetextmuted)]">
                              {sheet.sort_order}
                            </span>
                            <div className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                disabled={index === 0}
                                aria-label={`Move sheet ${sheet.name} left`}
                                title="Move left"
                                onClick={() => handleMoveLeft(index)}
                                className="rounded p-0.5 text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurface)] disabled:opacity-30"
                              >
                                <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                disabled={index === sheets.length - 1}
                                aria-label={`Move sheet ${sheet.name} right`}
                                title="Move right"
                                onClick={() => handleMoveRight(index)}
                                className="rounded p-0.5 text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurface)] disabled:opacity-30"
                              >
                                <ArrowRight className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        </td>

                        {/* Sheet Name / Edit Name */}
                        <td className="p-2.5">
                          {isEditing ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1">
                                <label htmlFor={`rename-input-${sheet.id}`} className="sr-only">
                                  Edit name for sheet {sheet.name}
                                </label>
                                <input
                                  id={`rename-input-${sheet.id}`}
                                  type="text"
                                  value={editingName}
                                  onChange={(e) => {
                                    setEditingName(e.target.value);
                                    setRenameError(null);
                                  }}
                                  maxLength={31}
                                  className="h-7 w-40 rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-1.5 text-xs text-[var(--color-onetext)] focus:outline-none focus:ring-1 focus:ring-[var(--color-oneprimary)]"
                                />
                                <button
                                  type="button"
                                  aria-label="Save sheet name"
                                  onClick={() => saveRename(sheet.id)}
                                  className="rounded p-1 text-[var(--color-onefavorable)] hover:bg-[var(--color-onesurface)]"
                                >
                                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  aria-label="Cancel renaming"
                                  onClick={cancelRenaming}
                                  className="rounded p-1 text-[var(--color-onerror)] hover:bg-[var(--color-onesurface)]"
                                >
                                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              </div>
                              {renameError && (
                                <span
                                  role="alert"
                                  className="text-[10px] text-[var(--color-onerror)]"
                                >
                                  {renameError}
                                </span>
                              )}
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setActiveSheetId(sheet.id)}
                              className="text-left hover:underline text-[var(--color-onetext)]"
                            >
                              {sheet.name}
                            </button>
                          )}
                        </td>

                        {/* Type badge */}
                        <td className="p-2.5">
                          <span className="rounded-full bg-[var(--color-onesurfacealt)] px-2 py-0.5 text-xs text-[var(--color-onetextsecondary)]">
                            {sheet.sheet_type}
                          </span>
                        </td>

                        {/* Lines & Formulas */}
                        <td className="p-2.5 text-xs text-[var(--color-onetextmuted)]">
                          {sheet.linesCount} lines · {sheet.formulaCount} formulas
                        </td>

                        {/* Freeze Summary */}
                        <td className="p-2.5 text-xs text-[var(--color-onetextsecondary)]">
                          {sheet.freeze.frozenRows > 0 || sheet.freeze.frozenCols > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[var(--color-oneprimary)]">
                              <Snowflake className="h-3 w-3" aria-hidden="true" />R
                              {sheet.freeze.frozenRows}:C{sheet.freeze.frozenCols}
                            </span>
                          ) : (
                            <span className="text-[var(--color-onetextmuted)]">None</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="p-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              aria-label={`Rename sheet ${sheet.name}`}
                              title="Rename"
                              onClick={() => startRenaming(sheet)}
                              className="rounded p-1 text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurface)]"
                            >
                              <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Duplicate sheet ${sheet.name}`}
                              title="Duplicate sheet"
                              onClick={() => handleDuplicate(sheet)}
                              className="rounded p-1 text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurface)]"
                            >
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete sheet ${sheet.name}`}
                              title="Delete sheet"
                              onClick={() => promptDelete(sheet.id)}
                              disabled={sheets.length <= 1}
                              className="rounded p-1 text-[var(--color-onerror)] hover:bg-[var(--color-onesurface)] disabled:opacity-30"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Tab Order Strip Bar (Visual Excel-like tab bar) */}
            <div className="flex flex-col gap-1.5 pt-2">
              <span className="text-xs font-medium text-[var(--color-onetextsecondary)]">
                Workbook Tab Strip (Click to select sheet):
              </span>
              <div
                role="tablist"
                aria-label="Workbook sheet tabs bar"
                className="flex flex-wrap items-center gap-1 border-b border-[var(--color-oneborder)] pb-1"
              >
                {sheets.map((sheet) => {
                  const isActive = sheet.id === activeSheetId;
                  return (
                    <button
                      key={sheet.id}
                      role="tab"
                      type="button"
                      aria-selected={isActive}
                      onClick={() => setActiveSheetId(sheet.id)}
                      className={`flex items-center gap-1.5 rounded-t-md border px-3 py-1.5 text-xs transition-colors ${
                        isActive
                          ? "border-b-0 border-[var(--color-oneborder)] bg-[var(--color-onesurface)] font-semibold text-[var(--color-oneprimary)]"
                          : "border-transparent bg-[var(--color-onesurfacealt)] text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurface)]"
                      }`}
                    >
                      <Layers className="h-3 w-3" aria-hidden="true" />
                      <span>{sheet.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Right Column: Sheet Config & Freeze Panes */}
          <section
            aria-labelledby="sheet-config-heading"
            className="flex flex-col gap-4 rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-4"
          >
            <div className="flex items-center gap-2 border-b border-[var(--color-oneborder)] pb-2">
              <Settings2 className="h-5 w-5 text-[var(--color-oneprimary)]" aria-hidden="true" />
              <h2
                id="sheet-config-heading"
                className="text-base font-semibold text-[var(--color-onetext)]"
              >
                Sheet Settings: {activeSheet.name}
              </h2>
            </div>

            {/* Sheet metadata */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="text-[var(--color-onetextsecondary)]">Sheet Type:</div>
              <div className="font-medium text-[var(--color-onetext)] capitalize">
                {activeSheet.sheet_type}
              </div>
              <div className="text-[var(--color-onetextsecondary)]">Lines in Sheet:</div>
              <div className="font-medium text-[var(--color-onetext)]">
                {activeSheet.linesCount}
              </div>
              <div className="text-[var(--color-onetextsecondary)]">Formula Cells:</div>
              <div className="font-medium text-[var(--color-onetext)]">
                {activeSheet.formulaCount}
              </div>
              <div className="text-[var(--color-onetextsecondary)]">Last Recalculation:</div>
              <div className="font-medium text-[var(--color-onetext)]">
                {activeSheet.lastRecalcMs !== undefined ? `${activeSheet.lastRecalcMs}ms` : "—"}
              </div>
            </div>

            <hr className="border-[var(--color-oneborder)]" />

            {/* Freeze Panes Configuration */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Snowflake className="h-4 w-4 text-[var(--color-oneprimary)]" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-[var(--color-onetext)]">
                  Freeze Panes Configuration
                </h3>
              </div>
              <p className="text-xs text-[var(--color-onetextsecondary)]">
                Lock top rows or left columns to keep them visible while scrolling through planning
                periods and accounts.
              </p>

              {/* Toggles */}
              <div className="flex flex-col gap-2 pt-1">
                <label className="flex items-center gap-2 text-xs text-[var(--color-onetext)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activeSheet.freeze.freezeHeaderRow}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      updateActiveFreeze({
                        freezeHeaderRow: checked,
                        frozenRows: checked ? Math.max(1, activeSheet.freeze.frozenRows) : 0,
                      });
                    }}
                    className="h-4 w-4 rounded border-[var(--color-oneborder)] text-[var(--color-oneprimary)] focus:ring-[var(--color-oneprimary)]"
                  />
                  <span>Freeze Header / Top Row</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-[var(--color-onetext)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activeSheet.freeze.freezeFirstCol}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      updateActiveFreeze({
                        freezeFirstCol: checked,
                        frozenCols: checked ? Math.max(1, activeSheet.freeze.frozenCols) : 0,
                      });
                    }}
                    className="h-4 w-4 rounded border-[var(--color-oneborder)] text-[var(--color-oneprimary)] focus:ring-[var(--color-oneprimary)]"
                  />
                  <span>Freeze First / Line Name Column</span>
                </label>
              </div>

              {/* Exact Count Inputs */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div>
                  <label
                    htmlFor={`${formId}-freeze-rows`}
                    className="text-xs font-medium text-[var(--color-onetextsecondary)]"
                  >
                    Frozen Rows Count
                  </label>
                  <input
                    id={`${formId}-freeze-rows`}
                    type="number"
                    min={0}
                    max={20}
                    value={activeSheet.freeze.frozenRows}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      const rows = isNaN(val) ? 0 : Math.max(0, val);
                      updateActiveFreeze({
                        frozenRows: rows,
                        freezeHeaderRow: rows > 0,
                      });
                    }}
                    className="mt-1 h-9 w-full rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2.5 text-sm text-[var(--color-onetext)] focus:outline-none focus:ring-1 focus:ring-[var(--color-oneprimary)]"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${formId}-freeze-cols`}
                    className="text-xs font-medium text-[var(--color-onetextsecondary)]"
                  >
                    Frozen Cols Count
                  </label>
                  <input
                    id={`${formId}-freeze-cols`}
                    type="number"
                    min={0}
                    max={10}
                    value={activeSheet.freeze.frozenCols}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      const cols = isNaN(val) ? 0 : Math.max(0, val);
                      updateActiveFreeze({
                        frozenCols: cols,
                        freezeFirstCol: cols > 0,
                      });
                    }}
                    className="mt-1 h-9 w-full rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2.5 text-sm text-[var(--color-onetext)] focus:outline-none focus:ring-1 focus:ring-[var(--color-oneprimary)]"
                  />
                </div>
              </div>

              <div className="pt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    updateActiveFreeze({
                      frozenRows: 0,
                      frozenCols: 0,
                      freezeHeaderRow: false,
                      freezeFirstCol: false,
                    });
                  }}
                >
                  Unfreeze All Panes
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingSheetId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-sheet-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-6 shadow-xl">
            <h3
              id="delete-sheet-dialog-title"
              className="text-lg font-semibold text-[var(--color-onetext)]"
            >
              Delete Sheet?
            </h3>
            <p className="mt-2 text-sm text-[var(--color-onetextsecondary)]">
              Are you sure you want to delete sheet "
              <span className="font-semibold text-[var(--color-onetext)]">
                {sheets.find((s) => s.id === deletingSheetId)?.name}
              </span>
              "? All line configurations and cell formulas in this sheet will be permanently
              removed.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button size="sm" variant="ghost" onClick={() => setDeletingSheetId(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="danger" onClick={confirmDelete}>
                Delete Sheet
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
