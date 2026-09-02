import { invoke } from "@tauri-apps/api/core";
import {
  CommandArgs,
  MAP_TARGET_INVALID_MESSAGE,
  type CommandInput,
  type CommandName,
} from "./schema";
import { mockInvoke, isTauriRuntime } from "./mock";

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
      userMessage: String(e.userMessage ?? "An unexpected error occurred."),
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
    userMessage: "An unexpected error occurred. Please try again.",
    httpStatus: 500,
    retryable: false,
    retryAfterMs: null,
    details: { raw: String(raw) },
  };
}

/**
 * Typed command invocation (tauri-specta generated client later; hand-typed bridge now).
 * Flow: Zod validates args → invoke → Zod validates data envelope (ARCHITECTURE §1).
 */
export async function call<C extends CommandName>(
  command: C,
  args: CommandInput<C>,
): Promise<unknown> {
  const schema = CommandArgs[command];
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    const mappingInvalid = command === "import.map.save_v1";
    throw toBridgeError({
      code: mappingInvalid ? "MAP_TARGET_INVALID" : "VALUE_INVALID",
      userMessage: mappingInvalid
        ? MAP_TARGET_INVALID_MESSAGE
        : `Invalid arguments for ${command}.`,
      httpStatus: 422,
      retryable: false,
      retryAfterMs: null,
      details: { issues: parsed.error.issues },
    });
  }

  /** Works in the Tauri shell; in the browser dev preview (`npm run dev`) the mock core answers (B18-3: dev-only). */
  const data = isTauriRuntime()
    ? await invoke(command, parsed.data as never)
    : await mockInvoke(command, parsed.data as CommandInput<C>);

  if (typeof data === "object" && data !== null && "error" in data) {
    throw toBridgeError((data as { error: unknown }).error);
  }
  return (data as { data?: unknown }).data ?? data;
}

export { toBridgeError };
