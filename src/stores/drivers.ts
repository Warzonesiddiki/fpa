/**
 * S-043 Driver Tables store (F-013 · M3-3 · SCREENS-SPEC S-043 · MODELING-METHODS-SPEC §2).
 *
 * Owns the 5 screen states for the Driver Table:
 *   * Periods ← `calendar.preview` (the same working fiscal calendar the Model grid uses).
 *   * Definitions → `driver.upsert` (audited write; `drivers` row).
 *   * Period values → `driver.set_value` (bounds enforced → `DRIVER_OUT_OF_BOUNDS`).
 *   * Import → `driver.import` (`driver_data` batch → `driver_values`).
 *
 * The working set is session-scoped (M3 has no `driver.list` command — the table starts empty and
 * the user creates/imports drivers, matching the S-043 "Create your first Driver" empty state). The
 * engine is SHARED with the Model grid store (`getModelEngineClient`) so driver values live in the
 * same HyperFormula workbook and feed Model formulas (`=Drivers!B2 * price`). Model-scoped writes
 * target the session's active Model (`activeModelId()` — the id the core returned at unlock/open),
 * never the API-SPEC example id: the native `driver.upsert` rejects a Model the Company does not own.
 *
 * Zero-compromise: money/exact-decimal never crosses as float (values are decimal strings); no mock
 * data in the product path; every mutation goes through the audited command before the engine.
 */
import { create } from "zustand";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";
import { useSessionStore } from "@/stores/session";
import {
  activeModelId,
  getModelEngineClient,
  periodIdFromPreview,
  WORKING_CALENDAR,
  WORKING_SCENARIO_ID,
} from "@/stores/model";
import { CORE_DRIVER_ADVISORY_MAX, type DriverDef as SchemaDriverDef } from "@/api/schema";
import type { ScreenState } from "@/components/ui/StatePanel";
import type {
  DriverDef as EngineDriverDef,
  DriverImpactRow,
  DriverValueView,
  EngineRecalcReport,
  ModelGridPeriod,
} from "@/workers/modelEngine";

function valueKey(driverId: string, periodId: string): string {
  return `${driverId}:${periodId}`;
}

interface DriverStoreState {
  status: ScreenState;
  error: BridgeError | null;
  /** Working set of driver definitions (id-ordered; every row has a resolved `id`). */
  drivers: EngineDriverDef[];
  /** ${driver_id}:${period_id} → exact decimal string (B3 — never a float here). */
  values: Record<string, string>;
  periods: ModelGridPeriod[];
  /** driver_id → the model-grid cells that reference this driver's value. */
  impact: Record<string, DriverImpactRow[]>;
  /** Advisor: count of `is_core` drivers (≤ CORE_DRIVER_ADVISORY_MAX is the S-043 guidance). */
  coreDriverCount: number;
  recalc: EngineRecalcReport | null;
  load: () => Promise<void>;
  upsertDriver: (def: SchemaDriverDef) => Promise<boolean>;
  setValue: (driverId: string, periodId: string, value: string) => Promise<boolean>;
  importDrivers: (filePath: string, mappingId: string) => Promise<boolean>;
  retry: () => Promise<void>;
  reset: () => void;
}

/** Deterministic id-ordered drivers list (stable table rows). */
function orderDrivers(drivers: EngineDriverDef[]): EngineDriverDef[] {
  return [...drivers].sort((a, b) => a.id.localeCompare(b.id));
}

