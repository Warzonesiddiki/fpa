/**
 * DEV-ONLY mock core for the browser preview (`npm run dev` without the Tauri shell).
 *
 * B18-3: this data NEVER reaches a production path — `isTauriRuntime()` gates it out,
 * and the built app runs inside Tauri where the Rust core answers. The mock exists so
 * UI developers can see the 5 screen states without building the native shell.
 * The Rust core is the single owner of money/calendar logic (B14) — the mock mirrors
 * shapes, NOT semantics; it is not a spec of behaviour.
 */
import { CANONICAL_MAPPING_ID, type CommandInput, type CommandName } from "./schema";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface MockSession {
  unlocked: boolean;
  company_id: string | null;
  /** AUTH-SPEC §2.5 degraded session flag (mirror of the Rust core's chain verdict). */
  read_only: boolean;
}

const session: MockSession = { unlocked: false, company_id: null, read_only: false };

/**
 * Dev trigger (mock-only, mirrors `WrongPin9!`): unlocking with the PIN "AuditBrk9!" answers
 * the documented `AUDIT_CHAIN_BREAK` degraded state (AUTH-SPEC §2.5) — unlock succeeds but the
 * Company is read-only and S-004 shows the restore offer. Shape mirror, not semantics (B18-3).
 */
export const MOCK_CHAIN_BREAK_PIN = "AuditBrk9!";
const MOCK_BROKEN_SEQ = 41;

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

/** Dev mirror of the Rust error body (ERROR-HANDLING §1) — shape only, never semantics (B18-3). */
function mockError(
  code: string,
  message: string,
  userMessage: string,
  httpStatus: number,
  retryable = false,
  details: Record<string, unknown> = {},
) {
  return {
    error: { code, message, userMessage, httpStatus, retryable, retryAfterMs: null, details },
  };
}

/* ── Import fixtures (B19) ────────────────────────────────────────────────────────────────
 * Dev trigger, paralleling `WrongPin9!` / `AuditBrk9!`: a file path containing "unbalanced"
 * parses a GL Dump whose debits and credits disagree by 5 minor units, so the Tie-Out gate,
 * the exclude-with-log path and IMPORT_TIE_OUT_FAILED are all reachable in the browser preview.
 * "locked" → IMPORT_FILE_LOCKED · "unreadable" → IMPORT_FILE_UNREADABLE.                     */
export const MOCK_UNBALANCED_FILE = "unbalanced";

const GL_TEMPLATE_HEADERS = [
  "period",
  "account_code",
  "account_name",
  "debit",
  "credit",
  "amount",
  "cost_center",
  "project",
  "product",
  "customer",
  "business_unit",
  "intercompany_tag",
  "currency",
  "posting_ref",
  "doc_type",
];

const MOCK_SOURCE_HASH = "aa11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900";
const MOCK_REVENUE_MINOR = 635_000_000; // credit 6,350,000.00 USD (GL-TEMPLATE-SPEC §4 example)
const MOCK_MATERIALS_MINOR = 182_500_000; // debit 1,825,000.00 USD
const MOCK_OPEX_MINOR = 452_500_000; // debit 4,525,000.00 USD — balances the journal entry
const MOCK_IMBALANCE_MINOR = 5; // the tie-out difference of the "unbalanced" dev fixture
const MOCK_PARSE_ROWS = 3;

interface MockParse {
  kind: string;
  rows: number;
  balanced: boolean;
}

const parses = new Map<string, MockParse>();
const rolledBackBatches = new Set<string>();
let importSeq = 0;

/** Deterministic dev uuid (the Rust core mints real v4 ids). */
function nextImportId(group: string): string {
  importSeq += 1;
  return `3f9f2c9e-9f8b-4e2d-9a1c-${group}${String(importSeq).padStart(9, "0")}`;
}

function parseExpired() {
  return mockError(
    "IMPORT_PARSE_EXPIRED",
    "parse session expired or unknown",
    // ERROR-HANDLING §C: the only retryable ingestion code — the UI offers "Re-run the import".
    "This parse session expired. Re-run the import.",
    410,
    true,
  );
}

