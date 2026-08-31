/**
 * M3-1 Web Worker entry — owns the single HyperFormula graph (FORMULA-ENGINE-SPEC §5).
 * The Worker is single-threaded, so ops are naturally single-flight; the client additionally
 * queues so callers never interleave setCell/recalc.
 */
import { ModelEngine } from "./modelEngine";
import { handleEngineMessage, type EngineRequest } from "./protocol";

const engine = new ModelEngine();

self.onmessage = (event: MessageEvent<EngineRequest>) => {
  const response = handleEngineMessage(engine, event.data);
  self.postMessage(response);
};

export {};
