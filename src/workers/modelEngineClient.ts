/**
 * Promise client for the M3-1 model engine Worker (FORMULA-ENGINE-SPEC §5).
 *
 * The production transport spawns the real Web Worker; the in-process transport runs the exact
 * same dispatch (`handleEngineMessage`) against a real ModelEngine for tests/ssr where `Worker`
 * is unavailable. All ops are serialized through a single-flight queue so setCell/recalc never
 * interleave (spec §5: "single-flight (queue, no concurrent)").
 */
import { ModelEngine } from "./modelEngine";
import type {
  EngineRecalcReport,
  GridCellView,
  GridLayout,
  SetCellInput,
  SetCellResult,
} from "./modelEngine";
import { handleEngineMessage, type EngineRequest, type EngineResponse } from "./protocol";

export interface ModelEngineClient {
  loadGrid(layout: GridLayout): Promise<void>;
  setCell(input: SetCellInput): Promise<SetCellResult>;
  recalc(): Promise<EngineRecalcReport>;
  getGrid(): Promise<GridCellView[]>;
  getDerived(lineId: string): Promise<{ ytd: string | null; fy: string | null }>;
  destroy(): void;
}

export interface EngineTransport {
  request(req: EngineRequest): Promise<EngineResponse>;
  destroy(): void;
}

let seq = 0;

/** Serializes every op through a promise chain — single-flight by construction (FORMULA-ENGINE-SPEC §5). */
class SingleFlight implements ModelEngineClient {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly transport: EngineTransport) {}

  private enqueue<T>(op: EngineRequest["op"], args: unknown): Promise<T> {
    const id = ++seq;
    const run = this.tail.then(() => this.transport.request({ id, op, args }));
    // Keep the chain alive even when a request rejects.
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run.then((res) => {
      if (res.ok) return res.data as T;
      throw new Error(`${res.error.code}: ${res.error.message}`);
    });
  }

  loadGrid(layout: GridLayout): Promise<void> {
    return this.enqueue("loadGrid", layout);
  }
  setCell(input: SetCellInput): Promise<SetCellResult> {
    return this.enqueue("setCell", input);
  }
  recalc(): Promise<EngineRecalcReport> {
    return this.enqueue("recalc", undefined);
  }
  getGrid(): Promise<GridCellView[]> {
    return this.enqueue("getGrid", undefined);
  }
  getDerived(lineId: string): Promise<{ ytd: string | null; fy: string | null }> {
    return this.enqueue("getDerived", { lineId });
  }
  destroy(): void {
    this.transport.destroy();
  }
}

/** Real Web Worker transport (browser/Tauri webview). */
class WorkerTransport implements EngineTransport {
  private readonly worker: Worker;
  private readonly pending = new Map<number, (res: EngineResponse) => void>();
  private readonly errorHandlers = new Set<(err: Error) => void>();

  constructor() {
    this.worker = new Worker(new URL("./modelEngine.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<EngineResponse>) => {
      const resolve = this.pending.get(event.data.id);
      if (resolve) {
        this.pending.delete(event.data.id);
        resolve(event.data);
      }
    };
    this.worker.onerror = (event) => {
      const err = new Error(`worker error: ${event.message}`);
      for (const handler of this.errorHandlers) handler(err);
    };
  }

  request(req: EngineRequest): Promise<EngineResponse> {
    return new Promise<EngineResponse>((resolve, reject) => {
      this.pending.set(req.id, resolve);
      const onError = (err: Error) => {
        this.pending.delete(req.id);
        this.errorHandlers.delete(onError);
        reject(err);
      };
      this.errorHandlers.add(onError);
      this.worker.postMessage(req);
    });
  }

  destroy(): void {
    this.worker.terminate();
  }
}

/** In-process transport — the same `handleEngineMessage` dispatch, no real Worker (tests/ssr). */
export class InProcessTransport implements EngineTransport {
  private readonly engine: ModelEngine;
  constructor(engine?: ModelEngine) {
    this.engine = engine ?? new ModelEngine();
  }
  request(req: EngineRequest): Promise<EngineResponse> {
    return Promise.resolve(handleEngineMessage(this.engine, req));
  }
  destroy(): void {
    // nothing to tear down
  }
}

/**
 * Create the client. Defaults to the real Web Worker; falls back to the in-process transport
 * (same `handleEngineMessage` dispatch, real engine) only where `Worker` is unavailable
 * (jsdom/SSR). Explicit transports are honoured as-is (tests inject InProcessTransport).
 */
export function createModelEngineClient(transport?: EngineTransport): ModelEngineClient {
  const resolved =
    transport ?? (typeof Worker === "undefined" ? new InProcessTransport() : new WorkerTransport());
  return new SingleFlight(resolved);
}
