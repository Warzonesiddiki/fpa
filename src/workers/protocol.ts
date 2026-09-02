/**
 * Worker ↔ client protocol for the M3-1 model engine (FORMULA-ENGINE-SPEC §5).
 *
 * The real HyperFormula graph lives in a single Web Worker; this module is the pure,
 * dependency-light message layer so the exact same dispatch is unit-testable in-process
 * (jsdom) and inside the dedicated Worker (`modelEngine.worker.ts`).
 *
 * Envelope: `{ id, op, args }` → `{ id, ok:true, data }` | `{ id, ok:false, error:{code,message} }`.
 * Ops run single-flight (the client queues setCell/recalc; the worker is single-threaded).
 */
import type { ModelEngine } from "./modelEngine";

export type EngineOp =
  | "loadGrid"
  | "setCell"
  | "clearCell"
  | "recalc"
  | "getGrid"
  | "getDerived"
  | "inspectCell"
  | "loadDrivers"
  | "setDriverValue"
  | "getDriverGrid"
  | "getDrivers"
  | "getDriverImpact";

export interface EngineRequest {
  id: number;
  op: EngineOp;
  args?: unknown;
}

export type EngineResponse =
  | { id: number; ok: true; data: unknown }
  | { id: number; ok: false; error: { code: string; message: string } };

/** Split an engine `Error("CODE: message")` into the locked code + human detail (B20 — no new codes). */
export function parseEngineError(err: unknown): { code: string; message: string } {
  const text = err instanceof Error ? err.message : String(err);
  const colon = text.indexOf(":");
  const code = (colon === -1 ? text : text.slice(0, colon)).trim() || "INTERNAL";
  const message = colon === -1 ? "" : text.slice(colon + 1).trim();
  return { code, message };
}

/** Pure dispatch used by both the Worker entry and in-process tests. Never throws. */
export function handleEngineMessage(engine: ModelEngine, req: EngineRequest): EngineResponse {
  try {
    switch (req.op) {
      case "loadGrid":
        engine.loadGrid(req.args as Parameters<ModelEngine["loadGrid"]>[0]);
        return { id: req.id, ok: true, data: null };
      case "setCell":
        return {
          id: req.id,
          ok: true,
          data: engine.setCell(req.args as Parameters<ModelEngine["setCell"]>[0]),
        };
      case "recalc":
        return { id: req.id, ok: true, data: engine.recalc() };
      case "clearCell": {
        const { lineId, periodId } = req.args as { lineId: string; periodId: string };
        return { id: req.id, ok: true, data: engine.clearCell(lineId, periodId) };
      }
      case "getGrid":
        return { id: req.id, ok: true, data: engine.getGrid() };
      case "getDerived": {
        const { lineId } = req.args as { lineId: string };
        return { id: req.id, ok: true, data: engine.getDerived(lineId) };
      }
      case "inspectCell": {
        const { line_id, period_id } = req.args as { line_id: string; period_id: string };
        return { id: req.id, ok: true, data: engine.inspectCell(line_id, period_id) };
      }
      case "loadDrivers": {
        const { drivers, periods } = req.args as {
          drivers: Parameters<ModelEngine["loadDrivers"]>[0];
          periods: Parameters<ModelEngine["loadDrivers"]>[1];
        };
        engine.loadDrivers(drivers, periods);
        return { id: req.id, ok: true, data: null };
      }
      case "setDriverValue": {
        const { driver_id, period_id, value_decimal } = req.args as {
          driver_id: string;
          period_id: string;
          value_decimal: string;
        };
        return {
          id: req.id,
          ok: true,
          data: engine.setDriverValue(driver_id, period_id, value_decimal),
        };
      }
      case "getDriverGrid":
        return { id: req.id, ok: true, data: engine.getDriverGrid() };
      case "getDrivers":
        return { id: req.id, ok: true, data: engine.getDrivers() };
      case "getDriverImpact": {
        const { driver_id } = req.args as { driver_id: string };
        return { id: req.id, ok: true, data: engine.getDriverImpact(driver_id) };
      }
      default:
        return {
          id: req.id,
          ok: false,
          error: { code: "INTERNAL", message: `unknown worker op '${(req as { op: string }).op}'` },
        };
    }
  } catch (err) {
    return { id: req.id, ok: false, error: parseEngineError(err) };
  }
}
