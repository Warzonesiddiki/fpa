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
  isLedgerImportKind,
  type CommandInput,
  type CommandName,
  type ImportKind,
  type ImportMappingTemplate,
  type DriverDef,
  type AssumptionDef,
  type AssumptionListRow,
  type WhatifSeries,
  type WaterfallStep,
  type TornadoBar,
  type SensitivityValueStep,
  type VarianceRow,
  type VarianceAttributionItem,
  type VarianceThreewayItem,
  type FvaScoreItem,
} from "./schema";
import {
  validateHeadcountRows,
  type HeadcountScheduleRow as HeadcountPlanRow,
} from "@/model/headcount";

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
const MOCK_UNBALANCED_SOURCE_HASH =
  "bb11cc22dd33ee44ff556677889900aabb11cc22dd33ee44ff556677889900aa";
const MOCK_REVENUE_MINOR = 635_000_000; // credit 6,350,000.00 USD (GL-TEMPLATE-SPEC §4 example)
const MOCK_MATERIALS_MINOR = 182_500_000; // debit 1,825,000.00 USD
const MOCK_OPEX_MINOR = 452_500_000; // debit 4,525,000.00 USD — balances the journal entry
const MOCK_IMBALANCE_MINOR = 5; // the tie-out difference of the "unbalanced" dev fixture
const MOCK_PARSE_ROWS = 3;

interface MockParse {
  kind: ImportKind;
  rows: number;
  balanced: boolean;
  validationFindings: boolean;
  companyId: string | null;
  sourceName: string;
  sourceHash: string;
}

interface MockMapping {
  mappingId: string;
  version: string;
  template: ImportMappingTemplate;
}

interface MockImportBatch {
  batch_id: string;
  name: string;
  company_id: string;
  kind: ImportKind;
  source_name: string;
  source_hash: string;
  mapping_version: string;
  status: "committed" | "rolled_back";
  rows: number;
  currency: string;
  debits_minor: number;
  credits_minor: number;
  tie_out_status: "pass" | "excluded_rows_logged";
  rollback_to_batch_id: string | null;
  committed_at: string;
  created_at: string;
}

const parses = new Map<string, MockParse>();
const mappingsByName = new Map<string, MockMapping>();
const importBatches = new Map<string, MockImportBatch>();
let importSeq = 0;

function mockMappingVersion(mappingId: string): string | null {
  if (mappingId === CANONICAL_MAPPING_ID) return "canonical-v1";
  const companyPrefix = `${session.company_id ?? "preview-no-company"}\u0000`;
  return (
    [...mappingsByName.entries()].find(
      ([key, mapping]) => key.startsWith(companyPrefix) && mapping.mappingId === mappingId,
    )?.[1].version ?? null
  );
}

function mappingNotFound(mappingId: string) {
  return mockError(
    "VALUE_INVALID",
    `MAPPING_TEMPLATE_NOT_FOUND: ${mappingId}`,
    "Invalid arguments.",
    422,
  );
}

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

/* ── Headcount schedule (F-016 · S-045 · mock shape mirror) ──────────────────────────── */
/** Session-only mirror until the native schedule handler persists `model_values`/schedule rows. */
const mockHeadcountSchedules = new Map<string, { schedule_id: string; rows: HeadcountPlanRow[] }>();
let mockScheduleAuditSeq = 100;

/** Reset the browser-preview schedule between isolated store/mock tests. */
export function resetMockHeadcountState(): void {
  mockHeadcountSchedules.clear();
  mockScheduleAuditSeq = 100;
}

/* ── Scenario lifecycle (F-022 · SCENARIO-VERSION-SPEC §1–§3 · mock shape mirror) ──────── */

/** The pinned working scenario/model ids (must match `stores/model.ts` WORKING_* constants). */
const WORKING_MODEL_ID_MOCK = "3f9f2c9e-9f8b-4e2d-9a1c-400000000001";
const WORKING_SCENARIO_ID_MOCK = "3f9f2c9e-9f8b-4e2d-9a1c-400000000003";

type MockScenarioKind = "actuals" | "budget" | "forecast" | "whatif" | "lrp";
type MockScenarioState = "draft" | "review" | "approved" | "locked";

interface MockScenario {
  id: string;
  model_id: string;
  name: string;
  kind: MockScenarioKind;
  state: MockScenarioState;
  parent_scenario_id: string | null;
  baseline: boolean;
  created_at: string;
}

interface MockScenarioVersion {
  id: string;
  scenario_id: string;
  version_no: number;
  label: string;
  reason: string | null;
  created_at: string;
}

const mockScenarios = new Map<string, MockScenario>();
const mockScenarioVersions = new Map<string, MockScenarioVersion[]>();
const mockScenarioAudit: { seq: number; event: string; scenario_id: string }[] = [];
let mockScenarioSeq = 0;
let mockScenarioAuditSeq = 0;

/** Deterministic shape-valid UUID for mock rows (native ids are random UUIDv4 values). */
function mockScenarioUuid(seed: number): string {
  return `5c4f1a2b-9d3e-4c7a-8b2f-${String(seed).padStart(12, "0")}`;
}

/** One `Base` Budget draft per Model (S-050 Empty-state rule); the working Model's Base keeps
 * the pinned WORKING_SCENARIO_ID so every existing store/page test keeps passing. */
function ensureBaseScenario(modelId: string): MockScenario {
  const existing = [...mockScenarios.values()].find((s) => s.model_id === modelId);
  if (existing) return existing;
  const id =
    modelId === WORKING_MODEL_ID_MOCK
      ? WORKING_SCENARIO_ID_MOCK
      : mockScenarioUuid(++mockScenarioSeq);
  const scenario: MockScenario = {
    id,
    model_id: modelId,
    name: "Base",
    kind: "budget",
    state: "draft",
    parent_scenario_id: null,
    baseline: false,
    created_at: new Date().toISOString(),
  };
  mockScenarios.set(id, scenario);
  mockScenarioVersions.set(id, []);
  return scenario;
}
ensureBaseScenario(WORKING_MODEL_ID_MOCK);

/** Dev-only lifecycle audit mirror (`scenario.*` events; SCENARIO-VERSION-SPEC §1 table). */
function recordScenarioAudit(event: string, scenarioId: string): void {
  mockScenarioAudit.push({ seq: ++mockScenarioAuditSeq, event, scenario_id: scenarioId });
}

function scenarioNotFound(scenarioId: string) {
  return mockError(
    "VALUE_INVALID",
    `unknown scenario: ${scenarioId}`,
    "This Scenario does not exist. Refresh the Scenario list.",
    422,
    false,
    { scenario_id: scenarioId },
  );
}

/** SCENARIO_LOCK_CONFLICT (409) — illegal transition or Locked guard (SCREENS-SPEC S-050). */
function scenarioTransitionError(state: MockScenarioState) {
  return mockError(
    "SCENARIO_LOCK_CONFLICT",
    `scenario is ${state}`,
    `This Scenario is already in ${state} — cannot transition.`,
    409,
    false,
    { state },
  );
}

/** AUTH-SPEC §3 gate (mirror): a Locked Scenario never accepts an edit. Synthetic ids that
 * mention "locked" stay gated (legacy dev trigger used by tests without a seeded table). */
function lockedScenarioGate(scenarioId: string) {
  const scenario = mockScenarios.get(scenarioId);
  if (scenario ? scenario.state === "locked" : scenarioId.includes("locked")) {
    return mockError(
      "MODEL_CELL_LOCKED",
      "scenario is locked",
      "This scenario is locked. Create a Version to edit it.",
      422,
    );
  }
  return null;
}

/** Reset the dev scenario tables between independent test cases (re-seeds each Model's Base). */
export function resetMockScenarioState(): void {
  mockScenarios.clear();
  mockScenarioVersions.clear();
  mockScenarioAudit.length = 0;
  mockScenarioSeq = 0;
  mockScenarioAuditSeq = 0;
  ensureBaseScenario(WORKING_MODEL_ID_MOCK);
}

/* ── Driver Tables (B14 shape mirror only · F-013 · M3-3) ── */

/** In-memory `drivers` rows keyed by driver_id. */
const mockDrivers = new Map<string, DriverDef>();
/**
 * Mirror of the native `model_belongs_to_company` gate (`commands/driver.rs`, `assumption.rs`):
 * a model-scoped write against a Model the unlocked Company does not own answers the same
 * `VALUE_INVALID`/403 envelope as `AppError::Scope`. Without this the browser preview accepted
 * any `model_id` and hid a guaranteed native failure (found 2026-09-03, TASKBOARD M3-3).
 * The preview has no session before unlock; then the gate is skipped exactly like the mock's
 * other session mirrors (`session.company_id === null` → not gated).
 */
