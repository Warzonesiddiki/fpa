/**
 * DEV-ONLY mock core for the browser preview (`npm run dev` without the Tauri shell).
 *
 * B18-3: this data NEVER reaches a production path — `isTauriRuntime()` gates it out,
 * and the built app runs inside Tauri where the Rust core answers. The mock exists so
 * UI developers can see the 5 screen states without building the native shell.
 * The Rust core is the single owner of money/calendar logic (B14) — the mock mirrors
 * shapes, NOT semantics; it is not a spec of behaviour.
 */
import type { CommandInput, CommandName } from "./schema";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface MockSession {
  unlocked: boolean;
  company_id: string | null;
}

const session: MockSession = { unlocked: false, company_id: null };

const COMPANY_UUID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

const ORACLE_SAMPLE = {
  fiscal_years: [
    {
      fy_label: "FY2026",
      start_date: "2025-04-01",
      end_date: "2026-03-31",
      week_count: 52,
      periods: Array.from({ length: 12 }, (_, i) => ({
        period_no: i + 1,
        code: `P${String(i + 1).padStart(2, "0")}`,
        start_date: `2025-${String(4 + i).padStart(2, "0")}-01`,
        end_date: `2026-${String(3 + i).padStart(2, "0")}-${i === 3 ? "31" : "30"}`,
        is_53rd_week: false,
      })),
    },
  ],
};

function uuid(): string {
  return COMPANY_UUID;
}

export async function mockInvoke<C extends CommandName>(
  command: C,
  args: CommandInput<C>,
): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 120)); // simulate IPC latency so loading states render
  switch (command) {
    case "session.status":
      return {
        data: { unlocked: session.unlocked, company_id: session.company_id, license: null },
      };
    case "session.unlock": {
      const { pin, company_id } = args as { pin: string; company_id: string };
      if (pin === "wrong") {
        return {
          error: {
            code: "AUTH_PIN_INVALID",
            message: "pin mismatch",
            userMessage: "Incorrect PIN. Please try again.",
            httpStatus: 401,
            retryable: true,
            retryAfterMs: null,
            details: {},
          },
        };
      }
      if (company_id !== uuid()) {
        return {
          error: {
            code: "STORAGE_DECRYPT_FAILED",
            message: "unknown company",
            userMessage:
              "This Company file could not be decrypted. Choose a different file or restore a backup.",
            httpStatus: 500,
            retryable: false,
            retryAfterMs: null,
            details: {},
          },
        };
      }
      session.unlocked = true;
      session.company_id = company_id;
      return { data: { company_id, session_token: "dev-mock-session-token-0000000000000" } };
    }
    case "session.lock":
      session.unlocked = false;
      return { data: { locked: true } };
    case "company.list":
      return {
        data: [
          {
            id: uuid(),
            name: "Meridian Holdings (Demo)",
            type: "group",
            default_currency_code: "USD",
            base_locale: "en-IN",
            last_opened_at: session.unlocked ? "2026-08-30T00:00:00Z" : null,
            license_status: "active",
          },
        ],
      };
    case "company.create":
      session.unlocked = true;
      session.company_id = uuid();
      return { data: { company_id: uuid() } };
    case "calendar.preview":
      return { data: ORACLE_SAMPLE };
    case "pack.list":
      return {
        data: [
          {
            key: "saas",
            name: "SaaS / Tech",
            version: "2.1.0",
            schema_version: "1.0.0",
            is_bundled: true,
          },
          {
            key: "manufacturing",
            name: "Manufacturing",
            version: "2.1.0",
            schema_version: "1.0.0",
            is_bundled: true,
          },
          {
            key: "retail",
            name: "Retail",
            version: "2.1.0",
            schema_version: "1.0.0",
            is_bundled: true,
          },
        ],
      };
    default:
      return {
        error: {
          code: "INTERNAL",
          message: `mock: unimplemented ${command}`,
          userMessage: "This action is not available in the dev preview yet.",
          httpStatus: 501,
          retryable: false,
          retryAfterMs: null,
          details: { command },
        },
      };
  }
}
