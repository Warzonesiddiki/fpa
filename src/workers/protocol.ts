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

export type EngineOp = "loadGrid" | "setCell" | "recalc" | "getGrid" | "getDerived";

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
      case "getGrid":
        return { id: req.id, ok: true, data: engine.getGrid() };
      case "getDerived": {
        const { lineId } = req.args as { lineId: string };
        return { id: req.id, ok: true, data: engine.getDerived(lineId) };
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
