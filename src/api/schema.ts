import { z } from "zod";

/**
 * IPC schemas — the UI-side validation gate (Zod mirrors serde structs; tauri-specta will generate
 * these in later milestones). Every invoke arg is validated here BEFORE crossing IPC (ARCHITECTURE §1b).
 * Never `any` (ESLint gate).
 */

/* ── Core shared types ─────────────────────────────────────────── */

export const MoneyMinor = z.number().int().finite(); // i64 minor units across IPC (B18-2)
export type MoneyMinor = z.infer<typeof MoneyMinor>;

export const DecimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "MONEY_FORMAT_INVALID: decimal string expected");

export const Uuid = z.string().uuid();
export type Uuid = z.infer<typeof Uuid>;

export const FiscalPeriodId = z.string().regex(/^fp-/, "PERIOD_NOT_FOUND: expected fp-… id");
export type FiscalPeriodId = z.infer<typeof FiscalPeriodId>;

/* ── Error envelope (ERROR-HANDLING §1) ─────────────────────────── */

export const AppErrorShape = z.object({
  code: z.string(),
  message: z.string(),
  userMessage: z.string(),
  httpStatus: z.number().int().min(100).max(599),
  retryable: z.boolean(),
  retryAfterMs: z.number().int().positive().nullable(),
  details: z.record(z.string(), z.unknown()).default({}),
});
export type AppErrorShape = z.infer<typeof AppErrorShape>;

export const ApiEnvelope = z.union([
  z.object({ data: z.unknown() }),
  z.object({ error: AppErrorShape }),
]);
export type ApiEnvelope = z.infer<typeof ApiEnvelope>;

/* ── PIN policy (AUTH-SPEC §2.1) ────────────────────────────────── */

export const PIN_MIN_LEN = 8;
export const PIN_MAX_LEN = 64;

export type PinPolicyIssue = "too_short" | "too_long" | "one_class" | "sequence";

function hasTwoClasses(pin: string): boolean {
  const classes = [
    /[a-z]/.test(pin),
    /[A-Z]/.test(pin),
    /[0-9]/.test(pin),
    /[^a-zA-Z0-9]/.test(pin),
  ].filter(Boolean).length;
  return classes >= 2;
}

function hasSequentialRun4(pin: string): boolean {
  for (let i = 0; i + 3 < pin.length; i += 1) {
    const a = pin.charCodeAt(i);
    const b = pin.charCodeAt(i + 1);
    const c = pin.charCodeAt(i + 2);
    const d = pin.charCodeAt(i + 3);
    if (
      (b === a + 1 && c === b + 1 && d === c + 1) || // ascending run
      (b === a - 1 && c === b - 1 && d === c - 1) || // descending run
      (b === a && c === a && d === a) // repeated run
    ) {
      return true;
    }
  }
  return false;
}

export interface PinPolicyChecks {
  /** 8–64 chars */
  length: boolean;
  /** ≥2 classes (lower/upper/digit/symbol) */
  classes: boolean;
  /** no ascending/descending/repeated run of 4+ */
  sequence: boolean;
}

/** Independent live checks for the setup screen hints (AUTH-SPEC §2.1). */
export function pinPolicyChecks(pin: string): PinPolicyChecks {
  return {
    length: pin.length >= PIN_MIN_LEN && pin.length <= PIN_MAX_LEN,
    classes: hasTwoClasses(pin),
    sequence: !hasSequentialRun4(pin),
  };
}

/** Same rules as the Rust core `validate_pin_policy` — single source per side (B14), mirrored exactly. */
export function validatePinPolicy(pin: string): PinPolicyIssue | null {
  if (pin.length < PIN_MIN_LEN) return "too_short";
  if (pin.length > PIN_MAX_LEN) return "too_long";
  if (!hasTwoClasses(pin)) return "one_class";
  if (hasSequentialRun4(pin)) return "sequence";
  return null;
}

export const PinPolicy = z
  .string()
  .min(PIN_MIN_LEN, "PIN_POLICY_WEAK: PIN must be ≥8 characters with letters and digits.")
  .max(PIN_MAX_LEN, "PIN_POLICY_WEAK: PIN must be at most 64 characters.")
  .refine(hasTwoClasses, {
    message: "PIN_POLICY_WEAK: use at least two character classes (letters, digits, symbols).",
  })
  .refine((pin) => !hasSequentialRun4(pin), {
    message: "PIN_POLICY_WEAK: no sequential runs of 4 or more (e.g. 1234, abcd).",
  });

