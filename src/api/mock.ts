/**
 * DEV-ONLY mock core for the browser preview (`npm run dev` without the Tauri shell).
 *
 * B18-3: this data NEVER reaches a production path — `isTauriRuntime()` gates it out,
 * and the built app runs inside Tauri where the Rust core answers. The mock exists so
 * UI developers can see the 5 screen states without building the native shell.
 * The Rust core is the single owner of money/calendar logic (B14) — the mock mirrors
 * shapes, NOT semantics; it is not a spec of behaviour.
 */
import Decimal from "decimal.js";
import {
  CANONICAL_MAPPING_ID,
  findUnsupportedFunction,
  type CommandInput,
  type CommandName,
  type ImportMappingTemplate,
  type DriverDef,
  type AssumptionDef,
  type AssumptionListRow,
} from "./schema";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface MockSession {
  unlocked: boolean;
  company_id: string | null;
  model_id: string | null;
  /** AUTH-SPEC §2.5 degraded session flag (mirror of the Rust core's chain verdict). */
  read_only: boolean;
}

const session: MockSession = {
  unlocked: false,
  company_id: null,
  model_id: null,
  read_only: false,
};

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

/** Browser-preview model registry mirror; native Company creation persists the same relationship. */
const mockCompanyModels = new Map<string, string>([
  [DEMO_ID, "3f9f2c9e-9f8b-4e2d-9a1c-100000000001"],
  [SANDBOX_ID, "3f9f2c9e-9f8b-4e2d-9a1c-100000000002"],
]);

function modelIdForCompany(companyId: string): string {
  const existing = mockCompanyModels.get(companyId);
  if (existing) return existing;
  // Mock ids only need to be stable and shape-valid; native ids are random UUIDv4 values.
  mockCompanyModels.set(companyId, companyId);
  return companyId;
}

/** Dev-only sample COA so S-021 merge/import are exercisable without a Company (B18-3). */
const MOCK_ACCOUNTS = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    code: "4000",
    name: "Revenue",
    account_type: "revenue",
    report_section: "Income Statement",
    parent_id: null,
    bu_id: null,
    is_control: false,
    active: true,
    version: 1,
    usage_count: 2,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    code: "4100",
    name: "Deferred Revenue",
    account_type: "revenue",
    report_section: "Income Statement",
    parent_id: "00000000-0000-4000-8000-000000000001",
    bu_id: null,
    is_control: false,
    active: true,
    version: 1,
    usage_count: 0,
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    code: "5000",
    name: "Cost of Goods Sold",
    account_type: "cogs",
    report_section: "Income Statement",
    parent_id: null,
    bu_id: null,
    is_control: false,
    active: true,
    version: 1,
    usage_count: 1,
  },
];

/** Mirrors the bundled pack.json `pack` objects (INDUSTRY-PACK-SPEC; dev-only, B18-3). */
const PACKS = [
  [
    "saas",
    "SaaS / Tech",
    "ARR, net revenue retention, CAC payback, burn multiple — SaaS revenue and unit economics.",
  ],
  [
    "manufacturing",
    "Manufacturing",
    "Standard costing, production plan, capacity, WIP; OEE, inventory turns, standard cost variance.",
  ],
  [
    "retail",
    "Retail",
    "Same-store sales, GMROI, conversion, inventory turns — merchandising and store operations.",
  ],
  [
    "healthcare",
    "Healthcare",
    "Cost per patient, payer mix, denial rate, net days in AR — clinical and revenue-cycle operations.",
  ],
  [
    "construction",
    "Construction",
    "Backlog, over/under billing, cost-to-cost % complete — project accounting and WIP.",
  ],
  [
    "professional-services",
    "Professional Services",
    "Utilization, revenue per FTE, pipeline coverage, DSO — billable capacity and delivery.",
  ],
  [
    "nonprofit",
    "Nonprofit",
    "Program ratio, donor retention, grant coverage, cost per dollar raised — funds and grant management.",
  ],
  [
    "government",
    "Government",
    "Budget execution, encumbrance, program spend, timely close — appropriations and fund control.",
  ],
  [
    "energy",
    "Energy",
    "Tariff recovery, plant availability, cost per MWh, hedge ratio — generation and trading.",
  ],
  [
    "financial-services",
    "Financial Services",
    "Net interest margin, loss ratio, cost/income, medical loss ratio — balance sheet and underwriting.",
  ],
  [
    "logistics",
    "Logistics",
    "Cost per mile, fleet utilization, on-time delivery, DSO — fleet and network operations.",
  ],
  [
    "real-estate",
    "Real Estate",
    "Net operating income, cap rate, occupancy, rent roll — property operations and valuations.",
  ],
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
  validationFindings: boolean;
  companyId: string | null;
}