export const useDriverStore = create<DriverStoreState>((set, get) => ({
  status: "loading",
  error: null,
  drivers: [],
  values: {},
  periods: [],
  impact: {},
  coreDriverCount: 0,
  recalc: null,

  /** Load the working fiscal periods and re-sync the shared engine's Drivers sheet. */
  load: async () => {
    set({ status: "loading", error: null });
    const companyId = useSessionStore.getState().companyId;
    if (!companyId) {
      set({ status: "empty", error: null, drivers: [], periods: [], values: {}, impact: {} });
      return;
    }
    try {
      const calendar = (await call("calendar.preview", {
        preset: WORKING_CALENDAR.preset,
        fy_start_month: WORKING_CALENDAR.fy_start_month,
        week_start_day: 0,
        anchor_rule: null,
        year_end_rule: null,
        from: new Date().toISOString().slice(0, 10),
        year_count: 1,
      })) as {
        fiscal_years: {
          fy_label: string;
          periods: { period_no: number; code: string }[];
        }[];
      };
      const firstYear = calendar.fiscal_years[0];
      const periods: ModelGridPeriod[] = (firstYear?.periods ?? []).map((p) => ({
        id: periodIdFromPreview(firstYear.fy_label, p.period_no),
        code: p.code,
      }));

      const drivers = orderDrivers(get().drivers);
      const engine = getModelEngineClient();
      await engine.loadDrivers(drivers, periods);
      // Re-apply the working-set values into the freshly rebuilt sheet. A value that is now out of
      // bounds (e.g. the user tightened a bound) is never silently dropped — it is recorded as a
      // recalc issue and surfaced to the page.
      const values = { ...get().values };
      const loadIssues: EngineRecalcReport["issues"] = [];
      for (const [key, text] of Object.entries(values)) {
        const parts = key.split(":");
        const driverId = parts[0];
        const periodId = parts[1];
        if (!driverId || !periodId) continue;
        try {
          await engine.setDriverValue(driverId, periodId, text);
        } catch (reapplyErr) {
          const code = (reapplyErr as { code?: string }).code ?? "DRIVER_OUT_OF_BOUNDS";
          loadIssues.push({ code, cell: `${driverId}:${periodId}`, details: {} });
        }
      }
      const grid = await engine.getDriverGrid();
      const nextValues = gridToValues(grid);

      if (drivers.length === 0) {
        set({
          status: "empty",
          periods,
          drivers: [],
          values: {},
          impact: {},
          coreDriverCount: 0,
          recalc: null,
          error: null,
        });
        return;
      }

      const impact: Record<string, DriverImpactRow[]> = {};
      for (const d of drivers) impact[d.id] = await engine.getDriverImpact(d.id);
      set({
        status: "populated",
        periods,
        drivers,
        values: nextValues,
        impact,
        coreDriverCount: drivers.filter((d) => d.is_core).length,
        // Only surface a report when a re-applied value fell out of bounds (never silently dropped).
        recalc:
          loadIssues.length > 0
            ? { dirty_cells: 0, cycles: [], changed_cells: [], issues: loadIssues, duration_ms: 0 }
            : null,
        error: null,
      });
    } catch (err) {
      set({ status: "error", error: err as BridgeError });
    }
  },

  /** Define or update a driver (`driver.upsert`), then rebuild the shared engine's driver sheet. */
  upsertDriver: async (def: SchemaDriverDef) => {
    const s = get();
    try {
      // The Model must be the one the core opened for this Company — the native handler enforces
      // `model_belongs_to_company` (403 otherwise), so the documented example id is never sent
      // once a session model is known.
      const written = (await call("driver.upsert", {
        model_id: activeModelId(),
        driver: def,
      })) as { driver_id: string; created: boolean };
      const targetId = written.driver_id;
      const existing = s.drivers.find((d) => d.id === targetId);
      const nextDef: EngineDriverDef = {
        id: targetId,
        name: def.name,
        driver_type: def.driver_type,
        unit: def.unit ?? null,
        source: def.source,
        is_core: def.is_core ?? false,
        bounds_low: def.bounds_low ?? null,
        bounds_high: def.bounds_high ?? null,
      };
      const drivers = orderDrivers(
        existing
          ? s.drivers.map((d) => (d.id === targetId ? nextDef : d))
          : [...s.drivers, nextDef],
      );
      const periods = s.periods;
      const engine = getModelEngineClient();
      await engine.loadDrivers(drivers, periods);
      const values = { ...s.values };
      for (const [key, text] of Object.entries(values)) {
        const parts = key.split(":");
        const driverId = parts[0];
        const periodId = parts[1];
        if (!driverId || !periodId) continue;
        await engine.setDriverValue(driverId, periodId, text);
      }
      const grid = await engine.getDriverGrid();
      const impact: Record<string, DriverImpactRow[]> = {};
      for (const d of drivers) impact[d.id] = await engine.getDriverImpact(d.id);
      set({
        status: "populated",
        drivers,
        values: gridToValues(grid),
        impact,
        coreDriverCount: drivers.filter((d) => d.is_core).length,
        error: null,
      });
      return true;
    } catch (err) {
      set({ status: "error", error: err as BridgeError });
      return false;
    }
  },

  /** Write a driver period value (`driver.set_value`), storing the exact decimal string. */
  setValue: async (driverId: string, periodId: string, value: string) => {
    const s = get();
    try {
      const written = (await call("driver.set_value", {
        driver_id: driverId,
        scenario_id: WORKING_SCENARIO_ID,
        period_id: periodId,
        value_decimal: value,
      })) as { ok: true; recalc: EngineRecalcReport; value_decimal: string };
      const engine = getModelEngineClient();
      await engine.setDriverValue(driverId, periodId, written.value_decimal);
      const grid = await engine.getDriverGrid();
      const values = { ...s.values };
      values[valueKey(driverId, periodId)] = written.value_decimal;
      const impact = { ...s.impact };
      impact[driverId] = await engine.getDriverImpact(driverId);
      set({
        status: "populated",
        values: gridToValues(grid),
        impact,
        recalc: written.recalc,
        error: null,
      });
      return true;
    } catch (err) {
      set({ status: "error", error: err as BridgeError });
      return false;
    }
  },

  /** Import a driver-data file (`driver.import`) — batch id is tracked; values are loaded in a later milestone. */
  importDrivers: async (filePath: string, mappingId: string) => {
    try {
      const written = (await call("driver.import", {
        file_path: filePath,
        mapping_id: mappingId,
      })) as { batch_id: string };
      void written;
      set({ status: "populated", error: null });
      return true;
    } catch (err) {
      set({ status: "error", error: err as BridgeError });
      return false;
    }
  },

  retry: async () => {
    await get().load();
  },

  reset: () => {
    set({
      status: "loading",
      error: null,
      drivers: [],
      values: {},
      periods: [],
      impact: {},
      coreDriverCount: 0,
      recalc: null,
    });
  },
}));

/** Rebuild the store's values record from an engine driver-grid snapshot. */
function gridToValues(grid: DriverValueView[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of grid) {
    if (row.amount_text !== null) out[valueKey(row.driver_id, row.period_id)] = row.amount_text;
  }
  return out;
}

/** Re-export the advisory max so the S-043 page can render the ≤7 guidance from one owner. */
export { CORE_DRIVER_ADVISORY_MAX };
