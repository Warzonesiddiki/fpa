import { invoke } from "@tauri-apps/api/core";
import {
  CommandArgs,
  MAP_TARGET_INVALID_MESSAGE,
  type CommandInput,
  type CommandName,
} from "./schema";
import { isTauriRuntime } from "./runtime";
import { useErrorLogStore } from "@/stores/errorLog";

export interface BridgeError {
  code: string;
  userMessage: string;
  httpStatus: number;
  retryable: boolean;
  retryAfterMs: number | null;
  details: Record<string, unknown>;
}

function toBridgeError(raw: unknown): BridgeError {
  if (typeof raw === "object" && raw !== null && "code" in raw) {
    const e = raw as Record<string, unknown>;
    return {
      code: String(e.code ?? "INTERNAL"),
      userMessage: String(
        e.userMessage ??
          "Something went wrong. Diagnostics were captured — retry or export Local Diagnostics.",
      ),
      httpStatus: typeof e.httpStatus === "number" ? e.httpStatus : 500,
      retryable: Boolean(e.retryable),
      retryAfterMs: typeof e.retryAfterMs === "number" ? e.retryAfterMs : null,
      details:
        typeof e.details === "object" && e.details !== null
          ? (e.details as Record<string, unknown>)
          : {},
    };
  }
  return {
    code: "INTERNAL",
    userMessage:
      "Something went wrong. Diagnostics were captured — retry or export Local Diagnostics.",
    httpStatus: 500,
    retryable: true,
    retryAfterMs: null,
    details: { raw: String(raw) },
  };
}

/**
 * Typed command invocation (tauri-specta generated client later; hand-typed bridge now).
 * Flow: Zod validates args → invoke → Zod validates data envelope (ARCHITECTURE §1).
 */
/**
 * Every typed error the bridge throws passes through here first, feeding the
 * in-session aggregation log (ERROR-HANDLING §3 rule 7 — 5+ identical in 1 min
 * → shell banner). The throw itself is unchanged.
 */
function failWithLog(err: BridgeError): never {
  useErrorLogStore.getState().record(err);
  throw err;
}

/**
 * In-process engine commands (B14 one-owner · ADR-029): a command whose authoritative
 * owner is a webview-side engine registers here and the bridge routes to it instead of
 * IPC — e.g. `model.inspect` is owned by the HyperFormula model engine (the cell graph
 * lives there; ARCHITECTURE "Worker split"). Routing order in `call`: Zod arg gate →
 * registered engine handler → Tauri IPC → dev mock. Handlers receive the parsed args and
 * return the command's data payload; thrown errors pass through the standard
 * BridgeError conversion + in-session error log.
 */
type EngineCommandHandler = (args: never) => Promise<unknown>;
const engineHandlers = new Map<CommandName, EngineCommandHandler>();

export function registerEngineCommand<C extends CommandName>(
  command: C,
  handler: (args: CommandInput<C>) => Promise<unknown>,
): void {
  engineHandlers.set(command, handler as EngineCommandHandler);
}

/** Test/HMR hygiene: drop a registered engine handler (IPC/mock answers again). */
export function unregisterEngineCommand(command: CommandName): void {
  engineHandlers.delete(command);
}

export async function call<C extends CommandName>(
  command: C,
  args: CommandInput<C>,
): Promise<unknown> {
  const schema = CommandArgs[command];
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    const mappingInvalid = command === "import.map.save_v1";
    throw failWithLog(
      toBridgeError({
        code: mappingInvalid ? "MAP_TARGET_INVALID" : "VALUE_INVALID",
        userMessage: mappingInvalid
          ? MAP_TARGET_INVALID_MESSAGE
          : "Value is not valid for this cell ({type}).",
        httpStatus: 422,
        retryable: false,
        retryAfterMs: null,
        details: { issues: parsed.error.issues },
      }),
    );
  }

  /**
   * Dev-only mock core (B18-3/B18-7): answers ONLY in the browser dev preview.
   * Static `import.meta.env.DEV` guard lets Rollup dead-code-eliminate the dynamic
   * `import("./mock")` in production builds — the ~4,600-line mock (sample data,
   * fake handlers) is fully tree-shaken out of every shipped bundle (WS-08).
   * The real app always runs inside Tauri, where `invoke` answers.
   */
  const engineHandler = engineHandlers.get(command);
  const data = engineHandler
    ? await engineHandler(parsed.data as never).catch((err: unknown) => {
        throw failWithLog(toBridgeError(err));
      })
    : isTauriRuntime()
      ? await invoke(command, parsed.data as never)
      : await invokeMock(command, parsed.data as CommandInput<C>);

  if (typeof data === "object" && data !== null && "error" in data) {
    throw failWithLog(toBridgeError((data as { error: unknown }).error));
  }
  return (data as { data?: unknown }).data ?? data;
}

export { toBridgeError };

async function invokeMock<C extends CommandName>(
  command: C,
  args: CommandInput<C>,
): Promise<unknown> {
  if (!import.meta.env.DEV) {
    // Should never happen: the mock is dev-only (B18-3/B18-7) and the built app
    // runs inside Tauri where `invoke` answers. Refuse rather than fall back.
    throw failWithLog(
      toBridgeError({
        code: "INTERNAL",
        userMessage:
          "This build must run inside the OneFP&A desktop app. Start it with the desktop launcher, not a browser.",
        httpStatus: 500,
        retryable: false,
        retryAfterMs: null,
        details: { command, attempted: "mock-core-in-production" },
      }),
    );
  }
  const { mockInvoke } = await import("./mock");
  return mockInvoke(command, args);
}