/** The preview table (SCREENS-SPEC S-031 shows the first 50 rows). */
function mockPreviewRows(balanced: boolean) {
  const opex = balanced ? MOCK_OPEX_MINOR : MOCK_OPEX_MINOR + MOCK_IMBALANCE_MINOR;
  return [
    {
      line_no: 2,
      period_id: "fp-2026-p08",
      account_id: "3f9f2c9e-9f8b-4e2d-9a1c-200000000001",
      account_code: "4000",
      business_unit_id: null,
      amount_minor: -MOCK_REVENUE_MINOR,
      debit_minor: null,
      credit_minor: MOCK_REVENUE_MINOR,
      currency: "USD",
      posting_ref: "INV-2001",
      doc_type: "INVOICE",
      is_ic: false,
    },
    {
      line_no: 3,
      period_id: "fp-2026-p08",
      account_id: "3f9f2c9e-9f8b-4e2d-9a1c-200000000002",
      account_code: "4100",
      business_unit_id: null,
      amount_minor: MOCK_MATERIALS_MINOR,
      debit_minor: MOCK_MATERIALS_MINOR,
      credit_minor: null,
      currency: "USD",
      posting_ref: "PO-8811",
      doc_type: "PURCHASE",
      is_ic: false,
    },
    {
      line_no: 4,
      period_id: "fp-2026-p08",
      account_id: "3f9f2c9e-9f8b-4e2d-9a1c-200000000003",
      account_code: "5000",
      business_unit_id: null,
      amount_minor: opex,
      debit_minor: opex,
      credit_minor: null,
      currency: "USD",
      posting_ref: "PO-8812",
      doc_type: "PURCHASE",
      is_ic: false,
    },
  ];
}

