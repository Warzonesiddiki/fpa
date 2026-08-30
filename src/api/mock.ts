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

const DEMO_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";
const SANDBOX_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000002";

interface MockCompany {
  id: string;
  name: string;
  type: "single" | "group";
  default_currency_code: string;
  base_locale: string;
  last_opened_at: string | null;
  company_file_path: string;
  license_status: "active" | "grace" | "expired" | "invalid";
}

const companies: MockCompany[] = [
  {
    id: DEMO_ID,
    name: "Meridian Holdings (Demo)",
    type: "group",
    default_currency_code: "USD",
    base_locale: "en-IN",
    last_opened_at: "2026-08-30T00:00:00Z",
    company_file_path: "/Users/demo/Meridian Holdings.fpa",
    license_status: "active",
  },
  {
    id: SANDBOX_ID,
    name: "Atlas Manufacturing (Sandbox)",
    type: "single",
    default_currency_code: "EUR",
    base_locale: "en-IN",
    last_opened_at: "2026-01-02T00:00:00Z",
    company_file_path: "/Users/demo/Atlas Manufacturing.fpa",
    license_status: "active",
  },
];

const PACKS = [
  ["saas", "SaaS / Tech"],
  ["manufacturing", "Manufacturing"],
  ["retail", "Retail"],
  ["healthcare", "Healthcare"],
  ["construction", "Construction"],
  ["professional-services", "Professional Services"],
  ["nonprofit", "Nonprofit"],
  ["government", "Government"],
  ["energy", "Energy"],
  ["financial-services", "Financial Services"],
  ["logistics", "Logistics"],
  ["real-estate", "Real Estate"],
] as const;

/** Deterministic shape-valid preview (mock only — the Rust engine is the semantic owner). */
function previewFiscalYears(
  preset: string,
  fyStartMonth: number | null,
  from: string,
  yearCount: number,
): {
  fiscal_years: {
    fy_label: string;
    start_date: string;
    end_date: string;
    week_count: 52 | 53;
    periods: {
      period_no: number;
      code: string;
      start_date: string;
      end_date: string;
      is_53rd_week: boolean;
    }[];
  }[];
} {
  const count = Math.min(5, Math.max(1, yearCount));
  const years: {
    fy_label: string;
    start_date: string;
    end_date: string;
    week_count: 52 | 53;
    periods: {
      period_no: number;
      code: string;
      start_date: string;
      end_date: string;
      is_53rd_week: boolean;
    }[];
  }[] = [];
  const anchor = new Date(`${from}T00:00:00Z`);
  const fromYear = anchor.getUTCFullYear();

  for (let i = 0; i < count; i += 1) {
    const yearNumber = fromYear + i;
    const start =
      preset === "12month"
        ? new Date(Date.UTC(yearNumber, (fyStartMonth ?? 4) - 1, 1))
        : new Date(Date.UTC(yearNumber, 1, 1));
    const periodCount = preset === "3334" ? 13 : 12;
    const is53 = preset !== "12month" && yearNumber === 2028; // oracle: 2028 = 53w (TEST-FIXTURES-SPEC §2)
    const baseDays = is53 ? 371 : 364;
    const extraDays = baseDays - periodCount * 28; // 0 or 7 — lands on the final period
    const periods: (typeof years)[number]["periods"] = [];
    let cursor = new Date(start);
    for (let p = 0; p < periodCount; p += 1) {
      const end = new Date(cursor);
      end.setUTCDate(end.getUTCDate() + 27 + (p === periodCount - 1 ? extraDays : 0));
      periods.push({
        period_no: p + 1,
        code: `P${String(p + 1).padStart(2, "0")}`,
        start_date: cursor.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
        is_53rd_week: is53 && p === periodCount - 1,
      });
      cursor = new Date(end);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const end = new Date(periods[periodCount - 1].end_date);
    years.push({
      fy_label: `FY${yearNumber}`,
      start_date: periods[0].start_date,
      end_date: periods[periodCount - 1].end_date,
      week_count: is53 ? 53 : 52,
      periods,
    });
    void end;
  }
  return { fiscal_years: years };
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
      if (!companies.some((c) => c.id === company_id)) {
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
      return { data: companies };
    case "company.open": {
      const { path } = args as { path: string };
      const company = companies.find((c) => c.company_file_path === path);
      if (!company) {
        return {
          error: {
            code: "STORAGE_FILE_CORRUPT",
            message: "unknown company path",
            userMessage:
              "This Company file could not be verified. Restore from Backup? (pre-restore snapshot will be taken)",
            httpStatus: 422,
            retryable: false,
            retryAfterMs: null,
            details: {},
          },
        };
      }
      session.unlocked = true;
      session.company_id = company.id;
      company.last_opened_at = new Date().toISOString();
      return {
        data: {
          company_id: company.id,
          summary: {
            name: company.name,
            type: company.type,
            default_currency_code: company.default_currency_code,
            base_locale: company.base_locale,
            pack_schema_version: "1.0.0",
            company_file_path: company.company_file_path,
          },
        },
      };
    }
    case "company.delete": {
      const { company_id, reason } = args as { company_id: string; reason: string };
      if (!reason.trim()) {
        return {
          error: {
            code: "VALUE_INVALID",
            message: "reason required",
            userMessage: "A deletion reason is required for the audit.",
            httpStatus: 422,
            retryable: false,
            retryAfterMs: null,
            details: {},
          },
        };
      }
      const company = companies.find((c) => c.id === company_id);
      if (!company) {
        return {
          error: {
            code: "STORAGE_FILE_CORRUPT",
            message: "unknown company",
            userMessage:
              "This Company file could not be verified. Restore from Backup? (pre-restore snapshot will be taken)",
            httpStatus: 422,
            retryable: false,
            retryAfterMs: null,
            details: {},
          },
        };
      }
      const lastOpened = company.last_opened_at ? new Date(company.last_opened_at).getTime() : 0;
      const daysAgo = (Date.now() - lastOpened) / 86_400_000;
      if (daysAgo < 30) {
        return {
          error: {
            code: "COMPANY_IN_USE_RECENT",
            message: "recently used",
            userMessage:
              "This Company was used less than 30 days ago. Delete it or wait — recent Companies can't be deleted.",
            httpStatus: 409,
            retryable: false,
            retryAfterMs: null,
            details: { days: 30 },
          },
        };
      }
      companies.splice(companies.indexOf(company), 1);
      return { data: { deleted: true } };
    }
    case "company.create": {
      const { name } = args as { name: string };
      const id = `3f9f2c9e-9f8b-4e2d-9a1c-${String(companies.length + 3).padStart(12, "0")}`;
      companies.unshift({
        id,
        name: name.trim(),
        type: "single",
        default_currency_code: "USD",
        base_locale: "en-IN",
        last_opened_at: new Date().toISOString(),
        company_file_path: `/Users/demo/${name.trim()}.fpa`,
        license_status: "active",
      });
      session.unlocked = true;
      session.company_id = id;
      return { data: { company_id: id } };
    }
    case "calendar.preview": {
      const { preset, fy_start_month, from, year_count } = args as {
        preset: string;
        fy_start_month: number | null;
        from: string;
        year_count?: number;
      };
      return { data: previewFiscalYears(preset, fy_start_month, from, year_count ?? 3) };
    }
    case "calendar.apply":
      return { data: { applied: true } };
    case "coa.list":
      return { data: [] };
    case "pack.list":
      return {
        data: PACKS.map(([key, name]) => ({
          key,
          name,
          version: "2.1.0",
          schema_version: "1.0.0",
          is_bundled: true,
        })),
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