interface MockMapping {
  mappingId: string;
  version: string;
  template: ImportMappingTemplate;
}

const parses = new Map<string, MockParse>();
const mappingsByName = new Map<string, MockMapping>();
const rolledBackBatches = new Set<string>();
let importSeq = 0;

/* ── Model grid (B14: shape mirror only; the Rust core owns formula/money semantics) ── */

interface MockModelCell {
  valueMinor: number | null;
  value: string | null;
  formula: string | null;
  manualOverride: boolean;
}

/** Exact minor-units conversion for the mock's USD scale (2) — never float (B3). */
function mockToMinorUnits(value: string): number {
  const neg = value.startsWith("-");
  const body = neg ? value.slice(1) : value;
  const [intPart, fracPart = ""] = body.split(".");
  const frac = `${fracPart}00`.slice(0, 2);
  // money-ast: the numeric constructor floats money — parseInt(x, 10) is the permitted exact form (B3).
  return parseInt(`${neg ? "-" : ""}${intPart}${frac}`, 10);
}

const modelCells = new Map<string, MockModelCell>();
let modelAuditSeq = 100;

/* ── Driver Tables (B14 shape mirror only · F-013 · M3-3) ── */

/** In-memory `drivers` rows keyed by driver_id. */
const mockDrivers = new Map<string, DriverDef>();
const mockAssumptions = new Map<string, AssumptionListRow>();
const mockAssumptionModels = new Map<string, string>();
/** `driver_values` rows keyed `${driver_id}:${scenario_id}:${period_id}` → exact decimal string. */
const mockDriverValues = new Map<string, string>();

/** Exact decimal comparison for bounds (never float — B3). */
function decimalCmp(a: string, b: string): number {
  const x = new Decimal(a);
  const y = new Decimal(b);
  if (x.lessThan(y)) return -1;
  if (x.greaterThan(y)) return 1;
  return 0;
}