export async function mockInvoke<C extends CommandName>(
  command: C,
  args: CommandInput<C>,
): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 120)); // simulate IPC latency so loading states render
  switch (command) {
    case "session.status":
      return {
        data: {
          unlocked: session.unlocked,
          company_id: session.company_id,
          read_only: session.read_only,
          license: null,
        },
      };
    case "security.pin_setup":
      // Shape mirror only (B18-3): the Rust core owns policy + persistence.
      return { data: { ok: true } };
    case "session.unlock": {
      const { pin, company_id } = args as { pin: string; company_id: string };
      if (pin === "WrongPin9!") {
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
            // Mirrors the Rust core exactly (ERROR-HANDLING.md §B: key mismatch is 401).
            code: "STORAGE_DECRYPT_FAILED",
            message: "unknown company",
            userMessage: "The Company file cannot be decrypted with this PIN.",
            httpStatus: 401,
            retryable: false,
            retryAfterMs: null,
            details: {},
          },
        };
      }
      session.unlocked = true;
      session.company_id = company_id;
      session.read_only = pin === MOCK_CHAIN_BREAK_PIN;
      return {
        data: {
          company_id,
          session_token: "dev-mock-session-token-0000000000000",
          read_only: session.read_only,
          integrity: {
            audit_chain_ok: !session.read_only,
            broken_at_seq: session.read_only ? MOCK_BROKEN_SEQ : null,
          },
        },
      };
    }
    case "session.lock":
      session.unlocked = false;
      session.read_only = false;
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
      session.read_only = false;
      company.last_opened_at = new Date().toISOString();
      return {
        data: {
          company_id: company.id,
          read_only: false,
          integrity: { audit_chain_ok: true, broken_at_seq: null },
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
      session.read_only = false;
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
    case "import.parse": {
      const { file_path, kind } = args as { file_path: string; kind: string };
      if (file_path.includes("locked")) {
        return mockError(
          "IMPORT_FILE_LOCKED",
          "workbook is password protected",
          "This file is password-protected. Remove protection and export again.",
          422,
        );
      }
      if (file_path.includes("unreadable")) {
        return mockError(
          "IMPORT_FILE_UNREADABLE",
          "file could not be read",
          "This file could not be read. Export it again as .xlsx or .csv without a password.",
          422,
        );
      }
      const parseId = nextImportId("100");
      const balanced = !file_path.includes(MOCK_UNBALANCED_FILE);
      parses.set(parseId, { kind, rows: MOCK_PARSE_ROWS, balanced });
      return {
        data: {
          parse_id: parseId,
          sheets: [
            { name: "GL", kind: "gl", row_count: MOCK_PARSE_ROWS },
            { name: "COA", kind: "coa", row_count: 12 },
          ],
          encodings: [{ scope: "GL", encoding: "utf-8", bom: true, auto_detected: false }],
          row_counts: { GL: MOCK_PARSE_ROWS, COA: 12 },
          source_name: file_path.split(/[\\/]/).pop() || file_path,
          source_hash: MOCK_SOURCE_HASH,
          size_bytes: 4_821_136,
          headers: GL_TEMPLATE_HEADERS,
        },
      };
    }
    case "import.validate": {
      const { parse_id, mapping_id } = args as { parse_id: string; mapping_id: string };
      const parse = parses.get(parse_id);
      if (!parse) return parseExpired();
      return {
        data: {
          hard: [],
          warnings: [],
          preview: mockPreviewRows(parse.balanced),
          rows: parse.rows,
          mapping_version: mapping_id === CANONICAL_MAPPING_ID ? "canonical-v1" : "v3",
        },
      };
    }
    case "import.tieout": {
      const { parse_id } = args as { parse_id: string };
      const parse = parses.get(parse_id);
      if (!parse) return parseExpired();
      const debits = parse.balanced
        ? MOCK_REVENUE_MINOR
        : MOCK_REVENUE_MINOR + MOCK_IMBALANCE_MINOR;
      const opex = parse.balanced ? MOCK_OPEX_MINOR : MOCK_OPEX_MINOR + MOCK_IMBALANCE_MINOR;
      return {
        data: {
          debits_minor: debits,
          credits_minor: MOCK_REVENUE_MINOR,
          // Attribution honesty: only the row carrying a posting_ref is named (M5).
          diff_rows: parse.balanced
            ? []
            : [
                {
                  line_no: 4,
                  posting_ref: "PO-8812",
                  debit_minor: opex,
                  credit_minor: null,
                  amount_minor: opex,
                  residual_minor: MOCK_IMBALANCE_MINOR,
                },
              ],
          balanced: parse.balanced,
          rows: parse.rows,
          currency: "USD",
        },
      };
    }
    case "import.commit": {
      const { parse_id, name, exclusions } = args as {
        parse_id: string;
        name: string;
        exclusions: { line_no: number; reason: string }[];
      };
      const parse = parses.get(parse_id);
      if (!parse) return parseExpired();
      if (!name.trim()) {
        return mockError("VALUE_INVALID", "BATCH_NAME_REQUIRED", "Invalid arguments.", 422);
      }
      // The Tie-Out gate: blocked until the difference is explained by an exclusion.
      if (!parse.balanced && exclusions.length === 0) {
        return mockError(
          "IMPORT_TIE_OUT_FAILED",
          "import tie-out failed: debits 635000005 != credits 635000000",
          // Mirrors the Rust formatter (ERROR-HANDLING §1 canonical example).
          "Import blocked: debits 6350000.05 vs credits 6350000.00. Review flagged rows below.",
          422,
          false,
          {
            debitsMinor: MOCK_REVENUE_MINOR + MOCK_IMBALANCE_MINOR,
            creditsMinor: MOCK_REVENUE_MINOR,
            currency: "USD",
            diffRows: [
              {
                lineNo: 4,
                postingRef: "PO-8812",
                debitMinor: MOCK_OPEX_MINOR + MOCK_IMBALANCE_MINOR,
                creditMinor: null,
                amountMinor: MOCK_OPEX_MINOR + MOCK_IMBALANCE_MINOR,
                residualMinor: MOCK_IMBALANCE_MINOR,
              },
            ],
          },
        );
      }
      return {
        data: {
          batch_id: nextImportId("300"),
          rows: parse.rows,
          debits_minor: MOCK_REVENUE_MINOR,
          credits_minor: MOCK_REVENUE_MINOR,
          tie_out_status: exclusions.length > 0 ? "excluded_rows_logged" : "pass",
          audit_id: 99,
          excluded_rows: exclusions.length,
          source_hash: MOCK_SOURCE_HASH,
        },
      };
    }
    case "import.rollback": {
      const { batch_id, reason } = args as { batch_id: string; reason: string };
      if (!reason.trim()) {
        return mockError(
          "VALUE_INVALID",
          "ROLLBACK_REASON_REQUIRED",
          "A reason is required to roll back a batch.",
          422,
        );
      }
      if (rolledBackBatches.has(batch_id)) {
        return mockError(
          "BATCH_ALREADY_ROLLED_BACK",
          "batch already rolled back",
          "This batch was already rolled back.",
          409,
        );
      }
      rolledBackBatches.add(batch_id);
      return { data: { rolled_back_to: null } };
    }
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