/* ── session.* ──────────────────────────────────────────────────── */

/** Unlock-time audit-chain verdict (AUTH-SPEC §2.5): `broken_at_seq` is the first event whose
 * HMAC no longer verifies; `audit_chain_ok: false` => the Company opened read-only with the
 * restore offer (`AUDIT_CHAIN_BREAK`, ADR-011). */
export const IntegrityReport = z.object({
  audit_chain_ok: z.boolean(),
  broken_at_seq: z.number().int().positive().nullable(),
});
export type IntegrityReport = z.infer<typeof IntegrityReport>;

export const SessionStatusArgs = z.object({}).strict();
export const SessionStatusData = z.object({
  unlocked: z.boolean(),
  company_id: Uuid.nullable(),
  model_id: Uuid.nullable().optional(),
  read_only: z.boolean(),
  license: z
    .object({
      status: z.enum(["active", "grace", "expired", "invalid"]),
      days_left: z.number().int(),
    })
    .nullable(),
});

export const SessionUnlockArgs = z
  .object({
    pin: PinPolicy,
    company_id: Uuid,
  })
  .strict();
export const SessionUnlockData = z.object({
  company_id: Uuid,
  /** Active Model selected by the native Company lifecycle; older files may not have one yet. */
  model_id: Uuid.nullable().optional(),
  session_token: z.string().min(16),
  read_only: z.boolean(),
  integrity: IntegrityReport,
});

/* ── security.* ─────────────────────────────────────────────────── */

export const SecurityPinSetupArgs = z
  .object({
    pin: PinPolicy,
    confirm: z.string().min(1, "PIN_CONFIRM_MISMATCH: confirm must equal pin"),
  })
  .strict()
  .refine((v) => v.pin === v.confirm, {
    path: ["confirm"],
    message: "PIN_CONFIRM_MISMATCH: confirm must equal pin",
  });
export const SecurityPinSetupData = z.object({ ok: z.literal(true) });

export const SessionLockArgs = z.object({}).strict();
export const SessionLockData = z.object({ locked: z.literal(true) });

/* ── company.* ──────────────────────────────────────────────────── */

export const CompanyMeta = z.object({
  id: Uuid,
  name: z.string().min(1),
  type: z.enum(["single", "group"]),
  default_currency_code: z.string().length(3),
  base_locale: z.string(),
  last_opened_at: z.string().nullable(),
  company_file_path: z.string().min(1),
  license_status: z.enum(["active", "grace", "expired", "invalid"]),
});
export type CompanyMeta = z.infer<typeof CompanyMeta>;

export const CompanyListArgs = z.object({}).strict();
export const CompanyListData = z.array(CompanyMeta).default([]);

export const CompanyDeleteArgs = z
  .object({
    company_id: Uuid,
    reason: z.string().trim().min(1, "COMPANY_DELETE_REASON_REQUIRED").max(500),
  })
  .strict();
export const CompanyDeleteData = z.object({ deleted: z.literal(true) });

export const CompanyOpenArgs = z.object({ path: z.string().min(1) }).strict();
export const CompanyOpenData = z.object({
  company_id: Uuid,
  /** Active Model selected by the native Company lifecycle; older files may not have one yet. */
  model_id: Uuid.nullable().optional(),
  // Switching the active Company re-runs the §2.5 chain check for it (same payload as unlock).
  read_only: z.boolean(),
  integrity: IntegrityReport,
  summary: z.object({
    name: z.string().min(1),
    type: z.enum(["single", "group"]),
    default_currency_code: z.string().length(3),
    base_locale: z.string(),
    pack_schema_version: z.string(),
    company_file_path: z.string(),
  }),
});