/** Formula reference match for a named assumption (identifier boundaries, with optional @ preview syntax). */
function formulaReferencesName(formula: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])@?${escaped}(?![A-Za-z0-9_])`, "i").test(formula);
}

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

function parseCompanyMismatch() {
  return mockError(
    "VALUE_INVALID",
    "PARSE_COMPANY_MISMATCH: re-parse the file in this Company",
    "Invalid arguments.",
    422,
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
    case "session.status": {
      // Shape mirror only (B18-3): the Rust core derives this live from `licenses`
      // (license_status_json) — the mock reflects the dev company's fixture state so
      // S-073's populated/empty states are reachable in the browser.
      const license =
        session.unlocked && session.company_id
          ? {
              status: "active",
              days_left: 365,
              plan: "pro",
              expires_at: "2099-12-31T23:59:59Z",
              license_key_id: "LK-MOCK-DEV-0001",
              machine_fingerprint: "fp-devbrowser00000000000000000000000000",
            }
          : null;
      return {
        data: {
          unlocked: session.unlocked,
          company_id: session.company_id,
          model_id: session.model_id,
          read_only: session.read_only,
          license,
        },
      };
    }
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
      session.model_id = modelIdForCompany(company_id);
      session.read_only = pin === MOCK_CHAIN_BREAK_PIN;
      return {
        data: {
          company_id,
          model_id: session.model_id,
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
      session.company_id = null;
      session.model_id = null;
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
      session.model_id = modelIdForCompany(company.id);
      session.read_only = false;
      company.last_opened_at = new Date().toISOString();
      return {
        data: {
          company_id: company.id,
          model_id: session.model_id,
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
      const model_id = modelIdForCompany(id);
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
      session.model_id = model_id;
      session.read_only = false;
      return { data: { company_id: id, model_id } };
    }
    case "company.clone_sandbox": {
      const { company_id, name } = args as { company_id: string; name: string };
      const trimmed = name.trim();
      if (trimmed.length < 2) {
        return mockError(
          "VALUE_INVALID",
          "sandbox name required",
          "A sandbox name is required.",
          422,
        );
      }
      const src = companies.find((c) => c.id === company_id);
      if (!src) {
        return mockError(
          "STORAGE_FILE_CORRUPT",
          "unknown company",
          "This Company file could not be verified. Restore from Backup?",
          422,
        );
      }
      if (companies.some((c) => c.name === trimmed)) {
        return mockError(
          "VALUE_INVALID",
          `name '${trimmed}' already in use`,
          `A Company named “${trimmed}” already exists.`,
          422,
        );
      }
      const dir = src.company_file_path.replace(/\/[^/]*$/, "");
      const id = `3f9f2c9e-9f8b-4e2d-9a1c-${String(companies.length + 3).padStart(12, "0")}`;
      modelIdForCompany(id);
      companies.unshift({
        id,
        name: trimmed,
        type: src.type,
        default_currency_code: src.default_currency_code,
        base_locale: src.base_locale,
        last_opened_at: new Date().toISOString(),
        company_file_path: `${dir}/${trimmed}.fpa`,
        license_status: src.license_status,
      });
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
      return { data: MOCK_ACCOUNTS };
    case "coa.import": {
      const { file_path, pack_key } = args as {
        file_path?: string;
        pack_key?: string;
      };
      if (Boolean(file_path) === Boolean(pack_key)) {
        return mockError(
          "VALUE_INVALID",
          "exactly one of file_path / pack_key is required",
          "Invalid arguments.",
          422,
        );
      }
      return { data: { created: 12, updated: 2 } };
    }
    case "coa.merge_accounts": {
      const { from_id, to_id } = args as { from_id: string; to_id: string };
      if (from_id === to_id) {
        return mockError(
          "VALUE_INVALID",
          "from and to must differ",
          "Choose two different accounts to merge.",
          422,
        );
      }
      return { data: { remapped: 3 } };
    }
    case "pack.list":
      return {
        data: PACKS.map(([key, name, description]) => ({
          key,
          name,
          version: "2.1.0",
          schema_version: "1.0.0",
          description,
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
      parses.set(parseId, {
        kind,
        rows: MOCK_PARSE_ROWS,
        balanced,
        validationFindings: file_path.toLowerCase().includes("validation-findings"),
        companyId: session.company_id,
      });
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
    case "import.map.save_v1": {
      const { template } = args as { template: ImportMappingTemplate };
      if (session.read_only) {
        return mockError(
          "AUDIT_CHAIN_BREAK",
          "mapping write blocked in degraded session",
          "Audit integrity check failed. Restore from the last verified Snapshot?",
          409,
        );
      }
      const companyScopedName = `${session.company_id ?? "preview-no-company"}\u0000${template.name}`;
      const existing = mappingsByName.get(companyScopedName);
      const nextVersion = existing ? BigInt(existing.version.slice(1)) + 1n : 1n;
      const mapping: MockMapping = {
        mappingId: existing?.mappingId ?? nextImportId("500"),
        version: `v${String(nextVersion)}`,
        template,
      };
      mappingsByName.set(companyScopedName, mapping);
      return { data: { mapping_id: mapping.mappingId, version: mapping.version } };
    }
    case "import.validate": {
      const { parse_id, mapping_id } = args as { parse_id: string; mapping_id: string };
      const parse = parses.get(parse_id);
      if (!parse) return parseExpired();
      if (parse.companyId !== session.company_id) return parseCompanyMismatch();
      let mappingVersion = "canonical-v1";
      if (mapping_id !== CANONICAL_MAPPING_ID) {
        const companyPrefix = `${session.company_id ?? "preview-no-company"}\u0000`;
        const saved = [...mappingsByName.entries()].find(
          ([key, mapping]) => key.startsWith(companyPrefix) && mapping.mappingId === mapping_id,
        )?.[1];
        if (!saved) {
          return mockError(
            "VALUE_INVALID",
            `MAPPING_TEMPLATE_NOT_FOUND: ${mapping_id}`,
            "Invalid arguments.",
            422,
          );
        }
        mappingVersion = saved.version;
      }
      const preview = mockPreviewRows(parse.balanced);
      if (parse.validationFindings) {
        return {
          data: {
            hard: [
              {
                code: "MAP_ACCOUNT_AMBIGUOUS",
                message:
                  "ACCOUNT_MISSING: '99999' is not in this Company's COA — correct the source or mapping and validate again (GL-TEMPLATE-SPEC §6)",
                line_no: 3,
                details: { accountCode: "99999", list: [] },
              },
            ],
            warnings: [
              {
                code: "VALUE_INVALID",
                message: "POSTING_REF_DUPLICATE: 'INV-2001' first seen on row 2",
                line_no: 4,
                details: { postingRef: "INV-2001", firstLineNo: 2 },
              },
            ],
            preview: [preview[0], { ...preview[2], posting_ref: "INV-2001" }],
            rows: 2,
            mapping_version: mappingVersion,
          },
        };
      }
      return {
        data: {
          hard: [],
          warnings: [],
          preview,
          rows: parse.rows,
          mapping_version: mappingVersion,
        },
      };
    }
    case "import.tieout": {
      const { parse_id } = args as { parse_id: string };
      const parse = parses.get(parse_id);
      if (!parse) return parseExpired();
      if (parse.companyId !== session.company_id) return parseCompanyMismatch();
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
      if (parse.companyId !== session.company_id) return parseCompanyMismatch();
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
    case "model.cell.set.v1": {
      const { line_id, scenario_id, period_id, value, formula, manual_override } = args as {
        line_id: string;
        scenario_id: string;
        period_id: string;
        value?: string | null;
        formula?: string | null;
        manual_override?: boolean;
      };
      // AUTH-SPEC §3 gate (mirror): a Locked Scenario never accepts an edit.
      if (scenario_id.includes("locked")) {
        return mockError(
          "MODEL_CELL_LOCKED",
          "scenario is locked",
          "This scenario is locked. Create a Version to edit it.",
          422,
        );
      }
      if (formula) {
        const unsupported = findUnsupportedFunction(formula);
        if (unsupported) {
          return mockError(
            "FORMULA_UNSUPPORTED_FUNCTION",
            `function ${unsupported} not in supported set`,
            `Function ${unsupported} is not in the supported set (see FORMULA-ENGINE-SPEC.md). Replace it or file a V2 request.`,
            422,
            false,
            { function: unsupported },
          );
        }
      }
      const valueMinor = value == null ? null : mockToMinorUnits(value);
      const key = `${scenario_id}:${line_id}:${period_id}`;
      modelCells.set(key, {
        valueMinor,
        value: value ?? null,
        formula: formula ?? null,
        manualOverride: manual_override ?? false,
      });
      modelAuditSeq += 1;
      return {
        data: {
          recalc: {
            dirty_cells: 1,
            cycles: [],
            changed_cells: [line_id],
            issues: [],
            duration_ms: 0,
          },
          cell: {
            value_minor: valueMinor,
            amount_text: value ?? null,
            formula: formula ?? null,
            manual_override: manual_override ?? false,
          },
          audit_id: modelAuditSeq,
        },
      };
    }
    case "model.recalc": {
      const { scenario_id } = args as { scenario_id: string };
      let dirty = 0;
      const lines = new Set<string>();
      for (const [key] of modelCells) {
        if (key.startsWith(`${scenario_id}:`)) {
          dirty += 1;
          lines.add(key.split(":")[1]);
        }
      }
      const changed_cells = [...lines].sort();
      // API-SPEC §2: `model.recalc` returns the flat recalc envelope `{duration_ms, changed_cells,
      // issues[]}` (the `recalc` wrapper belongs to `model.cell.set.v1`, API-SPEC §3).
      return {
        data: {
          duration_ms: 0,
          changed_cells,
          issues: [],
          // Additive diagnostics the grid uses (B20 — new response fields are fine).
          dirty_cells: dirty,
          cycles: [],
        },
      };
    }
    case "model.inspect": {
      const { line_id, period_id } = args as { line_id: string; period_id: string };
      // Preview-mock mirror: `model.cell.set.v1` stores cells under `${scenario_id}:${line_id}:${period_id}`;
      // inspection is scenario-agnostic here (read-only preview), so find the cell across scenarios.
      const match = [...modelCells.entries()].find(([key]) =>
        key.endsWith(`:${line_id}:${period_id}`),
      );
      const cell = match ? modelCells.get(match[0]) : undefined;
      return {
        data: {
          line_id,
          period_id,
          formula: cell?.formula ?? null,
          computed_text: cell?.value ?? null,
          error_code: null,
          precedents: [],
          dependents: [],
          cycle: null,
          is_cycle: false,
        },
      };
    }
    case "driver.upsert": {
      const { driver } = args as {
        model_id: string;
        driver: {
          id?: string;
          name: string;
          driver_type: string;
          unit?: string | null;
          source: string;
          is_core?: boolean;
          bounds_low?: string | null;
          bounds_high?: string | null;
        };
      };
      // DRIVER_FEED_MISSING mirror (ERROR-HANDLING §E): a `collection`/`imported` driver with no
      // feed source cannot be saved. Dev trigger: name contains "nofeed".
      if (driver.source === "collection" && driver.name.includes("nofeed")) {
        return mockError(
          "DRIVER_FEED_MISSING",
          "driver has no data and no feed source",
          "Driver has no data and no feed source. Import, collect, or set a static value.",
          422,
        );
      }
      const id = driver.id ?? `dr-${driver.name.toLowerCase()}`;
      const created = !mockDrivers.has(id);
      const def: DriverDef = {
        id,
        name: driver.name,
        driver_type: driver.driver_type as DriverDef["driver_type"],
        unit: driver.unit ?? null,
        source: driver.source as DriverDef["source"],
        is_core: driver.is_core ?? false,
        bounds_low: driver.bounds_low ?? null,
        bounds_high: driver.bounds_high ?? null,
      };
      mockDrivers.set(id, def);
      return { data: { driver_id: id, created } };
    }
    case "driver.set_value": {
      const { driver_id, scenario_id, period_id, value_decimal } = args as {
        driver_id: string;
        scenario_id: string;
        period_id: string;
        value_decimal: string;
      };
      const def = mockDrivers.get(driver_id);
      if (!def) {
        return mockError(
          "REFERENCE_BROKEN",
          "unknown driver",
          "This driver does not exist. Create it first.",
          422,
        );
      }
      // Bounds enforcement mirror (DRIVER_OUT_OF_BOUNDS · ERROR-HANDLING §E) — exact decimal, no float.
      if (def.bounds_low != null && decimalCmp(value_decimal, def.bounds_low) < 0) {
        return mockError(
          "DRIVER_OUT_OF_BOUNDS",
          `value ${value_decimal} below bounds ${def.bounds_low}`,
          `Driver value ${value_decimal} is outside its bounds [${def.bounds_low}, ${
            def.bounds_high ?? "∞"
          }]. Update bounds (audited) or fix the value.`,
          422,
          false,
          { driver_id, value: value_decimal, low: def.bounds_low, high: def.bounds_high },
        );
      }
      if (def.bounds_high != null && decimalCmp(value_decimal, def.bounds_high) > 0) {
        return mockError(
          "DRIVER_OUT_OF_BOUNDS",
          `value ${value_decimal} above bounds ${def.bounds_high}`,
          `Driver value ${value_decimal} is outside its bounds [${
            def.bounds_low ?? "0"
          }, ${def.bounds_high}]. Update bounds (audited) or fix the value.`,
          422,
          false,
          { driver_id, value: value_decimal, low: def.bounds_low, high: def.bounds_high },
        );
      }
      mockDriverValues.set(`${driver_id}:${scenario_id}:${period_id}`, value_decimal);
      return {
        data: {
          ok: true,
          recalc: {
            dirty_cells: 1,
            cycles: [],
            changed_cells: [driver_id],
            issues: [],
            duration_ms: 0,
          },
          value_decimal,
        },
      };
    }
    case "assumption.list": {
      const { model_id } = args as { model_id: string };
      return {
        data: [...mockAssumptions.entries()]
          .filter(([id]) => mockAssumptionModels.get(id) === model_id)
          .map(([, assumption]) => assumption)
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    }
    case "assumption.upsert": {
      const { model_id, assumption } = args as {
        model_id: string;
        assumption: AssumptionDef;
      };
      // Dev-only trigger for the locked-baseline branch. The real Rust command determines this
      // from scenario/version references; the preview has no scenario registry.
      if (assumption.id?.includes("locked")) {
        return mockError(
          "ASSUMPTION_IN_USE_LOCKED",
          "assumption is used by a locked baseline",
          "Assumption is used by a Locked Baseline. Create a new Version to change.",
          422,
          false,
          { assumption_id: assumption.id },
        );
      }
      const existingByName = [...mockAssumptions.entries()].find(
        ([existingId, existing]) =>
          !assumption.id &&
          mockAssumptionModels.get(existingId) === model_id &&
          existing.name === assumption.name,
      );
      const id = assumption.id ?? existingByName?.[0] ?? `as-${model_id}-${assumption.name}`;
      if (assumption.id && !mockAssumptions.has(id)) {
        return mockError(
          "VALUE_INVALID",
          "assumption id does not exist",
          "Invalid arguments.",
          422,
        );
      }
      if (assumption.id && mockAssumptionModels.get(id) !== model_id) {
        return mockError(
          "VALUE_INVALID",
          "assumption belongs to another model",
          "Invalid arguments.",
          422,
        );
      }
      const duplicate = [...mockAssumptions.entries()].some(
        ([existingId, existing]) =>
          existingId !== id &&
          mockAssumptionModels.get(existingId) === model_id &&
          existing.name === assumption.name,
      );
      if (duplicate) {
        return mockError(
          "VALUE_INVALID",
          "assumption name already exists in this model",
          "Invalid arguments.",
          422,
        );
      }
      if (
        assumption.bounds_low != null &&
        assumption.bounds_high != null &&
        decimalCmp(assumption.bounds_low, assumption.bounds_high) > 0
      ) {
        return mockError(
          "VALUE_INVALID",
          "bounds_low exceeds bounds_high",
          "Invalid arguments.",
          422,
        );
      }
      for (const value of Object.values(assumption.values)) {
        if (
          (assumption.bounds_low != null && decimalCmp(value, assumption.bounds_low) < 0) ||
          (assumption.bounds_high != null && decimalCmp(value, assumption.bounds_high) > 0)
        ) {
          return mockError(
            "VALUE_INVALID",
            "assumption value is outside bounds",
            "Invalid arguments.",
            422,
          );
        }
      }
      const created = !mockAssumptions.has(id);
      const version = (mockAssumptions.get(id)?.version ?? 0) + 1;
      mockAssumptions.set(id, {
        ...assumption,
        id,
        values: { ...assumption.values },
        version,
        last_changed_at: new Date().toISOString(),
      });
      mockAssumptionModels.set(id, model_id);
      return { data: { assumption_id: id, created } };
    }
    case "assumption.find_usages": {
      const { assumption_id } = args as { assumption_id: string };
      const name = mockAssumptions.get(assumption_id)?.name;
      if (!name) return { data: { cells: [] } };
      const cells = [...modelCells.entries()]
        .map(([key, cell]) => {
          if (cell.formula == null || !formulaReferencesName(cell.formula, name)) return null;
          const parts = key.split(":");
          const line_id = parts[1];
          const period_id = parts[2];
          if (!line_id || !period_id) return null;
          return { line_id, period_id, formula: cell.formula };
        })
        .filter(
          (cell): cell is { line_id: string; period_id: string; formula: string } => cell !== null,
        )
        .sort((a, b) => `${a.line_id}:${a.period_id}`.localeCompare(`${b.line_id}:${b.period_id}`));
      return { data: { cells } };
    }
    case "driver.import": {
      const { file_path } = args as { file_path: string; mapping_id: string };
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
      return { data: { batch_id: nextImportId("400") } };
    }
    /* ── License (F-035) — shape mirror only (B18-3): the Rust core owns Ed25519 ─────
     * Dev triggers so S-073's states are reachable in the browser: a payload JSON whose
     * license_key_id contains "invalid" → LICENSE_INVALID_SIGNATURE; "expired" →
     * LICENSE_EXPIRED; otherwise the payload's own expires_at drives active/grace.      */
    case "license.verify":
    case "license.apply_response": {
      const raw = (
        "license_payload" in args
          ? (args as { license_payload: string }).license_payload
          : (args as { response_path_or_payload: string }).response_path_or_payload
      ).trim();
      let payload: { license_key_id?: string; plan?: string; expires_at?: string };
      try {
        payload = JSON.parse(raw);
      } catch {
        return mockError(
          "LICENSE_INVALID_SIGNATURE",
          "payload is not JSON",
          "This license key is invalid. Contact your vendor.",
          403,
        );
      }
      if (!payload.license_key_id || !payload.expires_at) {
        return mockError(
          "LICENSE_INVALID_SIGNATURE",
          "missing field in payload",
          "This license key is invalid. Contact your vendor.",
          403,
        );
      }
      const keyId = payload.license_key_id.toLowerCase();
      const msPerDay = 86_400_000;
      const expires = Date.parse(payload.expires_at);
      const now = Date.now();
      if (keyId.includes("expired") || now >= expires + 60 * msPerDay) {
        return mockError(
          "LICENSE_EXPIRED",
          "license past expiry and beyond the 60-day grace window",
          "License expired. The Company is read-only. Activate to continue.",
          403,
        );
      }
      if (keyId.includes("invalid")) {
        return mockError(
          "LICENSE_INVALID_SIGNATURE",
          "ed25519 signature does not verify",
          "This license key is invalid. Contact your vendor.",
          403,
        );
      }
      const status = now < expires ? "active" : "grace";
      const daysLeft = Math.max(0, Math.floor((expires - now) / msPerDay));
      if (command === "license.verify") {
        return { data: { status, days_left: daysLeft } };
      }
      return {
        data: {
          status,
          plan: payload.plan === "enterprise" ? "enterprise" : "pro",
          days_left: daysLeft,
        },
      };
    }
    case "license.request_file": {
      const { company_path } = args as { company_path: string };
      return { data: { file: `${company_path}.license-request.json` } };
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