function modelScopeViolation(modelId: string) {
  if (!session.unlocked || session.company_id === null || session.model_id === null) return null;
  if (modelId === session.model_id) return null;
  return mockError(
    "VALUE_INVALID",
    "model is not owned by the active Company",
    "This operation is not permitted.",
    403,
    false,
    { model_id: modelId, active_model_id: session.model_id },
  );
}
const mockAssumptions = new Map<string, AssumptionListRow>();
const mockAssumptionModels = new Map<string, string>();
/** Dev mirror of the app-scope `settings` table (B18-3): key → JSON string. */
const mockSettings = new Map<string, string>();

/** Reset the dev settings mirror between independent test cases/order-sensitive suites. */
export function resetMockSettingsState(): void {
  mockSettings.clear();
}
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

/** Exact minor-units to decimal string conversion (no .toFixed, no parseFloat, no Math.round — B3). */
function minorToDecimalStr(minor: number): string {
  const neg = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${neg}${major}.${frac}`;
}

/** Exact Decimal to 2-decimal-places string without float conversion (B3/money-ast). */
function formatDecimal(dec: Decimal): string {
  const parts = dec.toString().split(".");
  const intPart = parts[0];
  const fracPart = (parts[1] ?? "").padEnd(2, "0").slice(0, 2);
  return `${intPart}.${fracPart}`;
}

/** Dev-only demo drivers for S-052 sensitivity / goal seek browser preview. */
function ensureDemoDrivers(): void {
  if (!mockDrivers.has("dr-reps")) {
    mockDrivers.set("dr-reps", {
      id: "dr-reps",
      name: "sales_representatives",
      driver_type: "headcount",
      unit: "FTE",
      source: "global",
      is_core: true,
      bounds_low: "10.00",
      bounds_high: "60.00",
    });
  }
  if (!mockDrivers.has("dr-units")) {
    mockDrivers.set("dr-units", {
      id: "dr-units",
      name: "units_sold",
      driver_type: "volume_x_rate",
      unit: "Units",
      source: "global",
      is_core: true,
      bounds_low: "1000.00",
      bounds_high: "50000.00",
    });
  }
  if (!mockDrivers.has("dr-price")) {
    mockDrivers.set("dr-price", {
      id: "dr-price",
      name: "unit_price",
      driver_type: "manual",
      unit: "USD",
      source: "global",
      is_core: true,
      bounds_low: "50.00",
      bounds_high: "300.00",
    });
  }
}

/* ── Variance & Attribution (F-024 · M5-1 · M5-2 · S-054) ───────────────── */

interface MockVarianceReasonAnnotation {
  code: string;
  note: string | null;
}

const mockVarianceReasons = new Map<string, MockVarianceReasonAnnotation>();

/** Reset the mock variance reason codes and commentary between test cases. */
export function resetMockVarianceState(): void {
  mockVarianceReasons.clear();
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

function mockCompanyCurrency(companyId: string | null): string {
  return companies.find((company) => company.id === companyId)?.default_currency_code ?? "USD";
}

function parseCompanyMismatch() {
  return mockError(
    "VALUE_INVALID",
    "PARSE_COMPANY_MISMATCH: re-parse the file in this Company",
    "Invalid arguments.",
    422,
  );
}

/** The preview table (SCREENS-SPEC S-031 shows the first 50 rows). The unbalanced fixture adds
 * one attributable five-cent row; excluding that exact row honestly restores the balanced base. */
function mockPreviewRows(balanced: boolean, currency: string) {
  const rows = [
    {
      line_no: 2,
      period_id: "fp-2026-p08",
      account_id: "3f9f2c9e-9f8b-4e2d-9a1c-200000000001",
      account_code: "4000",
      business_unit_id: null,
      amount_minor: -MOCK_REVENUE_MINOR,
      debit_minor: null,
      credit_minor: MOCK_REVENUE_MINOR,
      currency,
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
      currency,
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
      amount_minor: MOCK_OPEX_MINOR,
      debit_minor: MOCK_OPEX_MINOR,
      credit_minor: null,
      currency,
      posting_ref: "PO-8812",
      doc_type: "PURCHASE",
      is_ic: false,
    },
  ];
  if (!balanced) {
    rows.push({
      line_no: 5,
      period_id: "fp-2026-p08",
      account_id: "3f9f2c9e-9f8b-4e2d-9a1c-200000000004",
      account_code: "5999",
      business_unit_id: null,
      amount_minor: MOCK_IMBALANCE_MINOR,
      debit_minor: MOCK_IMBALANCE_MINOR,
      credit_minor: null,
      currency,
      posting_ref: "ROUNDING-5",
      doc_type: "ADJUSTMENT",
      is_ic: false,
    });
  }
  return rows;
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
            // ERROR-HANDLING §A userMessage (KI-013): "Incorrect PIN." — mirrors core/error.rs.
            userMessage: "Incorrect PIN.",
            httpStatus: 401,
            // ERROR-HANDLING §A: not retryable — the user enters a new PIN (mirrors core/error.rs).
            retryable: false,
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
      const { file_path, kind } = args as { file_path: string; kind: ImportKind };
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
      const rows = balanced ? MOCK_PARSE_ROWS : MOCK_PARSE_ROWS + 1;
      const sourceName = file_path.split(/[\\/]/).pop() || file_path;
      const sourceHash = balanced ? MOCK_SOURCE_HASH : MOCK_UNBALANCED_SOURCE_HASH;
      parses.set(parseId, {
        kind,
        rows,
        balanced,
        validationFindings: file_path.toLowerCase().includes("validation-findings"),
        companyId: session.company_id,
        sourceName,
        sourceHash,
      });
      return {
        data: {
          parse_id: parseId,
          sheets: [
            { name: "GL", kind: "gl", row_count: rows },
            { name: "COA", kind: "coa", row_count: 12 },
          ],
          encodings: [{ scope: "GL", encoding: "utf-8", bom: true, auto_detected: false }],
          row_counts: { GL: rows, COA: 12 },
          source_name: sourceName,
          source_hash: sourceHash,
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
      const mappingVersion = mockMappingVersion(mapping_id);
      if (!mappingVersion) return mappingNotFound(mapping_id);
      const currency = mockCompanyCurrency(parse.companyId);
      const preview = mockPreviewRows(parse.balanced, currency);
      // Opening Balances are once-guarded per Company (GL-TEMPLATE-SPEC §5; the same batch-scope
      // OPENING_ALREADY_SET the Rust core raises once a committed opening batch exists).
      if (parse.kind === "opening_balances") {
        const openingExists = [...importBatches.values()].some(
          (batch) =>
            batch.company_id === parse.companyId &&
            batch.kind === "opening_balances" &&
            batch.status === "committed",
        );
        if (openingExists) {
          return {
            data: {
              hard: [
                {
                  code: "OPENING_ALREADY_SET",
                  message: "OPENING_ALREADY_SET: opening balances already exist for this Company",
                  line_no: null,
                  details: { existingBatches: 1 },
                },
              ],
              warnings: [],
              preview: [],
              rows: 0,
              mapping_version: mappingVersion,
            },
          };
        }
      }
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
      const { parse_id, mapping_id } = args as { parse_id: string; mapping_id: string };
      const parse = parses.get(parse_id);
      if (!parse) return parseExpired();
      if (parse.companyId !== session.company_id) return parseCompanyMismatch();
      if (!mockMappingVersion(mapping_id)) return mappingNotFound(mapping_id);
      if (parse.validationFindings) {
        return mockError(
          "MAP_ACCOUNT_AMBIGUOUS",
          "ACCOUNT_MISSING: '99999' is not in this Company's COA",
          "Account code maps to multiple Accounts (). Confirm the intended Account.",
          422,
        );
      }
      const currency = mockCompanyCurrency(parse.companyId);
      const debits = parse.balanced
        ? MOCK_REVENUE_MINOR
        : MOCK_REVENUE_MINOR + MOCK_IMBALANCE_MINOR;
      return {
        data: {
          debits_minor: debits,
          credits_minor: MOCK_REVENUE_MINOR,
          // Attribution honesty: only the five-cent source row is named (M5).
          diff_rows: parse.balanced
            ? []
            : [
                {
                  line_no: 5,
                  posting_ref: "ROUNDING-5",
                  debit_minor: MOCK_IMBALANCE_MINOR,
                  credit_minor: null,
                  amount_minor: MOCK_IMBALANCE_MINOR,
                  residual_minor: MOCK_IMBALANCE_MINOR,
                },
              ],
          balanced: parse.balanced,
          rows: parse.rows,
          currency,
        },
      };
    }
    case "import.commit": {
      const { parse_id, mapping_id, name, exclusions } = args as {
        parse_id: string;
        mapping_id: string;
        name: string;
        exclusions: { line_no: number; reason: string }[];
      };
      const parse = parses.get(parse_id);
      if (!parse) return parseExpired();
      if (parse.companyId !== session.company_id) return parseCompanyMismatch();
      if (session.read_only) {
        return mockError(
          "AUDIT_CHAIN_BREAK",
          "Import Batch write blocked in degraded session",
          "Audit integrity check failed. Restore from the last verified Snapshot?",
          409,
        );
      }
      // Destination honesty: driver/dimension sources never post to the general ledger, and their
      // destination pipelines do not exist (mirrors the Rust guard in `import.commit`).
      if (!isLedgerImportKind(parse.kind)) {
        return mockError(
          "VALUE_INVALID",
          `IMPORT_KIND_DESTINATION_UNAVAILABLE: '${parse.kind}' does not post to the general ledger and its destination pipeline is not implemented`,
          "Invalid arguments.",
          422,
        );
      }
      if (!name.trim() || [...name.trim()].length > 120) {
        return mockError(
          "VALUE_INVALID",
          !name.trim() ? "BATCH_NAME_REQUIRED" : "BATCH_NAME_TOO_LONG",
          "Invalid arguments.",
          422,
        );
      }
      const mappingVersion = mockMappingVersion(mapping_id);
      if (!mappingVersion) return mappingNotFound(mapping_id);
      if (parse.validationFindings) {
        return mockError(
          "MAP_ACCOUNT_AMBIGUOUS",
          "ACCOUNT_MISSING: '99999' is not in this Company's COA",
          "Account code maps to multiple Accounts (). Confirm the intended Account.",
          422,
        );
      }
      const currency = mockCompanyCurrency(parse.companyId);
      const excluded = new Set(exclusions.map((exclusion) => exclusion.line_no));
      const knownLines = new Set(
        mockPreviewRows(parse.balanced, currency).map((row) => row.line_no),
      );
      if (
        excluded.size !== exclusions.length ||
        exclusions.some(
          (exclusion) =>
            !knownLines.has(exclusion.line_no) ||
            !exclusion.reason.trim() ||
            [...exclusion.reason.trim()].length > 500,
        )
      ) {
        return mockError("VALUE_INVALID", "EXCLUSION_INVALID", "Invalid arguments.", 422);
      }
      const attributableLines = new Set(parse.balanced ? [] : [5]);
      const unattributed = exclusions.find(
        (exclusion) => !attributableLines.has(exclusion.line_no),
      );
      if (unattributed) {
        return mockError(
          "VALUE_INVALID",
          `EXCLUSION_LINE_NOT_ATTRIBUTABLE: row ${unattributed.line_no} was not named by the authoritative Tie-Out`,
          "Invalid arguments.",
          422,
        );
      }
      const exclusionRestoresTie =
        (!parse.balanced && excluded.has(5) && excluded.size === 1) ||
        (parse.balanced && excluded.size === 0);
      if (!exclusionRestoresTie) {
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
            currency,
            diffRows: [
              {
                lineNo: 5,
                postingRef: "ROUNDING-5",
                debitMinor: MOCK_IMBALANCE_MINOR,
                creditMinor: null,
                amountMinor: MOCK_IMBALANCE_MINOR,
                residualMinor: MOCK_IMBALANCE_MINOR,
              },
            ],
          },
        );
      }
      const existing = [...importBatches.values()].find(
        (batch) => batch.company_id === parse.companyId && batch.source_hash === parse.sourceHash,
      );
      if (existing) {
        return mockError(
          "IMPORT_BATCH_HASH_EXISTS",
          `duplicate source hash already belongs to ${existing.batch_id}`,
          `This exact file was already imported (batch ${existing.batch_id}). Re-import? This will create a new batch — confirm: duplicate rows are excluded automatically.`,
          409,
          false,
          { existingBatch: existing.batch_id },
        );
      }
      const batchId = nextImportId("300");
      const timestamp = `2026-09-02T00:00:${String(importSeq % 60).padStart(2, "0")}Z`;
      const batch: MockImportBatch = {
        batch_id: batchId,
        name: name.trim(),
        company_id: parse.companyId ?? "preview-no-company",
        kind: parse.kind,
        source_name: parse.sourceName,
        source_hash: parse.sourceHash,
        mapping_version: mappingVersion,
        status: "committed",
        rows: parse.rows - excluded.size,
        currency,
        debits_minor: MOCK_REVENUE_MINOR,
        credits_minor: MOCK_REVENUE_MINOR,
        tie_out_status: excluded.size > 0 ? "excluded_rows_logged" : "pass",
        rollback_to_batch_id: null,
        committed_at: timestamp,
        created_at: timestamp,
      };
      importBatches.set(batchId, batch);
      return {
        data: {
          batch_id: batchId,
          rows: batch.rows,
          debits_minor: batch.debits_minor,
          credits_minor: batch.credits_minor,
          tie_out_status: batch.tie_out_status,
          audit_id: importSeq,
          excluded_rows: excluded.size,
          source_hash: batch.source_hash,
        },
      };
    }
    case "import.rollback": {
      const { batch_id, reason } = args as { batch_id: string; reason: string };
      if (session.read_only) {
        return mockError(
          "AUDIT_CHAIN_BREAK",
          "Import Batch rollback blocked in degraded session",
          "Audit integrity check failed. Restore from the last verified Snapshot?",
          409,
        );
      }
      if (!reason.trim() || [...reason.trim()].length > 500) {
        return mockError(
          "VALUE_INVALID",
          !reason.trim() ? "ROLLBACK_REASON_REQUIRED" : "ROLLBACK_REASON_TOO_LONG",
          !reason.trim() ? "A reason is required to roll back a batch." : "Invalid arguments.",
          422,
        );
      }
      const batch = importBatches.get(batch_id);
      if (!batch || batch.company_id !== session.company_id) {
        return mockError(
          "VALUE_INVALID",
          `BATCH_NOT_FOUND: ${batch_id}`,
          "Invalid arguments.",
          422,
        );
      }
      if (batch.status === "rolled_back") {
        return mockError(
          "BATCH_ALREADY_ROLLED_BACK",
          "batch already rolled back",
          "This batch was already rolled back.",
          409,
        );
      }
      const previous = [...importBatches.values()]
        .filter(
          (candidate) =>
            candidate.company_id === batch.company_id &&
            candidate.kind === batch.kind &&
            candidate.status === "committed" &&
            candidate.committed_at < batch.committed_at,
        )
        .sort((left, right) => right.committed_at.localeCompare(left.committed_at))[0];
      batch.status = "rolled_back";
      batch.rollback_to_batch_id = previous?.batch_id ?? null;
      return { data: { rolled_back_to: batch.rollback_to_batch_id } };
    }
    case "import.history": {
      const { company_id, page } = args as { company_id: string; page: number };
      if (company_id !== session.company_id) {
        return mockError(
          "VALUE_INVALID",
          "HISTORY_COMPANY_MISMATCH: open the requested Company first",
          "Invalid arguments.",
          422,
        );
      }
      const all = [...importBatches.values()]
        .filter((batch) => batch.company_id === company_id)
        .sort(
          (left, right) =>
            right.committed_at.localeCompare(left.committed_at) ||
            right.batch_id.localeCompare(left.batch_id),
        );
      const pageSize = 25;
      const start = (page - 1) * pageSize;
      const rows = all.slice(start, start + pageSize).map((batch) => ({
        batch_id: batch.batch_id,
        name: batch.name,
        kind: batch.kind,
        source_name: batch.source_name,
        source_hash: batch.source_hash,
        mapping_version: batch.mapping_version,
        status: batch.status,
        rows: batch.rows,
        currency: batch.currency,
        debits_minor: batch.debits_minor,
        credits_minor: batch.credits_minor,
        tie_out_status: batch.tie_out_status,
        rollback_to_batch_id: batch.rollback_to_batch_id,
        committed_at: batch.committed_at,
        created_at: batch.created_at,
      }));
      return {
        data: {
          rows,
          meta: {
            page,
            page_size: pageSize,
            total: all.length,
            total_pages: all.length === 0 ? 0 : Math.ceil(all.length / pageSize),
          },
        },
      };
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
      const lockedGate = lockedScenarioGate(scenario_id);
      if (lockedGate) return lockedGate;
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
    case "model.diff": {
      const { scenario_a, scenario_b } = args as {
        scenario_a: string;
        scenario_b: string;
        version_a?: string | null;
        version_b?: string | null;
      };
      // Both scenarios must exist and belong to the same model.
      const scenA = mockScenarios.get(scenario_a);
      const scenB = mockScenarios.get(scenario_b);
      if (!scenA || !scenB) {
        return mockError(
          "VALUE_INVALID",
          "scenario not found",
          "One or both Scenarios do not exist.",
          422,
        );
      }
      if (scenA.model_id !== scenB.model_id) {
        return mockError(
          "COMPARE_INCOMPATIBLE",
          "cannot compare: models or COAs differ",
          "Cannot compare: Models/COAs differ. Select two Scenarios of the same Model.",
          422,
        );
      }
      // Generate deterministic diff rows from mocked model cells.
      const mockLines = [
        { id: "ln-rev", sheet_id: "sh-rev", sheet_name: "Revenue", account_id: "00000000-0000-4000-8000-000000000001", driver_id: null },
        { id: "ln-cogs", sheet_id: "sh-cogs", sheet_name: "Cost of Goods Sold", account_id: "00000000-0000-4000-8000-000000000003", driver_id: null },
        { id: "ln-opex", sheet_id: "sh-opex", sheet_name: "Operating Expenses", account_id: null, driver_id: null },
      ];
      const mockPeriods = ["fp-2027-p01", "fp-2027-p02", "fp-2027-p03"];
      const diffRows: unknown[] = [];
      for (const line of mockLines) {
        for (const pid of mockPeriods) {
          const keyA = `${scenario_a}:${line.id}:${pid}`;
          const keyB = `${scenario_b}:${line.id}:${pid}`;
          const cellA = modelCells.get(keyA);
          const cellB = modelCells.get(keyB);
          const minorA = cellA?.valueMinor ?? null;
          const minorB = cellB?.valueMinor ?? null;
          const deltaMinor = (minorB ?? 0) - (minorA ?? 0);
          const deltaPct = minorA != null && minorA !== 0 ? deltaMinor / Math.abs(minorA) : null;
          const isChanged = minorA !== minorB || cellA?.value !== cellB?.value || cellA?.formula !== cellB?.formula;
          diffRows.push({
            line_id: line.id,
            sheet_id: line.sheet_id,
            sheet_name: line.sheet_name,
            line_name: line.id,
            account_id: line.account_id,
            driver_id: line.driver_id,
            driver_name: null,
            period_id: pid,
            period_label: pid,
            value_a: cellA?.value ?? null,
            value_a_minor: minorA,
            formula_a: cellA?.formula ?? null,
            value_b: cellB?.value ?? null,
            value_b_minor: minorB,
            formula_b: cellB?.formula ?? null,
            delta_minor: deltaMinor,
            delta_text: String(deltaMinor),
            delta_pct: deltaPct,
            is_changed: isChanged,
          });
        }
      }
      return { data: { diff_rows: diffRows } };
    }
    /* ── plan.whatif_overlay, plan.sensitivity, plan.goal_seek (F-022 · M4-4 · S-052) ─── */
    case "plan.whatif_overlay": {
      const { scenario_ids, period_scope } = args as {
        scenario_ids: string[];
        period_scope: string;
        kpis?: string[];
      };

      if (
        period_scope.includes("incompat") ||
        scenario_ids.some((id) => id.includes("incompat"))
      ) {
        return mockError(
          "COMPARE_INCOMPATIBLE",
          "cannot compare: models or COAs differ",
          "Cannot compare: Models/COAs differ. Select two Scenarios of the same Model.",
          422,
        );
      }

      const knownScenarios = scenario_ids.map((id) => mockScenarios.get(id)).filter(Boolean);
      if (knownScenarios.length > 1) {
        const firstModelId = knownScenarios[0]!.model_id;
        if (knownScenarios.some((s) => s!.model_id !== firstModelId)) {
          return mockError(
            "COMPARE_INCOMPATIBLE",
            "cannot compare: models or COAs differ",
            "Cannot compare: Models/COAs differ. Select two Scenarios of the same Model.",
            422,
          );
        }
      }

      if (period_scope.toLowerCase() === "empty" || scenario_ids.length === 0) {
        return { data: { series: [], waterfall: [] } };
      }

      const periods = [
        { id: "fp-2027-p01", label: "P01 Jan" },
        { id: "fp-2027-p02", label: "P02 Feb" },
        { id: "fp-2027-p03", label: "P03 Mar" },
        { id: "fp-2027-p04", label: "P04 Apr" },
        { id: "fp-2027-p05", label: "P05 May" },
        { id: "fp-2027-p06", label: "P06 Jun" },
      ];

      const palette = ["#2563eb", "#10b981", "#f59e0b"];

      const series: WhatifSeries[] = scenario_ids.map((scenId, idx) => {
        const scen = mockScenarios.get(scenId);
        const versions = mockScenarioVersions.get(scenId) ?? [];
        const latestVer = versions.length > 0 ? versions[versions.length - 1].label : null;
        const name =
          scen?.name ?? (idx === 0 ? "Base Budget" : idx === 1 ? "Stretch What-If" : "Downside");

        const multiplierNumerator = idx === 0 ? 100 : idx === 1 ? 115 : 90;

        const points = periods.map((p, pIdx) => {
          const cellKey = `${scenId}:ln-rev:${p.id}`;
          const cell = modelCells.get(cellKey);
          let valueMinor: number;
          if (cell?.valueMinor != null) {
            valueMinor = cell.valueMinor;
          } else {
            const baseMonthly = 125_000_000 + pIdx * 2_500_000;
            valueMinor = Math.floor((baseMonthly * multiplierNumerator) / 100);
          }
          return {
            period_id: p.id,
            period_label: p.label,
            value: minorToDecimalStr(valueMinor),
            value_minor: valueMinor,
          };
        });

        return {
          scenario_id: scenId,
          scenario_name: name,
          version_label: latestVer,
          color: palette[idx % palette.length],
          points,
        };
      });

      const waterfall: WaterfallStep[] = [
        {
          step_id: "wf-1",
          label: "Baseline Revenue",
          delta_text: "0.00",
          delta_minor: 0,
          cumulative_text: "7875000.00",
          cumulative_minor: 787_500_000,
          kind: "baseline",
          driver_id: null,
        },
        {
          step_id: "wf-2",
          label: "Sales Capacity (Headcount +4)",
          delta_text: "600000.00",
          delta_minor: 60_000_000,
          cumulative_text: "8475000.00",
          cumulative_minor: 847_500_000,
          kind: "driver",
          driver_id: "dr-reps",
        },
        {
          step_id: "wf-3",
          label: "Price Realization (+3.5%)",
          delta_text: "275000.00",
          delta_minor: 27_500_000,
          cumulative_text: "8750000.00",
          cumulative_minor: 875_000_000,
          kind: "driver",
          driver_id: "dr-price",
        },
        {
          step_id: "wf-4",
          label: "Volume Expansion (+5.0%)",
          delta_text: "390000.00",
          delta_minor: 39_000_000,
          cumulative_text: "9140000.00",
          cumulative_minor: 914_000_000,
          kind: "driver",
          driver_id: "dr-units",
        },
        {
          step_id: "wf-5",
          label: "Customer Churn Mitigation",
          delta_text: "-120000.00",
          delta_minor: -12_000_000,
          cumulative_text: "9020000.00",
          cumulative_minor: 902_000_000,
          kind: "driver",
          driver_id: "dr-churn",
        },
        {
          step_id: "wf-6",
          label: "Manual Adjustments (Unallocated)",
          delta_text: "80000.00",
          delta_minor: 8_000_000,
          cumulative_text: "9100000.00",
          cumulative_minor: 910_000_000,
          kind: "other_manual",
          driver_id: null,
        },
        {
          step_id: "wf-7",
          label: "What-If Scenario Total",
          delta_text: "1225000.00",
          delta_minor: 122_500_000,
          cumulative_text: "9100000.00",
          cumulative_minor: 910_000_000,
          kind: "total",
          driver_id: null,
        },
      ];

      return { data: { series, waterfall } };
    }
    case "plan.sensitivity": {
      const { driver_id, lo, hi, steps, target_lines } = args as {
        driver_id: string;
        lo: string;
        hi: string;
        steps: number;
        target_lines: string[];
      };
      ensureDemoDrivers();

      if (
        driver_id.includes("outofbounds") ||
        lo === "-999" ||
        hi === "999999" ||
        decimalCmp(lo, hi) > 0
      ) {
        return mockError(
          "SENSITIVITY_OUT_OF_BOUNDS",
          "sensitivity range exceeds assumption bounds",
          "Sensitivity range exceeds the Assumption bounds. Adjust bounds or range.",
          422,
          false,
          {},
        );
      }

      const def = mockDrivers.get(driver_id);
      if (def) {
        if (def.bounds_low != null && decimalCmp(lo, def.bounds_low) < 0) {
          return mockError(
            "SENSITIVITY_OUT_OF_BOUNDS",
            `range lo ${lo} below bounds ${def.bounds_low}`,
            "Sensitivity range exceeds the Assumption bounds. Adjust bounds or range.",
            422,
            false,
            {},
          );
        }
        if (def.bounds_high != null && decimalCmp(hi, def.bounds_high) > 0) {
          return mockError(
            "SENSITIVITY_OUT_OF_BOUNDS",
            `range hi ${hi} above bounds ${def.bounds_high}`,
            "Sensitivity range exceeds the Assumption bounds. Adjust bounds or range.",
            422,
            false,
            {},
          );
        }
      } else if (driver_id.includes("broken")) {
        return mockError(
          "REFERENCE_BROKEN",
          "unknown driver",
          "This driver does not exist. Create it first.",
          422,
        );
      }

      if (driver_id.toLowerCase() === "empty" || target_lines.length === 0) {
        return { data: { tornado: [], values: [] } };
      }

      const activeLines =
        target_lines.length > 0 ? target_lines : ["ln-rev", "ln-gp", "ln-ebitda", "ln-cogs"];

      const lineMeta: Record<string, { name: string; baseMinor: number; swingPct: number }> = {
        "ln-rev": { name: "Revenue", baseMinor: 15_000_000_00, swingPct: 25 },
        "ln-gp": { name: "Gross Profit", baseMinor: 10_500_000_00, swingPct: 20 },
        "ln-ebitda": { name: "EBITDA", baseMinor: 3_200_000_00, swingPct: 35 },
        "ln-cogs": { name: "Cost of Goods Sold", baseMinor: 4_500_000_00, swingPct: 15 },
        "ln-opex": { name: "Operating Expenses", baseMinor: 7_300_000_00, swingPct: 10 },
      };

      const tornado: TornadoBar[] = activeLines
        .map((lineId) => {
          const meta = lineMeta[lineId] ?? {
            name: lineId.toUpperCase(),
            baseMinor: 5_000_000_00,
            swingPct: 20,
          };
          const baseMinor = meta.baseMinor;
          const swingDelta = Math.floor((baseMinor * meta.swingPct) / 100);
          const lowMinor = baseMinor - swingDelta;
          const highMinor = baseMinor + swingDelta;
          const swingMinor = highMinor - lowMinor;
          return {
            target_line_id: lineId,
            target_line_name: meta.name,
            base_value: minorToDecimalStr(baseMinor),
            base_minor: baseMinor,
            low_value: minorToDecimalStr(lowMinor),
            low_minor: lowMinor,
            high_value: minorToDecimalStr(highMinor),
            high_minor: highMinor,
            swing_minor: swingMinor,
            swing_text: minorToDecimalStr(swingMinor),
          };
        })
        .sort((a, b) => b.swing_minor - a.swing_minor);

      const values: SensitivityValueStep[] = [];
      const loDec = new Decimal(lo);
      const hiDec = new Decimal(hi);
      const stepCount = Math.max(2, steps);

      for (let i = 0; i < stepCount; i += 1) {
        const fraction = new Decimal(i).dividedBy(stepCount - 1);
        const valDec = loDec.plus(hiDec.minus(loDec).times(fraction));
        const targetImpacts: Record<string, string> = {};

        for (const t of tornado) {
          const impactMinor =
            t.low_minor + Math.floor(((t.high_minor - t.low_minor) * i) / (stepCount - 1));
          targetImpacts[t.target_line_id] = minorToDecimalStr(impactMinor);
        }

        values.push({
          driver_value: formatDecimal(valDec),
          step_index: i,
          target_impacts: targetImpacts,
        });
      }

      return { data: { tornado, values } };
    }
    case "plan.goal_seek": {
      const { target_cell, target_value, driver_id, bounds } = args as {
        target_cell: string;
        target_value: string;
        driver_id: string;
        bounds: [string, string];
      };
      ensureDemoDrivers();
      const [bLo, bHi] = bounds;

      if (driver_id.includes("outofbounds") || bLo === "-999" || decimalCmp(bLo, bHi) > 0) {
        return mockError(
          "SENSITIVITY_OUT_OF_BOUNDS",
          "goal seek bounds exceed assumption bounds",
          "Sensitivity range exceeds the Assumption bounds. Adjust bounds or range.",
          422,
          false,
          {},
        );
      }

      const def = mockDrivers.get(driver_id);
      if (def) {
        if (def.bounds_low != null && decimalCmp(bLo, def.bounds_low) < 0) {
          return mockError(
            "SENSITIVITY_OUT_OF_BOUNDS",
            `bounds lo ${bLo} below registered bounds ${def.bounds_low}`,
            "Sensitivity range exceeds the Assumption bounds. Adjust bounds or range.",
            422,
            false,
            {},
          );
        }
        if (def.bounds_high != null && decimalCmp(bHi, def.bounds_high) > 0) {
          return mockError(
            "SENSITIVITY_OUT_OF_BOUNDS",
            `bounds hi ${bHi} above registered bounds ${def.bounds_high}`,
            "Sensitivity range exceeds the Assumption bounds. Adjust bounds or range.",
            422,
            false,
            {},
          );
        }
      }

      if (
        driver_id.includes("noconverge") ||
        target_cell.includes("noconverge") ||
        target_value.includes("999999")
      ) {
        const lastValue = "285.4";
        return mockError(
          "GOAL_SEEK_NO_CONVERGE",
          `goal seek did not converge in 100 iterations: last value ${lastValue}, target ${target_value}`,
          `Goal Seek did not converge in 100 iterations. Last value ${lastValue}, target ${target_value}. Adjust bounds.`,
          422,
          false,
          { last_value: lastValue, target: target_value, iterations: 100 },
        );
      }

      if (target_cell.toLowerCase() === "empty" || driver_id.toLowerCase() === "empty") {
        return {
          data: {
            driver_value: "0.00",
            iterations: 0,
            converged: false,
            last_target_value: "0.00",
          },
        };
      }

      const bLoDec = new Decimal(bLo);
      const bHiDec = new Decimal(bHi);
      const span = bHiDec.minus(bLoDec);
      const solvedDec = bLoDec.plus(span.times(new Decimal("0.64")));

      return {
        data: {
          driver_value: formatDecimal(solvedDec),
          iterations: 14,
          converged: true,
          last_target_value: target_value,
        },
      };
    }
    case "driver.upsert": {
      const { model_id, driver } = args as {
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
      // Native order: session gate → `model_belongs_to_company` → body validation.
      const scope = modelScopeViolation(model_id);
      if (scope) return scope;
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
      // Same Locked-Scenario gate as `model.cell.set.v1` (driver values are scenario-scoped).
      const driverLockedGate = lockedScenarioGate(scenario_id);
      if (driverLockedGate) return driverLockedGate;
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
    case "model.schedule.upsert": {
      const { model_id, schedule_type, rows } = args as {
        model_id: string;
        schedule_type: "headcount";
        rows: HeadcountPlanRow[];
      };
      const scopeErr = modelScopeViolation(model_id);
      if (scopeErr) return scopeErr;
      if (session.read_only) {
        return mockError(
          "AUDIT_CHAIN_BREAK",
          "headcount schedule write blocked in degraded session",
          "Audit integrity check failed. Restore from the last verified Snapshot?",
          409,
        );
      }
      if (schedule_type !== "headcount") {
        return mockError(
          "VALUE_INVALID",
          `unsupported schedule type: ${schedule_type}`,
          "This schedule type is not available in the preview.",
          422,
        );
      }
      const issue = validateHeadcountRows(rows);
      if (issue) {
        return mockError(
          issue.code,
          `${issue.code}: schedule validation failed`,
          issue.userMessage,
          422,
          false,
          issue.details,
        );
      }
      const previous = mockHeadcountSchedules.get(model_id);
      const schedule_id = previous?.schedule_id ?? nextImportId("600");
      mockHeadcountSchedules.set(model_id, {
        schedule_id,
        rows: rows.map((row) => ({ ...row })),
      });
      mockScheduleAuditSeq += 1;
      return {
        data: {
          schedule_id,
          recalc: {
            dirty_cells: rows.length,
            cycles: [],
            changed_cells: rows.map((row, index) => row.id ?? `hc-row-${index + 1}`).sort(),
            issues: [],
            duration_ms: 0,
          },
          audit_id: mockScheduleAuditSeq,
        },
      };
    }
    case "model.list": {
      // API-SPEC §3 `model.list {company_id} → Model[]` — read side for S-050 / the scenario
      // picker. Model shape decision recorded in TASKBOARD §11 (spec leaves it unpinned).
      const { company_id } = args as { company_id: string };
      const modelId = mockCompanyModels.get(company_id) ?? company_id;
      ensureBaseScenario(modelId);
      return {
        data: [
          {
            id: modelId,
            company_id,
            name: "Working Model",
            horizon: 1,
            pack_id: null,
            scenarios: [...mockScenarios.values()]
              .filter((s) => s.model_id === modelId)
              .map((s) => ({
                ...s,
                versions: (mockScenarioVersions.get(s.id) ?? []).map((v) => ({ ...v })),
              })),
          },
        ],
      };
    }
    case "scenario.create":
    case "scenario.duplicate": {
      const { model_id, name, base_id } = args as {
        model_id: string;
        name?: string;
        base_id?: string;
      };
      const scopeErr = modelScopeViolation(model_id);
      if (scopeErr) return scopeErr;
      ensureBaseScenario(model_id);
      const base = base_id ? mockScenarios.get(base_id) : undefined;
      if (base_id && !base) return scenarioNotFound(base_id);
      // Kind is inherited from the Base when one is given, else `budget` (the contract args
      // carry no `kind`; TASKBOARD M4-2 records the Tier-3 question for forecast/what-if kinds).
      const kind: MockScenarioKind = base?.kind ?? "budget";
      let finalName = name ?? (base ? `${base.name} (copy)` : "Base");
      if (!name && base) {
        // Derived duplicate names never collide: "Base (copy)", "Base (copy 2)", …
        let n = 1;
        const taken = new Set([...mockScenarios.values()].map((s) => `${s.model_id}:${s.name}`));
        while (taken.has(`${model_id}:${finalName}`)) finalName = `${base.name} (copy ${++n})`;
      } else if (
        [...mockScenarios.values()].some((s) => s.model_id === model_id && s.name === finalName)
      ) {
        return mockError(
          "SCENARIO_NAME_DUP",
          `duplicate scenario name: ${finalName}`,
          "A Scenario with this name already exists.",
          409,
          false,
          { model_id, name: finalName },
        );
      }
      const id = mockScenarioUuid(++mockScenarioSeq);
      const scenario: MockScenario = {
        id,
        model_id,
        name: finalName,
        kind,
        state: "draft",
        parent_scenario_id: base?.id ?? null,
        baseline: false,
        created_at: new Date().toISOString(),
      };
      mockScenarios.set(id, scenario);
      mockScenarioVersions.set(id, []);
      // Duplicate copies the source's cell + driver values (scenario-scoped plan copy).
      if (base) {
        const prefix = `${base.id}:`;
        for (const [key, cell] of modelCells) {
          if (key.startsWith(prefix))
            modelCells.set(`${id}:${key.slice(prefix.length)}`, { ...cell });
        }
        for (const [key, value] of mockDriverValues) {
          const [, scenarioOfValue, rest] = key.split(":");
          if (scenarioOfValue === base.id) {
            mockDriverValues.set(`${key.split(":")[0]}:${id}:${rest}`, value);
          }
        }
      }
      recordScenarioAudit(
        command === "scenario.create" ? "scenario.create" : "scenario.duplicate",
        id,
      );
      return { data: { scenario_id: id, version_id: null } };
    }
    case "scenario.submit":
    case "scenario.approve":
    case "scenario.lock":
    case "scenario.reopen":
    case "scenario.delete": {
      const { scenario_id, reason } = args as { scenario_id: string; reason?: string };
      const scenario = mockScenarios.get(scenario_id);
      if (!scenario) return scenarioNotFound(scenario_id);
      const versions = mockScenarioVersions.get(scenario_id) ?? [];
      const requireReason = () => {
        if (reason && reason.trim().length > 0) return null;
        return mockError(
          "VALUE_INVALID",
          "reopen requires a written reason",
          "A written reason is required to reopen a Scenario.",
          422,
          false,
          { reason_required: true },
        );
      };
      switch (command) {
        case "scenario.submit": {
          if (scenario.state !== "draft") return scenarioTransitionError(scenario.state);
          scenario.state = "review";
          recordScenarioAudit("scenario.submit", scenario_id);
          break;
        }
        case "scenario.approve": {
          if (scenario.state !== "review") return scenarioTransitionError(scenario.state);
          scenario.state = "approved";
          recordScenarioAudit("scenario.approve", scenario_id);
          break;
        }
        case "scenario.lock": {
          if (scenario.state !== "approved") return scenarioTransitionError(scenario.state);
          scenario.state = "locked";
          // SCENARIO-VERSION-SPEC §2: lock auto-writes the next immutable Version (v1, v2, …).
          const versionNo = versions.length + 1;
          const version: MockScenarioVersion = {
            id: mockScenarioUuid(10_000 + ++mockScenarioSeq),
            scenario_id,
            version_no: versionNo,
            label: `v${versionNo}`,
            reason: null,
            created_at: new Date().toISOString(),
          };
          versions.push(version);
          mockScenarioVersions.set(scenario_id, versions);
          recordScenarioAudit("scenario.lock", scenario_id);
          return { data: { scenario_id, version_id: version.id } };
        }
        case "scenario.reopen": {
          if (scenario.state === "draft") return scenarioTransitionError(scenario.state);
          const reasonErr = requireReason();
          if (reasonErr) return reasonErr;
          // Locked → Draft only while it is not THE Baseline (SPEC §1 invariant).
          if (scenario.state === "locked" && scenario.baseline) {
            return scenarioTransitionError(scenario.state);
          }
          scenario.state = "draft";
          recordScenarioAudit("scenario.reopen", scenario_id);
          break;
        }
        case "scenario.delete": {
          if (scenario.state !== "draft") return scenarioTransitionError(scenario.state);
          if (versions.length > 0) return scenarioTransitionError(scenario.state);
          mockScenarios.delete(scenario_id);
          mockScenarioVersions.delete(scenario_id);
          recordScenarioAudit("scenario.delete", scenario_id);
          return { data: { scenario_id, version_id: null } };
        }
      }
      return { data: { scenario_id, version_id: null } };
    }
    case "baseline.set": {
      const { scenario_id, reason } = args as { scenario_id: string; reason?: string };
      const scenario = mockScenarios.get(scenario_id);
      if (!scenario) return scenarioNotFound(scenario_id);
      // SPEC §3: a Baseline MUST be Locked (it points at a Version snapshot).
      if (scenario.state !== "locked") return scenarioTransitionError(scenario.state);
      const current = [...mockScenarios.values()].find((s) => s.baseline && s.id !== scenario_id);
      if (current && (!reason || reason.trim().length === 0)) {
        return mockError(
          "BASELINE_REPLACE_REASON_REQUIRED",
          "baseline replacement without reason",
          "Replacing the baseline requires a written reason.",
          422,
          false,
          { current_baseline_scenario_id: current.id },
        );
      }
      for (const s of mockScenarios.values()) s.baseline = false;
      scenario.baseline = true;
      recordScenarioAudit("baseline.set", scenario_id);
      const versions = mockScenarioVersions.get(scenario_id) ?? [];
      const latest = versions[versions.length - 1];
      return { data: { baseline_version_id: latest?.id ?? scenario_id } };
    }
    case "assumption.list": {
      const { model_id } = args as { model_id: string };
      // Native: `assumption.list` checks `model_belongs_to_company` before reading.
      const listScope = modelScopeViolation(model_id);
      if (listScope) return listScope;
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
      // Native: `assumption.upsert` checks `model_belongs_to_company` first (assumption.rs).
      const upsertScope = modelScopeViolation(model_id);
      if (upsertScope) return upsertScope;
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
    /* ── App settings (F-038 · API-SPEC §2 `settings.get`/`settings.set`) ──────────
     * The app DB `settings` table is app-scope; the mock mirror keeps the same
     * session gate so the dev preview exercises the real IPC shape (B18-3). */
    case "settings.get": {
      const { key } = args as { key: string };
      if (!session.unlocked) {
        // ERROR-HANDLING §A: SESSION_LOCKED is 401 / not retryable (unlock first).
        return mockError(
          "SESSION_LOCKED",
          "session locked",
          "Session locked. Unlock to continue.",
          401,
        );
      }
      return { data: { value: mockSettings.get(key) ?? null } };
    }
    case "settings.set": {
      const { key, value_json } = args as { key: string; value_json: string };
      if (!session.unlocked) {
        return mockError(
          "SESSION_LOCKED",
          "session locked",
          "Session locked. Unlock to continue.",
          401,
        );
      }
      if (session.read_only) {
        return mockError(
          "AUDIT_CHAIN_BREAK",
          "settings.set on a read-only Company",
          "Audit integrity check failed. Restore from the last verified Snapshot?",
          409,
          false,
        );
      }
      try {
        JSON.parse(value_json);
      } catch {
        return mockError(
          "SETTINGS_SAVE_FAILED",
          "settings value is not valid JSON",
          "Settings could not be saved. Retry.",
          500,
          true,
        );
      }
      mockSettings.set(key, value_json);
      return { data: { ok: true } };
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
    /* ── Planning Cycle & Input Collection (M4-5 · M4-6 · S-053) ─────── */
    case "cycle.start": {
      const { name, kind } = args as {
        model_id: string;
        kind: "budget" | "forecast" | "rolling";
        name: string;
        due: string;
      };
      if (name.includes("Duplicate") || name.includes("dup")) {
        return mockError(
          "CYCLE_NAME_DUP",
          "cycle name already exists",
          "A planning cycle with this name already exists.",
          409,
        );
      }
      const cycleId = `pc-${Date.now()}`;
      return { data: { cycle_id: cycleId, name, kind } };
    }
    case "cycle.task.update": {
      const { task_id, status } = args as {
        task_id: string;
        status: "pending" | "done" | "blocked";
        note?: string;
      };
      if (task_id.includes("blocked") || (task_id === "ct-3" && status === "done")) {
        return mockError(
          "CYCLE_TASK_BLOCKED",
          "task is blocked by unfinished predecessor",
          "This task is blocked by unfinished tasks: Run GL tie-out and reconcile accounts.",
          409,
          false,
          { list: "Run GL tie-out and reconcile accounts" },
        );
      }
      return { data: { updated: true } };
    }
    case "cycle.checklist.status": {
      return {
        data: {
          cycle_id: "pc-fy27-budget",
          ready: false,
          tasks: [
            {
              id: "ct-1",
              cycle_id: "pc-fy27-budget",
              title: "Import all BU actuals",
              owner: "FinOps",
              depends_on_id: null,
              due_date: "2026-09-05",
              status: "done",
              sort_order: 1,
            },
            {
              id: "ct-2",
              cycle_id: "pc-fy27-budget",
              title: "Run GL tie-out and reconcile accounts",
              owner: "Accounting",
              depends_on_id: "ct-1",
              due_date: "2026-09-08",
              status: "pending",
              sort_order: 2,
            },
            {
              id: "ct-3",
              cycle_id: "pc-fy27-budget",
              title: "Execute Health Check and review integrity rules",
              owner: "FP&A Lead",
              depends_on_id: "ct-2",
              due_date: "2026-09-10",
              status: "pending",
              sort_order: 3,
            },
            {
              id: "ct-4",
              cycle_id: "pc-fy27-budget",
              title: "Approve variance commentary and lock cycle",
              owner: "VP Finance",
              depends_on_id: "ct-3",
              due_date: "2026-09-12",
              status: "pending",
              sort_order: 4,
            },
          ],
        },
      };
    }
    case "collection.export": {
      const { cycle_id, template } = args as {
        cycle_id: string;
        driver_ids: string[];
        template: string;
      };
      if (template === "invalid_template") {
        return mockError(
          "COLLECTION_STRUCTURE_CHANGED",
          "template structure mismatch",
          "The returned sheet differs from the exported template (rows/columns changed). Review the diff before merging.",
          422,
        );
      }
      return { data: { file: `driver_collection_${cycle_id}.csv`, rows: 48 } };
    }
    case "collection.import": {
      const { file_path } = args as { cycle_id: string; file_path: string; mapping_id: string };
      if (file_path.includes("corrupt") || file_path.includes("structure_drift")) {
        return mockError(
          "COLLECTION_STRUCTURE_CHANGED",
          "sheet headers and columns do not match template",
          "The returned sheet differs from the exported template (rows/columns changed). Review the diff before merging.",
          422,
        );
      }
      if (file_path.includes("conflict")) {
        return {
          data: {
            batch_id: "cb-8821",
            conflicts: [
              {
                id: "conf-1",
                upload_id: "cu-1",
                driver_id: "dr-sales-volume",
                driver_name: "Sales Volume (Units)",
                period_id: "fp-2027-p08",
                contributor_a: "Sales Director",
                value_a: "11000",
                contributor_b: "Operations Lead",
                value_b: "12500",
                resolved: false,
                resolution_choice: null,
                resolved_value: null,
              },
            ],
          },
        };
      }
      return {
        data: {
          batch_id: "cb-8822",
          conflicts: [],
        },
      };
    }
    case "collection.resolve_conflict": {
      return { data: { resolved: true } };
    }
    /* ── Variance & Attribution (F-024 · M5-1 · M5-2 · S-054) ───────── */
    case "variance.get": {
      const { period_id, compare, attribution } = args as {
        company_id: string;
        period_id: string;
        compare: string;
        attribution?: boolean;
      };

      // Dev trigger: mixed periods/sources test
      if (period_id.includes("mixed") || compare.includes("mixed")) {
        return mockError(
          "VARIANCE_SOURCE_MIXED",
          "selected periods mix actual and forecast",
          "Selected periods mix Actual and Forecast — enable HYBRID label to view.",
          422,
          false,
        );
      }

      // Dev trigger: attribution unavailable test
      if (period_id.includes("no_attr") || compare.includes("no_attr")) {
        return mockError(
          "VARIANCE_NO_ATTRIBUTION_DATA",
          "attribution unavailable for these lines",
          "Attribution unavailable for these lines — no unit/driver data. Show $ variance only.",
          200,
          false,
        );
      }

      // 3-way dataset: Revenue (nature: revenue) and COGS (nature: expense/cogs)
      // Line 1: Revenue - actuals: $1,825,000.00 (182,500,000 minor)
      //                  budget/commit: $1,800,000.00 (180,000,000 minor)
      //                  plan: $1,750,000.00 (175,000,000 minor)
      // Line 2: Cost of Goods Sold - actuals: $960,000.00 (96,000,000 minor)
      //                              budget/commit: $900,000.00 (90,000,000 minor)
      //                              plan: $880,000.00 (88,000,000 minor)
      interface MockLineFact {
        line_id: string;
        line_name: string;
        account_code: string;
        is_revenue: boolean;
        actual_minor: number;
        plan_minor: number;
        commit_minor: number;
        // attribution breakdown items
        attr?: {
          driver_id: string;
          driver_name: string;
          volume_minor: number;
          price_minor: number;
          mix_minor: number;
          fx_minor: number;
          efficiency_minor: number;
          unattributable?: boolean;
        };
      }

      const mockLines: MockLineFact[] = [
        {
          line_id: "ln-rev-product",
          line_name: "Product Revenue",
          account_code: "4000",
          is_revenue: true,
          actual_minor: 182_500_000,
          plan_minor: 175_000_000,
          commit_minor: 180_000_000,
          attr: {
            driver_id: "dr-sales-vol",
            driver_name: "Sales Volume & Price",
            volume_minor: 15_000_000,
            price_minor: 12_000_000,
            mix_minor: -1_500_000,
            fx_minor: -500_000,
            efficiency_minor: 0,
            unattributable: false,
          },
        },
        {
          line_id: "ln-cogs-materials",
          line_name: "Direct Materials COGS",
          account_code: "5000",
          is_revenue: false,
          actual_minor: 96_000_000,
          plan_minor: 88_000_000,
          commit_minor: 90_000_000,
          attr: {
            driver_id: "dr-prod-eff",
            driver_name: "Production Efficiency & Materials",
            volume_minor: 3_000_000,
            price_minor: 2_000_000,
            mix_minor: 500_000,
            fx_minor: 0,
            efficiency_minor: 500_000,
            unattributable: false,
          },
        },
      ];

      const rows: VarianceRow[] = mockLines.map((l) => {
        const compareMinor = compare === "plan" ? l.plan_minor : l.commit_minor;
        const deltaMinor = l.actual_minor - compareMinor;
        const actualText = minorToDecimalStr(l.actual_minor);
        const compareText = minorToDecimalStr(compareMinor);
        const deltaText = minorToDecimalStr(deltaMinor);

        let deltaPct: number | null = null;
        if (compareMinor !== 0) {
          const pctDec = new Decimal(deltaMinor)
            .div(compareMinor)
            .mul(100)
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
          deltaPct = pctDec.toNumber();
        }

        let direction: "favorable" | "unfavorable" | "neutral" = "neutral";
        if (deltaMinor !== 0) {
          if (l.is_revenue) {
            direction = deltaMinor > 0 ? "favorable" : "unfavorable";
          } else {
            direction = deltaMinor < 0 ? "favorable" : "unfavorable";
          }
        }

        const reasonKey = `${l.line_id}:${period_id}`;
        const savedReason = mockVarianceReasons.get(reasonKey);

        return {
          line_id: l.line_id,
          line_name: l.line_name,
          account_code: l.account_code,
          actual_minor: l.actual_minor,
          actual_text: actualText,
          compare_minor: compareMinor,
          compare_text: compareText,
          delta_minor: deltaMinor,
          delta_text: deltaText,
          delta_pct: deltaPct,
          direction,
          reason_code: savedReason ? savedReason.code : null,
          note: savedReason ? savedReason.note : null,
        };
      });

      const attributionItems: VarianceAttributionItem[] = [];
      if (attribution !== false) {
        for (const l of mockLines) {
          if (l.attr) {
            const totMinor =
              l.attr.volume_minor +
              l.attr.price_minor +
              l.attr.mix_minor +
              l.attr.fx_minor +
              l.attr.efficiency_minor;
            attributionItems.push({
              line_id: l.line_id,
              driver_id: l.attr.driver_id,
              driver_name: l.attr.driver_name,
              volume_minor: l.attr.volume_minor,
              volume_text: minorToDecimalStr(l.attr.volume_minor),
              price_minor: l.attr.price_minor,
              price_text: minorToDecimalStr(l.attr.price_minor),
              mix_minor: l.attr.mix_minor,
              mix_text: minorToDecimalStr(l.attr.mix_minor),
              fx_minor: l.attr.fx_minor,
              fx_text: minorToDecimalStr(l.attr.fx_minor),
              efficiency_minor: l.attr.efficiency_minor,
              efficiency_text: minorToDecimalStr(l.attr.efficiency_minor),
              total_attributed_minor: totMinor,
              total_attributed_text: minorToDecimalStr(totMinor),
              unattributable: l.attr.unattributable ?? false,
            });
          }
        }
      }

      const threewayItems: VarianceThreewayItem[] = mockLines.map((l) => {
        const planDeltaMinor = l.actual_minor - l.plan_minor;
        const commitDeltaMinor = l.actual_minor - l.commit_minor;

        let planDir: "favorable" | "unfavorable" | "neutral" = "neutral";
        if (planDeltaMinor !== 0) {
          if (l.is_revenue) {
            planDir = planDeltaMinor > 0 ? "favorable" : "unfavorable";
          } else {
            planDir = planDeltaMinor < 0 ? "favorable" : "unfavorable";
          }
        }

        let commitDir: "favorable" | "unfavorable" | "neutral" = "neutral";
        if (commitDeltaMinor !== 0) {
          if (l.is_revenue) {
            commitDir = commitDeltaMinor > 0 ? "favorable" : "unfavorable";
          } else {
            commitDir = commitDeltaMinor < 0 ? "favorable" : "unfavorable";
          }
        }

        return {
          line_id: l.line_id,
          line_name: l.line_name,
          plan_minor: l.plan_minor,
          plan_text: minorToDecimalStr(l.plan_minor),
          commit_minor: l.commit_minor,
          commit_text: minorToDecimalStr(l.commit_minor),
          actual_minor: l.actual_minor,
          actual_text: minorToDecimalStr(l.actual_minor),
          actual_vs_plan_delta_minor: planDeltaMinor,
          actual_vs_plan_delta_text: minorToDecimalStr(planDeltaMinor),
          actual_vs_plan_direction: planDir,
          actual_vs_commit_delta_minor: commitDeltaMinor,
          actual_vs_commit_delta_text: minorToDecimalStr(commitDeltaMinor),
          actual_vs_commit_direction: commitDir,
        };
      });

      return {
        data: {
          rows,
          attribution: attributionItems,
          threeway: threewayItems,
        },
      };
    }
    case "variance.set_reason_code": {
      const { line_id, period_id, code, note } = args as {
        line_id: string;
        period_id: string;
        code: string;
        note?: string;
      };
      const key = `${line_id}:${period_id}`;
      mockVarianceReasons.set(key, {
        code,
        note: note ?? null,
      });
      return {
        data: {
          saved: true,
        },
      };
    }
    /* ── FVA (Forecast Value Add) (F-025 · M5-3 · S-055) ───────────── */
    case "fva.get": {
      const fvaArgs = (args ?? {}) as {
        company_id?: string;
        line_ids?: string[];
      };
      const companyId = fvaArgs.company_id ?? "";
      const argsStr = JSON.stringify(fvaArgs);

      // Dev trigger: restatement banner test
      if (companyId.includes("restated") || argsStr.includes("restated")) {
        return mockError(
          "FVA_RESTATEMENT_FLAG",
          "actuals were restated for these periods — FVA recomputed; versions unchanged",
          "Actuals were restated for these periods — FVA recomputed; versions unchanged.",
          200,
          true,
          { company_id: companyId },
        );
      }

      // Count locked versions across all scenarios for this active model/company
      const totalVersionCount = [...mockScenarioVersions.values()].reduce(
        (acc, vers) => acc + vers.length,
        0,
      );

      // S-055 Empty state when version count < 3: "Need >= 3 Forecast Versions to score a line"
      if (totalVersionCount < 3) {
        return {
          data: {
            scores: [],
            restated: false,
          },
        };
      }

      // When versions >= 3, compute realistic MAPE (e.g. 6.4%), bias (e.g. +1.8%), hit rate (e.g. 71%), and sparkline points
      // Line-level and BU rollup FVA scores:
      const allScores: FvaScoreItem[] = [
        // Line 1: Product Revenue
        {
          line_id: "ln-rev-product",
          line_name: "Product Revenue",
          business_unit_id: "bu-na",
          business_unit_name: "North America",
          version_count: totalVersionCount,
          mape_pct: 6.4,
          bias_pct: 1.8,
          hit_rate_pct: 71.0,
          trend: "improving",
          sparkline: [8.5, 7.8, 7.1, 6.9, 6.4],
        },
        // Line 2: Services Revenue
        {
          line_id: "ln-rev-service",
          line_name: "Services Revenue",
          business_unit_id: "bu-na",
          business_unit_name: "North America",
          version_count: totalVersionCount,
          mape_pct: 5.2,
          bias_pct: -0.9,
          hit_rate_pct: 78.0,
          trend: "improving",
          sparkline: [7.2, 6.5, 5.9, 5.4, 5.2],
        },
        // Line 3: Cost of Goods Sold
        {
          line_id: "ln-cogs-direct",
          line_name: "Direct COGS",
          business_unit_id: "bu-emea",
          business_unit_name: "EMEA",
          version_count: totalVersionCount,
          mape_pct: 9.1,
          bias_pct: 3.4,
          hit_rate_pct: 62.0,
          trend: "worsening",
          sparkline: [6.8, 7.2, 7.9, 8.4, 9.1],
        },
        // BU Rollup 1: North America (Group rollup strip)
        {
          line_id: "bu-rollup-na",
          line_name: "North America Rollup",
          business_unit_id: "bu-na",
          business_unit_name: "North America",
          version_count: totalVersionCount,
          mape_pct: 5.8,
          bias_pct: 0.5,
          hit_rate_pct: 75.0,
          trend: "improving",
          sparkline: [7.9, 7.2, 6.5, 6.2, 5.8],
        },
        // BU Rollup 2: EMEA (Group rollup strip)
        {
          line_id: "bu-rollup-emea",
          line_name: "EMEA Rollup",
          business_unit_id: "bu-emea",
          business_unit_name: "EMEA",
          version_count: totalVersionCount,
          mape_pct: 9.1,
          bias_pct: 3.4,
          hit_rate_pct: 62.0,
          trend: "worsening",
          sparkline: [6.8, 7.2, 7.9, 8.4, 9.1],
        },
      ];

      const requestedLineIds = fvaArgs.line_ids;
      const scores =
        requestedLineIds && requestedLineIds.length > 0
          ? allScores.filter(
              (s) =>
                requestedLineIds.includes(s.line_id) ||
                (s.business_unit_id && requestedLineIds.includes(s.business_unit_id)),
            )
          : allScores;

      return {
        data: {
          scores,
          restated: false,
        },
      };
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