export const CompanyCreateArgs = z
  .object({
    name: z.string().min(2).max(120),
    path: z.string().min(1),
    pack_key: z.string().regex(/^[a-z_]+$/),
    calendar: z.object({
      preset: z.enum(["12month", "454", "445", "544", "3334"]),
      fy_start_month: z.number().int().min(1).max(12).nullable(),
      week_start_day: z.number().int().min(0).max(6),
      anchor_rule: z.enum(["sunday_near_feb_1", "nearest_weekday", "first_day"]).nullable(),
      year_end_rule: z.enum(["nrf_4_day", "full_week"]).nullable(),
    }),
    plan_only: z.boolean().default(true),
    horizon: z.enum(["13w", "1y", "3y", "5y"]).default("1y"),
  })
  .strict();
export const CompanyCreateData = z.object({ company_id: Uuid, model_id: Uuid.optional() });

/* ── calendar.preview ───────────────────────────────────────────── */

export const CalendarPreviewArgs = z
  .object({
    preset: z.enum(["12month", "454", "445", "544", "3334"]),
    fy_start_month: z.number().int().min(1).max(12).nullable(),
    week_start_day: z.number().int().min(0).max(6).default(0),
    anchor_rule: z.enum(["sunday_near_feb_1", "nearest_weekday", "first_day"]).nullable(),
    year_end_rule: z.enum(["nrf_4_day", "full_week"]).nullable(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalid ISO date"),
    year_count: z.number().int().min(1).max(5).default(3),
  })
  .strict();
export const CalendarPreviewData = z.object({
  fiscal_years: z.array(
    z.object({
      fy_label: z.string(),
      start_date: z.string(),
      end_date: z.string(),
      week_count: z.union([z.literal(52), z.literal(53)]),
      periods: z.array(
        z.object({
          period_no: z.number().int().min(1).max(13),
          code: z.string(),
          start_date: z.string(),
          end_date: z.string(),
          is_53rd_week: z.boolean(),
        }),
      ),
    }),
  ),
});
export type CalendarPreviewData = z.infer<typeof CalendarPreviewData>;

export const CalendarApplyConfig = z
  .object({
    preset: z.enum(["12month", "454", "445", "544", "3334"]),
    fy_start_month: z.number().int().min(1).max(12).nullable(),
    week_start_day: z.number().int().min(0).max(6).default(0),
    anchor_rule: z.enum(["sunday_near_feb_1", "nearest_weekday", "first_day"]).nullable(),
    year_end_rule: z.enum(["nrf_4_day", "full_week"]).nullable(),
  })
  .strict();

export const BuMapEntry = z
  .object({
    bu_id: Uuid,
    group_period_id: z.string().min(1),
    bu_period_id: z.string().min(1),
    mapping: z.enum(["exact", "partial"]),
    share_pct: z.number().finite().nullable(),
  })
  .strict();

export const CalendarApplyArgs = z
  .object({
    company_id: Uuid,
    config: z
      .array(CalendarApplyConfig)
      .min(1)
      .max(1, "CAL_PERIOD_MAPPING_CONFLICT: single Default calendar"),
    bu_map: z.array(BuMapEntry).default([]),
  })
  .strict();
export const CalendarApplyData = z.object({ applied: z.literal(true) });

/* ── coa.list ──────────────────────────────────────────────────── */

export const AccountNode = z.object({
  id: Uuid,
  code: z.string(),
  name: z.string(),
  account_type: z.enum(["revenue", "cogs", "opex", "asset", "liability", "equity"]),
  report_section: z.string(),
  parent_id: Uuid.nullable(),
  bu_id: Uuid.nullable(),
  is_control: z.boolean(),
  active: z.boolean(),
  version: z.number().int(),
  usage_count: z.number().int(),
});
export type AccountNode = z.infer<typeof AccountNode>;

export const CoaListArgs = z
  .object({
    company_id: Uuid,
    bu_id: Uuid.nullable().optional(),
  })
  .strict();
export const CoaListData = z.array(AccountNode).default([]);

/* ── pack.* ─────────────────────────────────────────────────────── */

export const PackMeta = z.object({
  key: z.string(),
  name: z.string(),
  version: z.string(),
  schema_version: z.string(),
  is_bundled: z.boolean(),
});
export type PackMeta = z.infer<typeof PackMeta>;

export const PackListArgs = z.object({}).strict();
export const PackListData = z.array(PackMeta).default([]);

/* ── import.* (B19 — GL-Dump-first ingestion; GL-TEMPLATE-SPEC, DATABASE-SCHEMA §7) ── */

/** `import_batches.kind` (DATABASE-SCHEMA §7 CHECK) restricted to file-borne kinds —
 *  `connector_sync` / `collection` arrive from their own commands (M2). */
export const ImportKind = z.enum([
  "gl_dump",
  "excel_csv",
  "driver_data",
  "opening_balances",
  "dimension_master",
]);
export type ImportKind = z.infer<typeof ImportKind>;

export const ImportParseArgs = z
  .object({
    file_path: z.string().min(1, "FILE_PATH_REQUIRED"),
    kind: ImportKind,
  })
  .strict();

export const ParsedSheet = z.object({
  name: z.string(),
  kind: z.string(),
  row_count: z.number().int().nonnegative(),
});

/** Encoding detection is never silent: `auto_detected` Latin-1 must be confirmed in the preview
 *  (GL-TEMPLATE-SPEC §1); an undetectable encoding is `ENCODING_UNSUPPORTED` (retryable). */
export const ParseEncoding = z.object({
  scope: z.string(),
  encoding: z.string(),
  bom: z.boolean(),
  auto_detected: z.boolean(),
});

export const ImportParseData = z.object({
  parse_id: Uuid,
  sheets: z.array(ParsedSheet),
  encodings: z.array(ParseEncoding),
  row_counts: z.record(z.string(), z.number().int().nonnegative()),
  // Additive detail for S-032 ("batch name/hash preview"): the locked shape keeps the four keys
  // above; the Rust core adds the file facts the screen needs without re-reading the file.
  source_name: z.string(),
  source_hash: z.string().regex(/^[0-9a-f]{64}$/, "SOURCE_HASH_INVALID: sha256 hex expected"),
  size_bytes: z.number().int().nonnegative(),
  headers: z.array(z.string()),
});

/** A row-level (or batch-level — `line_no: null`) finding. `code` is always one of the 97 locked
 *  ERROR-HANDLING codes; the specific reason rides in `message` / `details` (B20). */
export const RowIssue = z.object({
  code: z.string(),
  message: z.string(),
  line_no: z.number().int().positive().nullable(),
  details: z.record(z.string(), z.unknown()),
});
export type RowIssue = z.infer<typeof RowIssue>;

/** A mapped source row as the preview table shows it (SCREENS-SPEC S-031 — first 50 rows). */
export const MappedPreviewRow = z.object({
  line_no: z.number().int().positive(),
  period_id: z.string().min(1),
  account_id: Uuid,
  account_code: z.string(),
  business_unit_id: Uuid.nullable(),
  amount_minor: MoneyMinor,
  debit_minor: MoneyMinor.nullable(),
  credit_minor: MoneyMinor.nullable(),
  currency: z.string().length(3),
  posting_ref: z.string().nullable(),
  doc_type: z.string().nullable(),
  is_ic: z.boolean(),
});
export type MappedPreviewRow = z.infer<typeof MappedPreviewRow>;

/** The bundled "OneFP&A Canonical GL" template (GL-TEMPLATE-SPEC §7) — a file that follows the
 *  template needs zero mapping steps; any other id is a saved `mapping_templates` row. */
export const CANONICAL_MAPPING_ID = "canonical";

export const ImportMappingRef = z.string().min(1, "MAPPING_ID_REQUIRED");

export const ImportValidateArgs = z
  .object({
    parse_id: Uuid,
    mapping_id: ImportMappingRef,
  })
  .strict();

export const ImportValidateData = z.object({
  hard: z.array(RowIssue),
  warnings: z.array(RowIssue),
  preview: z.array(MappedPreviewRow),
  rows: z.number().int().nonnegative(),
  mapping_version: z.string(),
});

export const ImportTieoutArgs = ImportValidateArgs;

/** A row named by the Tie-Out gate: only rows carrying a `posting_ref` are ever attributed
 *  (M5 attribution honesty — a difference is never spread onto arbitrary rows). */
export const TieOutDiffRow = z.object({
  line_no: z.number().int().positive(),
  posting_ref: z.string().nullable(),
  debit_minor: MoneyMinor.nullable(),
  credit_minor: MoneyMinor.nullable(),
  amount_minor: MoneyMinor,
  residual_minor: MoneyMinor,
});

export const ImportTieoutData = z.object({
  debits_minor: MoneyMinor,
  credits_minor: MoneyMinor,
  diff_rows: z.array(TieOutDiffRow),
  balanced: z.boolean(),
  rows: z.number().int().nonnegative(),
  currency: z.string().length(3),
});

/** Exclude-with-log: the row leaves the batch and the reason is written to the audit trail —
 *  never a silent drop (GL-TEMPLATE-SPEC §3). */
export const ImportExclusion = z
  .object({
    line_no: z.number().int().positive(),
    reason: z.string().trim().min(1, "EXCLUSION_REASON_REQUIRED").max(500),
  })
  .strict();

export const ImportCommitArgs = z
  .object({
    parse_id: Uuid,
    mapping_id: ImportMappingRef,
    name: z.string().trim().min(1, "BATCH_NAME_REQUIRED").max(120, "BATCH_NAME_TOO_LONG"),
    exclusions: z.array(ImportExclusion).default([]),
  })
  .strict();

export const TieOutStatus = z.enum(["pass", "fail", "excluded_rows_logged"]);
export type TieOutStatus = z.infer<typeof TieOutStatus>;

/** API-SPEC §4 — the documented `import.commit` success shape (plus the exclusion count and the
 *  source hash the batch history table shows; new response fields stay additive, B20). */
export const ImportCommitData = z.object({
  batch_id: Uuid,
  rows: z.number().int().nonnegative(),
  debits_minor: MoneyMinor,
  credits_minor: MoneyMinor,
  tie_out_status: TieOutStatus,
  audit_id: z.number().int().positive(),
  excluded_rows: z.number().int().nonnegative(),
  source_hash: z.string().regex(/^[0-9a-f]{64}$/),
});

export const ImportRollbackArgs = z
  .object({
    batch_id: Uuid,
    reason: z.string().trim().min(1, "ROLLBACK_REASON_REQUIRED").max(500),
  })
  .strict();

/** `rolled_back_to` = the batch the Company's Actuals fall back to once this one is excised;
 *  `null` when this was the only batch (the Company returns to "no Actuals"). */
export const ImportRollbackData = z.object({
  rolled_back_to: Uuid.nullable(),
});

/* ── model.* (F-012 — flat grid engine contract; FORMULA-ENGINE-SPEC §2) ──
 * `model.cell.set.v1` + `model.recalc` are the M1 Model-grid commands. The Zod layer is the
 * UI-side gate (CODING-STANDARDS §5); the Rust core is the authoritative owner of formula
 * whitelist + money semantics (B14). HyperFormula (M3-1) owns the real cell graph; this
 * contract is what the grid and its worker exchange. */

/** Supported-function whitelist (FORMULA-ENGINE-SPEC §2) — UI-side mirror of `core::model`.
 *  Keeping it here lets the formula bar reject an unsupported function before IPC and keeps the
 *  documented set greppable in one place; the Rust gate is the one that cannot be bypassed. */
export const SUPPORTED_FUNCTIONS = [
  // Math & aggregation
  "SUM",
  "SUMIF",
  "SUMIFS",
  "SUMPRODUCT",
  "AVERAGE",
  "AVERAGEIF",
  "AVERAGEIFS",
  "COUNT",
  "COUNTA",
  "COUNTIF",
  "COUNTIFS",
  "MIN",
  "MAX",
  "MEDIAN",
  "ROUND",
  "ROUNDUP",
  "ROUNDDOWN",
  "MROUND",
  "ABS",
  "SQRT",
  "POWER",
  "MOD",
  "INT",
  "TRUNC",
  "CEILING",
  "FLOOR",
  "SIGN",
  "PRODUCT",
  "RAND",
  "RANDBETWEEN",
  // Logical & lookup
  "IF",
  "IFS",
  "IFERROR",
  "IFNA",
  "AND",
  "OR",
  "NOT",
  "XOR",
  "SWITCH",
  "TRUE",
  "FALSE",
  "ISNUMBER",
  "ISTEXT",
  "ISBLANK",
  "ISERROR",
  "ISNA",
  "VLOOKUP",
  "HLOOKUP",
  "XLOOKUP",
  "INDEX",
  "MATCH",
  "CHOOSE",
  "OFFSET",
  "INDIRECT",
  // Text & date (incl. the Rust-owned fiscal-aware set)
  "CONCAT",
  "CONCATENATE",
  "TEXT",
  "LEFT",
  "RIGHT",
  "MID",
  "LEN",
  "UPPER",
  "LOWER",
  "TRIM",
  "SUBSTITUTE",
  "VALUE",
  "DATE",
  "YEAR",
  "MONTH",
  "DAY",
  "EOMONTH",
  "EDATE",
  "DATEDIF",
  "WEEKDAY",
  "NETWORKDAYS",
  "FPERIOD",
  "FQTR",
  "FYEAR",
  "FPERIODSTART",
  "PERIODLEN",
  // Financial
  "NPV",
  "IRR",
  "XNPV",
  "XIRR",
  "PMT",
  "IPMT",
  "PPMT",
  "FV",
  "PV",
  "RATE",
  "NPER",
  "SLN",
  "DDB",
  "SYD",
  "DB",
  // Analysis Functions (FORMULA-ENGINE-SPEC §3)
  "CAGR",
  "MOVINGAVG",
  "TREND",
  "SEASONALITY",
  "YOY",
  "PRIORPERIOD",
  "PRIORYEAR",
  "RATIO",
] as const;

const SUPPORTED_FUNCTION_SET = new Set<string>(SUPPORTED_FUNCTIONS);

/** First identifier immediately followed by `(` in a formula that is outside the whitelist, or
 *  `null` when every function call is supported. Complements the Rust gate (never a float, never
 *  a silent substitution — FORMULA-ENGINE-SPEC §4). */
export function findUnsupportedFunction(formula: string): string | null {
  const calls = formula.match(/[A-Za-z_][A-Za-z0-9_.]*(?=\s*\()/g);
  if (!calls) return null;
  for (const raw of calls) {
    if (!SUPPORTED_FUNCTION_SET.has(raw.toUpperCase())) return raw;
  }
  return null;
}

export const FormulaText = z
  .string()
  .min(1, "VALUE_INVALID: formula must not be empty.")
  .max(2048, "VALUE_INVALID: formula too long (max 2048 characters).")
  .refine((f) => f.startsWith("="), {
    message: "VALUE_INVALID: formulas must start with '='.",
  });

export const ModelCellSetArgs = z
  .object({
    line_id: Uuid,
    scenario_id: Uuid,
    period_id: FiscalPeriodId,
    value: DecimalString.nullable().optional(),
    formula: FormulaText.nullable().optional(),
    manual_override: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) =>
      (v.value !== undefined && v.value !== null) ||
      (v.formula !== undefined && v.formula !== null),
    {
      message: "VALUE_INVALID: provide a value or a formula.",
    },
  )
  .refine((v) => v.formula == null || findUnsupportedFunction(v.formula) === null, {
    message:
      "FORMULA_UNSUPPORTED_FUNCTION: function is not in the supported set (FORMULA-ENGINE-SPEC §2).",
  });
export type ModelCellSetArgs = z.infer<typeof ModelCellSetArgs>;

/** Grid issue for the recalc envelope — codes are the locked ERROR-HANDLING taxonomy (B20). */
export const RecalcCellIssue = z.object({
  code: z.enum([
    "FORMULA_CYCLE",
    "REFERENCE_BROKEN",
    "DRIVER_OUT_OF_BOUNDS",
    "HARDCODED_ASSUMPTION",
    "VALUE_INVALID",
  ]),
  cell: z.string(),
  details: z.record(z.string(), z.unknown()).default({}),
});
export type RecalcCellIssue = z.infer<typeof RecalcCellIssue>;

/** API-SPEC §3 `model.cell.set.v1` success shape (`recalc`) — the `issues` and `changed_cells`
 *  arrays are additive; `cycles` order is deterministic (cell path lexical order). */
export const RecalcReport = z.object({
  dirty_cells: z.number().int().nonnegative(),
  cycles: z.array(z.object({ path: z.array(z.string()).min(2) })),
  changed_cells: z.array(z.string()),
  issues: z.array(RecalcCellIssue).default([]),
  duration_ms: z.number().int().nonnegative(),
});
export type RecalcReport = z.infer<typeof RecalcReport>;

export const ModelCellSetData = z.object({
  recalc: RecalcReport,
  cell: z.object({
    value_minor: MoneyMinor.nullable(),
    amount_text: z.string().nullable(),
    formula: z.string().nullable(),
    manual_override: z.boolean(),
  }),
  audit_id: z.number().int().positive(),
});

export const ModelRecalcArgs = z
  .object({
    model_id: Uuid,
    scenario_id: Uuid,
  })
  .strict();
export const ModelRecalcData = z.object({
  duration_ms: z.number().int().nonnegative(),
  changed_cells: z.array(z.string()),
  issues: z.array(RecalcCellIssue).default([]),
});

/** `model.inspect` — read-only formula inspection (F-012 · M3-2 · FORMULA-ENGINE-SPEC §6). */
export const ModelInspectArgs = z
  .object({
    line_id: Uuid,
    period_id: FiscalPeriodId,
  })
  .strict();
export type ModelInspectArgs = z.infer<typeof ModelInspectArgs>;

export const CellRef = z.object({
  line_id: z.string().nullable(),
  period_id: z.string().nullable(),
  sheet: z.number().int(),
  col: z.number().int(),
  row: z.number().int(),
});

export const ModelInspectData = z.object({
  line_id: z.string(),
  period_id: z.string(),
  formula: z.string().nullable(),
  computed_text: z.string().nullable(),
  error_code: z.string().nullable(),
  precedents: z.array(CellRef),
  dependents: z.array(CellRef),
  cycle: z.array(CellRef).nullable(),
  is_cycle: z.boolean(),
});

/* ── driver.* (F-013 · M3-3 · MODELING-METHODS-SPEC §2, DATABASE-SCHEMA §6) ──────────────
 * Driver tables are the semantic inputs to planning lines whose `method` is `driver`. Values are
 * exact decimal strings (`value_decimal` — never a float, B3); `driver.upsert` defines a driver
 * (its `driver_type`/`source`/bounds mirror the `drivers` CHECK constraints), `driver.set_value`
 * writes a period value (bounds enforced → `DRIVER_OUT_OF_BOUNDS`), and `driver.import` loads a
 * `driver_data` batch (`IMPORT_*` taxonomy). */

/** `drivers.driver_type` CHECK (DATABASE-SCHEMA §6). */
export const DriverType = z.enum([
  "volume_x_rate",
  "headcount",
  "growth",
  "seasonal",
  "spread",
  "ratio",
  "manual",
]);
export type DriverTypeValue = z.infer<typeof DriverType>;

/** `drivers.source` CHECK (DATABASE-SCHEMA §6). */
export const DriverSource = z.enum(["global", "bu_override", "collection", "imported"]);

/** Minimum-heuristic prompt for the S-043 "core-driver count" advisory (≤7 core drivers). */
export const CORE_DRIVER_ADVISORY_MAX = 7;

/** A driver definition body (the `driver{...}` in API-SPEC `driver.upsert`). `id` is optional on
 *  create and required to update an existing row; the rest mirror `drivers` columns. */
export const DriverDef = z
  .object({
    id: z
      .string()
      .regex(/^dr-[a-zA-Z0-9_-]+$/, "VALUE_INVALID: driver id must be a slug.")
      .optional(),
    name: z
      .string()
      .trim()
      .min(1, "VALUE_INVALID: driver name is required.")
      .max(120, "VALUE_INVALID: driver name too long.")
      .regex(/^[a-z_][a-z0-9_]*$/, "VALUE_INVALID: driver name must be lowercase snake_case."),
    driver_type: DriverType,
    unit: z.string().trim().max(40).nullable(),
    source: DriverSource,
    is_core: z.boolean().default(false),
    bounds_low: DecimalString.nullable().optional(),
    bounds_high: DecimalString.nullable().optional(),
  })
  .strict();
export type DriverDef = z.infer<typeof DriverDef>;

/** `driver.upsert` — {model_id, driver{...}} → {driver_id} (API-SPEC §2). */
export const DriverUpsertArgs = z
  .object({
    model_id: Uuid,
    driver: DriverDef,
  })
  .strict();
export const DriverUpsertData = z.object({
  driver_id: z.string().regex(/^dr-[a-zA-Z0-9_-]+$/, "VALUE_INVALID: driver id must be a slug."),
  created: z.boolean(),
});

/** `driver.set_value` — {driver_id, scenario_id, period_id, value_decimal} → {ok, recalc}. */
export const DriverSetValueArgs = z
  .object({
    driver_id: z.string().regex(/^dr-[a-zA-Z0-9_-]+$/, "VALUE_INVALID: driver id must be a slug."),
    scenario_id: Uuid,
    period_id: FiscalPeriodId,
    value_decimal: DecimalString,
  })
  .strict();
export const DriverSetValueData = z.object({
  ok: z.literal(true),
  recalc: RecalcReport,
  value_decimal: DecimalString,
});

/** `driver.import` — {file_path, mapping_id} → {batch_id} (API-SPEC §2; `import.parse` pipeline). */
export const DriverImportArgs = z
  .object({
    file_path: z.string().min(1, "FILE_PATH_REQUIRED"),
    mapping_id: ImportMappingRef,
  })
  .strict();
export const DriverImportData = z.object({
  batch_id: Uuid,
});

/** Assumption Register row (F-014 · DATABASE-SCHEMA §6). Values remain exact decimals. */
export const AssumptionDef = z
  .object({
    id: z
      .string()
      .regex(/^as-[a-zA-Z0-9_-]+$/)
      .optional(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z_][a-z0-9_]*$/),
    unit: z.string().trim().max(40).nullable(),
    owner: z.string().trim().min(1).max(120),
    source: z.string().trim().max(120).nullable(),
    bounds_low: DecimalString.nullable().optional(),
    bounds_high: DecimalString.nullable().optional(),
    effective_from: FiscalPeriodId.nullable().optional(),
    effective_to: FiscalPeriodId.nullable().optional(),
    values: z.record(FiscalPeriodId, DecimalString).default({}),
  })
  .strict();
export type AssumptionDef = z.infer<typeof AssumptionDef>;
export const AssumptionUpsertArgs = z
  .object({ model_id: Uuid, assumption: AssumptionDef })
  .strict();
export const AssumptionUpsertData = z.object({
  assumption_id: z.string().regex(/^as-/),
  created: z.boolean(),
});
/** `assumption.list` — persisted register rows for the active Model (S-044 read side). */
export const AssumptionListArgs = z.object({ model_id: Uuid }).strict();
export const AssumptionListRow = AssumptionDef.extend({
  version: z.number().int().nonnegative(),
  last_changed_at: z.string().nullable(),
});
export type AssumptionListRow = z.infer<typeof AssumptionListRow>;
export const AssumptionListData = z.array(AssumptionListRow);
export const AssumptionFindUsagesArgs = z
  .object({ assumption_id: z.string().regex(/^as-/) })
  .strict();
export const AssumptionFindUsagesData = z.object({
  cells: z.array(z.object({ line_id: z.string(), period_id: z.string(), formula: z.string() })),
});

/* ── Registered command table ───────────────────────────────────── */

export const CommandArgs = {
  "session.status": SessionStatusArgs,
  "session.unlock": SessionUnlockArgs,
  "session.lock": SessionLockArgs,
  "security.pin_setup": SecurityPinSetupArgs,
  "company.list": CompanyListArgs,
  "company.create": CompanyCreateArgs,
  "company.open": CompanyOpenArgs,
  "company.delete": CompanyDeleteArgs,
  "calendar.preview": CalendarPreviewArgs,
  "calendar.apply": CalendarApplyArgs,
  "coa.list": CoaListArgs,
  "pack.list": PackListArgs,
  "import.parse": ImportParseArgs,
  "import.validate": ImportValidateArgs,
  "import.tieout": ImportTieoutArgs,
  "import.commit": ImportCommitArgs,
  "import.rollback": ImportRollbackArgs,
  "model.cell.set.v1": ModelCellSetArgs,
  "model.recalc": ModelRecalcArgs,
  "model.inspect": ModelInspectArgs,
  "driver.upsert": DriverUpsertArgs,
  "driver.set_value": DriverSetValueArgs,
  "driver.import": DriverImportArgs,
  "assumption.upsert": AssumptionUpsertArgs,
  "assumption.list": AssumptionListArgs,
  "assumption.find_usages": AssumptionFindUsagesArgs,
} as const;

export type CommandName = keyof typeof CommandArgs;
export type CommandInput<C extends CommandName> = z.infer<(typeof CommandArgs)[C]>;
