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
      // S-073 read side (LICENSE-SPEC): populated when a licenses row exists, else `license` is null.
      plan: z.enum(["pro", "enterprise"]).optional(),
      expires_at: z.string().nullable().optional(),
      license_key_id: z.string().optional(),
      machine_fingerprint: z.string().optional(),
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

// `company.clone_sandbox` (API-SPEC §2.1): copy a Company's structure (calendar + BUs + COA +
// default Model) into a new Company with a freshly sealed `.fpa` file derived from the source
// file's directory + the sandbox name. The GL lines / other Models are NOT copied (M1-5).
export const CompanyCloneArgs = z
  .object({
    company_id: Uuid,
    name: z.string().trim().min(2, "SANDBOX_NAME_REQUIRED").max(120),
  })
  .strict();
export const CompanyCloneData = z.object({ company_id: Uuid });

// `company.archive_year` (API-SPEC §2.1): detach a Fiscal Year once nothing references it.
// Contract is locked by the catalog; the handler + archive schema + the fiscal-year list data
// source land together (TASKBOARD M1-5) — `affected_periods` is the count of periods detached.
export const CompanyArchiveYearArgs = z
  .object({
    company_id: Uuid,
    fy_label: z.string().trim().min(1, "FY_LABEL_REQUIRED"),
  })
  .strict();
export const CompanyArchiveYearData = z.object({ affected_periods: z.number().int().min(0) });

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

/* ── coa.import / coa.merge_accounts (F-002) ─────────────────── */

export const CoaImportArgs = z
  .object({
    company_id: Uuid,
    file_path: z.string().min(1).optional(),
    pack_key: z.string().min(1).optional(),
  })
  .strict()
  .refine((a) => Boolean(a.file_path) !== Boolean(a.pack_key), {
    message: "VALUE_INVALID: exactly one of file_path / pack_key is required",
  });
export type CoaImportArgs = z.infer<typeof CoaImportArgs>;
export const CoaImportData = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
});
export type CoaImportData = z.infer<typeof CoaImportData>;

export const CoaMergeArgs = z
  .object({
    from_id: Uuid,
    to_id: Uuid,
  })
  .strict();
export type CoaMergeArgs = z.infer<typeof CoaMergeArgs>;
export const CoaMergeData = z.object({
  remapped: z.number().int().nonnegative(),
});
export type CoaMergeData = z.infer<typeof CoaMergeData>;

/* ── pack.* ─────────────────────────────────────────────────────── */

export const PackMeta = z.object({
  key: z.string(),
  name: z.string(),
  version: z.string(),
  schema_version: z.string(),
  /** Pack summary shown on wizard cards / Pack browser (packs.schema `pack.description`). */
  description: z.string(),
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

/** The import kinds whose committed rows are Actuals of a Period and therefore post through the
 *  `import.commit` general-ledger destination (`gl_lines` / `ic_lines`, DATABASE-SCHEMA §7).
 *  `driver_data` belongs in `driver_values` and `dimension_master` in `dimension_values`; those
 *  destination pipelines do not exist, so the core refuses their commit rather than writing GL
 *  facts, and S-030 must not offer them as commit-capable source tabs. */
export const LEDGER_IMPORT_KINDS = [
  "gl_dump",
  "excel_csv",
  "opening_balances",
] as const satisfies readonly ImportKind[];

/** True when `import.commit` has a real destination for this kind (see LEDGER_IMPORT_KINDS). */
export function isLedgerImportKind(kind: ImportKind): boolean {
  return (LEDGER_IMPORT_KINDS as readonly ImportKind[]).includes(kind);
}

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
export type ImportParseData = z.infer<typeof ImportParseData>;

/** The validation core emits only these existing ERROR-HANDLING codes. Specific row reasons
 * ride in `message` / `details`; adding an ad-hoc issue code is forbidden (B20). */
export const ImportValidationIssueCode = z.enum([
  "VALUE_INVALID",
  "PERIOD_NOT_FOUND",
  "MAP_ACCOUNT_AMBIGUOUS",
  "UNIT_PERIOD_MISMATCH",
  "OPENING_ALREADY_SET",
]);
export type ImportValidationIssueCode = z.infer<typeof ImportValidationIssueCode>;

/** A row-level (or batch-level — `line_no: null`) validation finding. */
export const RowIssue = z
  .object({
    code: ImportValidationIssueCode,
    message: z.string().min(1),
    line_no: z.number().int().positive().nullable(),
    details: z.record(z.string(), z.unknown()),
  })
  .strict();
export type RowIssue = z.infer<typeof RowIssue>;

/** A mapped source row as the preview table shows it (SCREENS-SPEC S-031 — first 50 rows). */
export const MappedPreviewRow = z
  .object({
    line_no: z.number().int().positive(),
    period_id: z.string().min(1),
    account_id: Uuid,
    account_code: z.string().min(1),
    business_unit_id: Uuid.nullable(),
    amount_minor: MoneyMinor,
    debit_minor: MoneyMinor.nullable(),
    credit_minor: MoneyMinor.nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    posting_ref: z.string().nullable(),
    doc_type: z.string().nullable(),
    is_ic: z.boolean(),
  })
  .strict();
export type MappedPreviewRow = z.infer<typeof MappedPreviewRow>;

/** The bundled "OneFP&A Canonical GL" template (GL-TEMPLATE-SPEC §7) — a file that follows the
 *  template needs zero mapping steps; any other id is a saved `mapping_templates` row. */
export const CANONICAL_MAPPING_ID = "canonical";

export const ImportMappingRef = z.string().min(1, "MAPPING_ID_REQUIRED");

export const MAP_TARGET_INVALID_MESSAGE =
  "This column cannot map to that field. Choose a supported target.";

/** Stage-0-locked `import.map.save_v1` contract (API-SPEC §11). The targets are exactly the
 * Canonical GL fields; unknown targets must surface MAP_TARGET_INVALID rather than being stored. */
export const IMPORT_MAPPING_TARGETS = [
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
] as const;
export const ImportMappingTarget = z.enum(IMPORT_MAPPING_TARGETS);
export type ImportMappingTarget = z.infer<typeof ImportMappingTarget>;

export const ImportSignConvention = z.enum(["debit_positive", "credit_positive"]);
export type ImportSignConvention = z.infer<typeof ImportSignConvention>;

export const AccountCodeNormalization = z.enum([
  "trim",
  "trim_collapse_whitespace",
  "trim_collapse_whitespace_remove_hyphens",
]);
export type AccountCodeNormalization = z.infer<typeof AccountCodeNormalization>;

export const DimensionValueNormalization = z.enum(["trim", "trim_collapse_whitespace"]);
export type DimensionValueNormalization = z.infer<typeof DimensionValueNormalization>;

export const PeriodNormalization = z.enum(["documented", "month_name_mmm_yy"]);
export type PeriodNormalization = z.infer<typeof PeriodNormalization>;

export const ImportMappingColumn = z
  .object({
    source_pattern: z
      .string()
      .trim()
      .min(1, "MAPPING_SOURCE_REQUIRED")
      .max(120, "MAPPING_SOURCE_TOO_LONG")
      .refine((value) => !/\p{Cc}/u.test(value), "MAPPING_SOURCE_CONTROL")
      .refine(
        (value) =>
          value.toLowerCase() !== "sign_convention" && !value.toLowerCase().startsWith("__onefpa_"),
        "MAPPING_SOURCE_RESERVED",
      ),
    semantic_target: ImportMappingTarget,
  })
  .strict();
export type ImportMappingColumn = z.infer<typeof ImportMappingColumn>;

export const ImportMappingTemplate = z
  .object({
    name: z.string().trim().min(1, "MAPPING_NAME_REQUIRED").max(120, "MAPPING_NAME_TOO_LONG"),
    columns: z.array(ImportMappingColumn).min(3, "MAPPING_COLUMNS_REQUIRED").max(15),
    sign_convention: ImportSignConvention,
    normalization: z
      .object({
        account_code: AccountCodeNormalization,
        dimension_values: DimensionValueNormalization,
        period: PeriodNormalization,
      })
      .strict(),
  })
  .strict()
  .superRefine((template, context) => {
    const sources = new Set<string>();
    const targets = new Set<ImportMappingTarget>();
    for (const [index, column] of template.columns.entries()) {
      const source = column.source_pattern.toLowerCase();
      if (sources.has(source)) {
        context.addIssue({
          code: "custom",
          message: "MAPPING_SOURCE_DUPLICATE",
          path: ["columns", index, "source_pattern"],
        });
      }
      if (targets.has(column.semantic_target)) {
        context.addIssue({
          code: "custom",
          message: "MAPPING_TARGET_DUPLICATE",
          path: ["columns", index, "semantic_target"],
        });
      }
      sources.add(source);
      targets.add(column.semantic_target);
    }
    for (const required of ["period", "account_code"] as const) {
      if (!targets.has(required)) {
        context.addIssue({ code: "custom", message: "MAPPING_TARGET_REQUIRED", path: ["columns"] });
      }
    }
    if (!targets.has("amount") && !(targets.has("debit") && targets.has("credit"))) {
      context.addIssue({ code: "custom", message: "MAPPING_AMOUNT_REQUIRED", path: ["columns"] });
    }
  });
export type ImportMappingTemplate = z.infer<typeof ImportMappingTemplate>;

export const ImportMapSaveArgs = z.object({ template: ImportMappingTemplate }).strict();
export const ImportMapSaveData = z
  .object({
    mapping_id: Uuid,
    version: z.string().regex(/^v[1-9]\d*$/),
  })
  .strict();
export type ImportMapSaveData = z.infer<typeof ImportMapSaveData>;

export const ImportValidateArgs = z
  .object({
    parse_id: Uuid,
    mapping_id: ImportMappingRef,
  })
  .strict();

export const ImportValidateData = z
  .object({
    hard: z.array(RowIssue),
    warnings: z.array(RowIssue),
    preview: z.array(MappedPreviewRow).max(50),
    rows: z.number().int().nonnegative(),
    mapping_version: z.union([z.literal("canonical-v1"), z.string().regex(/^v[1-9]\d*$/)]),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.preview.length > result.rows) {
      context.addIssue({
        code: "custom",
        path: ["preview"],
        message: "Mapped preview cannot contain more rows than the valid-row count.",
      });
    }
  });
export type ImportValidationResult = z.infer<typeof ImportValidateData>;

export const ImportTieoutArgs = ImportValidateArgs;

/** A row named by the Tie-Out gate: only rows carrying a `posting_ref` are ever attributed
 *  (M5 attribution honesty — a difference is never spread onto arbitrary rows). */
export const TieOutDiffRow = z
  .object({
    line_no: z.number().int().positive(),
    posting_ref: z.string().trim().min(1),
    debit_minor: MoneyMinor.nullable(),
    credit_minor: MoneyMinor.nullable(),
    amount_minor: MoneyMinor,
    residual_minor: MoneyMinor.refine((minor) => minor !== 0, "TIE_OUT_RESIDUAL_REQUIRED"),
  })
  .strict();
export type TieOutDiffRow = z.infer<typeof TieOutDiffRow>;

export const ImportTieoutData = z
  .object({
    debits_minor: MoneyMinor,
    credits_minor: MoneyMinor,
    diff_rows: z.array(TieOutDiffRow),
    balanced: z.boolean(),
    rows: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.balanced !== (result.debits_minor === result.credits_minor)) {
      context.addIssue({
        code: "custom",
        path: ["balanced"],
        message: "Tie-Out balance flag does not match the exact totals.",
      });
    }
    if (result.balanced && result.diff_rows.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["diff_rows"],
        message: "A balanced Tie-Out cannot contain difference rows.",
      });
    }
    if (result.rows === 0 && (result.debits_minor !== 0 || result.credits_minor !== 0)) {
      context.addIssue({
        code: "custom",
        path: ["rows"],
        message: "A zero-row Tie-Out must have zero totals.",
      });
    }
    if (result.diff_rows.length > result.rows) {
      context.addIssue({
        code: "custom",
        path: ["diff_rows"],
        message: "Tie-Out cannot attribute more difference rows than it mapped.",
      });
    }
    const lineNumbers = new Set<number>();
    result.diff_rows.forEach((row, index) => {
      if (lineNumbers.has(row.line_no)) {
        context.addIssue({
          code: "custom",
          path: ["diff_rows", index, "line_no"],
          message: "A source row cannot be attributed more than once.",
        });
      }
      lineNumbers.add(row.line_no);
    });
  });
export type ImportTieoutResult = z.infer<typeof ImportTieoutData>;

/** Exclude-with-log: the row leaves the batch and the reason is written to the audit trail —
 *  never a silent drop (GL-TEMPLATE-SPEC §3). */
export const ImportExclusion = z
  .object({
    line_no: z.number().int().positive(),
    reason: z.string().trim().min(1, "EXCLUSION_REASON_REQUIRED").max(500),
  })
  .strict();
export type ImportExclusion = z.infer<typeof ImportExclusion>;

export const ImportCommitArgs = z
  .object({
    parse_id: Uuid,
    mapping_id: ImportMappingRef,
    name: z.string().trim().min(1, "BATCH_NAME_REQUIRED").max(120, "BATCH_NAME_TOO_LONG"),
    exclusions: z.array(ImportExclusion).default([]),
  })
  .strict()
  .superRefine((input, context) => {
    const seen = new Set<number>();
    input.exclusions.forEach((exclusion, index) => {
      if (seen.has(exclusion.line_no)) {
        context.addIssue({
          code: "custom",
          path: ["exclusions", index, "line_no"],
          message: "EXCLUSION_DUPLICATE_LINE",
        });
      }
      seen.add(exclusion.line_no);
    });
  });

export const TieOutStatus = z.enum(["pass", "fail", "excluded_rows_logged"]);
export type TieOutStatus = z.infer<typeof TieOutStatus>;

/** API-SPEC §4 — a successful commit is necessarily tied and reports the exact source hash. */
export const ImportCommitData = z
  .object({
    batch_id: Uuid,
    rows: z.number().int().positive(),
    debits_minor: MoneyMinor,
    credits_minor: MoneyMinor,
    tie_out_status: z.enum(["pass", "excluded_rows_logged"]),
    audit_id: z.number().int().positive(),
    excluded_rows: z.number().int().nonnegative(),
    source_hash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.debits_minor !== result.credits_minor) {
      context.addIssue({
        code: "custom",
        path: ["credits_minor"],
        message: "A committed Import Batch must tie exactly.",
      });
    }
    const exclusionsMatch =
      (result.tie_out_status === "pass" && result.excluded_rows === 0) ||
      (result.tie_out_status === "excluded_rows_logged" && result.excluded_rows > 0);
    if (!exclusionsMatch) {
      context.addIssue({
        code: "custom",
        path: ["excluded_rows"],
        message: "Commit exclusion count does not match its Tie-Out status.",
      });
    }
  });
export type ImportCommitResult = z.infer<typeof ImportCommitData>;

export const ImportRollbackArgs = z
  .object({
    batch_id: Uuid,
    reason: z.string().trim().min(1, "ROLLBACK_REASON_REQUIRED").max(500),
  })
  .strict();

/** `rolled_back_to` = the previous committed batch in the same import stream, or `null`. */
export const ImportRollbackData = z
  .object({
    rolled_back_to: Uuid.nullable(),
  })
  .strict();
export type ImportRollbackResult = z.infer<typeof ImportRollbackData>;

export const ImportBatchKind = z.enum([...ImportKind.options, "connector_sync", "collection"]);
export type ImportBatchKind = z.infer<typeof ImportBatchKind>;

export const ImportBatchStatus = z.enum(["validated", "committed", "rolled_back", "failed"]);
export type ImportBatchStatus = z.infer<typeof ImportBatchStatus>;

export const ImportHistoryArgs = z
  .object({
    company_id: Uuid,
    page: z.number().int().positive().max(1_000_000),
  })
  .strict();

export const ImportHistoryRow = z
  .object({
    batch_id: Uuid,
    name: z.string().trim().min(1).max(120),
    kind: ImportBatchKind,
    source_name: z.string().min(1),
    source_hash: z.string().regex(/^[0-9a-f]{64}$/),
    mapping_version: z.string().min(1),
    status: z.enum(["committed", "rolled_back"]),
    rows: z.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    debits_minor: MoneyMinor,
    credits_minor: MoneyMinor,
    tie_out_status: z.enum(["pass", "excluded_rows_logged"]),
    rollback_to_batch_id: Uuid.nullable(),
    committed_at: z.string().datetime({ offset: true }),
    created_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((row, context) => {
    if (row.debits_minor !== row.credits_minor) {
      context.addIssue({
        code: "custom",
        path: ["credits_minor"],
        message: "Persisted committed Import Batch totals must tie exactly.",
      });
    }
    if (row.status === "committed" && row.rollback_to_batch_id !== null) {
      context.addIssue({
        code: "custom",
        path: ["rollback_to_batch_id"],
        message: "Only a rolled-back Import Batch can carry rollback lineage.",
      });
    }
  });
export type ImportHistoryRow = z.infer<typeof ImportHistoryRow>;

export const ImportHistoryData = z
  .object({
    rows: z.array(ImportHistoryRow).max(25),
    meta: z
      .object({
        page: z.number().int().positive(),
        page_size: z.literal(25),
        total: z.number().int().nonnegative(),
        total_pages: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((result, context) => {
    const expectedPages =
      result.meta.total === 0
        ? 0
        : (result.meta.total - 1 - ((result.meta.total - 1) % 25)) / 25 + 1;
    if (result.meta.total_pages !== expectedPages) {
      context.addIssue({
        code: "custom",
        path: ["meta", "total_pages"],
        message: "History total page count does not match its total rows.",
      });
    }
    const remaining = result.meta.total - (result.meta.page - 1) * 25;
    const expectedRows = remaining <= 0 ? 0 : remaining > 25 ? 25 : remaining;
    if (result.rows.length !== expectedRows) {
      context.addIssue({
        code: "custom",
        path: ["rows"],
        message: "History page row count does not match its pagination metadata.",
      });
    }
  });
export type ImportHistoryResult = z.infer<typeof ImportHistoryData>;

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

/* ── model.schedule.upsert (F-016 · M3-6 · S-045) ─────────────────────────────────────────
 * The catalogued schedule command is shared by the later Capital/Production/RevRec units. This
 * slice locks the headcount row body only; those schedule types must add their own row contract
 * when their Tier-3 rules are ready. Compensation remains decimal text across IPC (B3). */
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "HC_DATE_INVALID: ISO date expected.");

export const HeadcountScheduleRow = z
  .object({
    id: z
      .string()
      .regex(/^hc-[a-zA-Z0-9_-]+$/, "VALUE_INVALID: headcount row id is invalid.")
      .optional(),
    role: z.string().trim().min(1, "VALUE_INVALID: role is required.").max(120),
    cost_center: z.string().trim().min(1, "VALUE_INVALID: cost center is required.").max(120),
    start_date: IsoDate,
    termination_date: IsoDate.nullable().default(null),
    base_comp_decimal: DecimalString,
    bonus_pct: DecimalString.default("0"),
    benefits_pct: DecimalString.default("0"),
    employer_load_pct: DecimalString.default("0"),
    ramp_months: z.number().int().min(0).max(120).default(0),
  })
  .strict();
export type HeadcountScheduleRow = z.infer<typeof HeadcountScheduleRow>;

/** `model.schedule.upsert` currently carries the S-045 headcount schedule (API-SPEC §3). */
export const ModelScheduleUpsertArgs = z
  .object({
    model_id: Uuid,
    schedule_type: z.literal("headcount"),
    rows: z.array(HeadcountScheduleRow).max(5000),
  })
  .strict();
export type ModelScheduleUpsertArgs = z.infer<typeof ModelScheduleUpsertArgs>;
export const ModelScheduleUpsertData = z
  .object({
    schedule_id: Uuid,
    recalc: RecalcReport,
    audit_id: z.number().int().positive(),
  })
  .strict();
export type ModelScheduleUpsertData = z.infer<typeof ModelScheduleUpsertData>;

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

/* ── License (F-035, LICENSE-SPEC) ────────────────────────────────────────────
 * Offline Ed25519 activation (PRD F-035; DECISIONS.md: grace 60d, activation file
 * exchange). The payload's `licensed_company_hash` field holds the licensed Company's
 * UUID directly — the locked contract of `company.list` (see LICENSE-SPEC §Binding).
 */
export const LicenseVerifyArgs = z
  .object({ license_payload: z.string().min(1, "LICENSE_PAYLOAD_REQUIRED") })
  .strict();
export const LicenseVerifyData = z.object({
  status: z.enum(["active", "grace"]),
  days_left: z.number().int().nonnegative(),
});
export type LicenseVerifyData = z.infer<typeof LicenseVerifyData>;

export const LicenseRequestFileArgs = z
  .object({ company_path: z.string().min(1, "COMPANY_PATH_REQUIRED") })
  .strict();
export const LicenseRequestFileData = z.object({ file: z.string().min(1) });
export type LicenseRequestFileData = z.infer<typeof LicenseRequestFileData>;

export const LicenseApplyResponseArgs = z
  .object({ response_path_or_payload: z.string().min(1, "LICENSE_PAYLOAD_REQUIRED") })
  .strict();
export const LicenseApplyResponseData = z.object({
  status: z.enum(["active", "grace"]),
  plan: z.enum(["pro", "enterprise"]),
  days_left: z.number().int().nonnegative(),
});
export type LicenseApplyResponseData = z.infer<typeof LicenseApplyResponseData>;

/* ── App settings (F-038 · API-SPEC §2 `settings.get`/`settings.set`).
 * The value is an opaque JSON string stored in the app DB `settings` row (scope `app`).
 * The client keeps the versioned preference document under `SettingsDocumentKey`; the Rust
 * core is the only writer of the audited app row (B18-1). */

export const SettingsDocumentKey = "onefpa.preferences.v1";
export const SettingsKey = z
  .string()
  .trim()
  .min(1, "SETTINGS_SAVE_FAILED: settings key is required.")
  .max(128, "SETTINGS_SAVE_FAILED: settings key is too long.");

export const SettingsGetArgs = z.object({ key: SettingsKey }).strict();
export const SettingsGetData = z.object({
  value: z.string().nullable(),
});
export type SettingsGetData = z.infer<typeof SettingsGetData>;

export const SettingsSetArgs = z
  .object({
    key: SettingsKey,
    value_json: z
      .string()
      .min(2, "SETTINGS_SAVE_FAILED: settings value must be a JSON document.")
      .max(16384, "SETTINGS_SAVE_FAILED: settings value is too large."),
  })
  .strict();
export const SettingsSetData = z.object({ ok: z.literal(true) });
export type SettingsSetData = z.infer<typeof SettingsSetData>;

/* ── Scenario lifecycle (F-022 · SCENARIO-VERSION-SPEC §1–§3 · API-SPEC §3) ─────── */

export const ScenarioKind = z.enum(["actuals", "budget", "forecast", "whatif", "lrp"]);
export type ScenarioKind = z.infer<typeof ScenarioKind>;

export const ScenarioState = z.enum(["draft", "review", "approved", "locked"]);
export type ScenarioState = z.infer<typeof ScenarioState>;

/** `scenario_versions` row (DATABASE-SCHEMA §2) — append-only, version_no monotonic per scenario. */
export const ScenarioVersionRow = z.object({
  id: Uuid,
  scenario_id: Uuid,
  version_no: z.number().int().positive(),
  label: z.string(),
  reason: z.string().nullable(),
  created_at: z.string(),
});
export type ScenarioVersionRow = z.infer<typeof ScenarioVersionRow>;

/** `scenarios` row + its Versions (S-050 table source). `baseline` marks THE Baseline per Model/FY. */
export const ScenarioRow = z.object({
  id: Uuid,
  model_id: Uuid,
  name: z.string().min(1),
  kind: ScenarioKind,
  state: ScenarioState,
  parent_scenario_id: Uuid.nullable(),
  baseline: z.boolean(),
  versions: z.array(ScenarioVersionRow),
});
export type ScenarioRow = z.infer<typeof ScenarioRow>;

/**
 * `model.list → Model[]` (API-SPEC §3 row 2). The spec does not pin the `Model` shape —
 * TASKBOARD §11 records the decision: `{id, company_id, name, horizon, pack_id, scenarios[]}`.
 */
export const ModelSummary = z.object({
  id: Uuid,
  company_id: Uuid,
  name: z.string().min(1),
  horizon: z.number().int().positive(),
  pack_id: z.string().nullable(),
  scenarios: z.array(ScenarioRow),
});
export type ModelSummary = z.infer<typeof ModelSummary>;

/** `scenario.create | scenario.duplicate` — same arg shape (API-SPEC §3). */
export const ScenarioCreateArgs = z
  .object({
    model_id: Uuid,
    name: z.string().min(1).max(120).optional(),
    base_id: Uuid.optional(),
  })
  .strict();
export type ScenarioCreateArgs = z.infer<typeof ScenarioCreateArgs>;

/** `scenario.submit | approve | lock | delete` — `{scenario_id}` only. */
export const ScenarioIdArgs = z.object({ scenario_id: Uuid }).strict();
export type ScenarioIdArgs = z.infer<typeof ScenarioIdArgs>;

/** `scenario.reopen` — the Draft-return transition; a written reason is required (SPEC §1). */
export const ScenarioReopenArgs = z
  .object({
    scenario_id: Uuid,
    reason: z.string().min(1).optional(),
  })
  .strict();
export type ScenarioReopenArgs = z.infer<typeof ScenarioReopenArgs>;

/** `{scenario_id, version_id}` — `version_id` is set only when THIS command wrote a Version (lock). */
export const ScenarioMutationData = z.object({
  scenario_id: Uuid,
  version_id: Uuid.nullable(),
});
export type ScenarioMutationData = z.infer<typeof ScenarioMutationData>;

/** `baseline.set` — Baseline MUST be Locked; replacing one requires a written reason (SPEC §3). */
export const BaselineSetArgs = z
  .object({
    scenario_id: Uuid,
    reason: z.string().min(1).optional(),
  })
  .strict();
export type BaselineSetArgs = z.infer<typeof BaselineSetArgs>;

export const BaselineSetData = z.object({ baseline_version_id: Uuid });
export type BaselineSetData = z.infer<typeof BaselineSetData>;

/** `model.list` — read side for the scenario picker / S-050 (no new command name invented). */
export const ModelListArgs = z.object({ company_id: Uuid }).strict();
export type ModelListArgs = z.infer<typeof ModelListArgs>;
export const ModelListData = z.array(ModelSummary);
export type ModelListData = z.infer<typeof ModelListData>;

/* ── model.diff (F-022 · M4-3 · S-051 · SCENARIO-VERSION-SPEC §4) ─────────────────────── */

/** `model.diff` — two-way cell diff between Scenarios/Versions (API-SPEC §2 row 50). */
export const ModelDiffArgs = z
  .object({
    scenario_a: Uuid,
    version_a: Uuid.nullable().optional(),
    scenario_b: Uuid,
    version_b: Uuid.nullable().optional(),
  })
  .strict();
export type ModelDiffArgs = z.infer<typeof ModelDiffArgs>;

/** A single cell-level diff row (SCENARIO-VERSION-SPEC §4: Δ computed in Rust, Money Value). */
export const ModelDiffRow = z.object({
  line_id: Uuid,
  sheet_id: z.string(),
  sheet_name: z.string(),
  line_name: z.string(),
  account_id: Uuid.nullable(),
  driver_id: z.string().nullable().optional(),
  driver_name: z.string().nullable().optional(),
  period_id: FiscalPeriodId,
  period_label: z.string(),
  value_a: DecimalString.nullable(),
  value_a_minor: MoneyMinor.nullable(),
  formula_a: z.string().nullable().optional(),
  value_b: DecimalString.nullable(),
  value_b_minor: MoneyMinor.nullable(),
  formula_b: z.string().nullable().optional(),
  delta_minor: MoneyMinor,
  delta_text: DecimalString,
  delta_pct: z.number().nullable(),
  is_changed: z.boolean(),
});
export type ModelDiffRow = z.infer<typeof ModelDiffRow>;

export const ModelDiffData = z.object({
  diff_rows: z.array(ModelDiffRow),
});
export type ModelDiffData = z.infer<typeof ModelDiffData>;

/* ── plan.whatif_overlay, plan.sensitivity, plan.goal_seek (F-022 · M4-4 · S-052) ─── */

/** `plan.whatif_overlay` — 2–3 scenario time-series overlay and waterfall attribution. */
export const PlanWhatifOverlayArgs = z
  .object({
    scenario_ids: z.array(Uuid).min(1).max(3),
    period_scope: z.string(),
    kpis: z.array(z.string()).default([]),
  })
  .strict();
export type PlanWhatifOverlayArgs = z.infer<typeof PlanWhatifOverlayArgs>;

export const WhatifSeriesPoint = z.object({
  period_id: z.string(),
  period_label: z.string(),
  value: DecimalString,
  value_minor: MoneyMinor,
});
export type WhatifSeriesPoint = z.infer<typeof WhatifSeriesPoint>;

export const WhatifSeries = z.object({
  scenario_id: Uuid,
  scenario_name: z.string(),
  version_label: z.string().nullable().optional(),
  color: z.string().optional(),
  points: z.array(WhatifSeriesPoint),
});
export type WhatifSeries = z.infer<typeof WhatifSeries>;

export const WaterfallStep = z.object({
  step_id: z.string(),
  label: z.string(),
  delta_text: DecimalString,
  delta_minor: MoneyMinor,
  cumulative_text: DecimalString,
  cumulative_minor: MoneyMinor,
  kind: z.enum(["baseline", "driver", "other_manual", "total"]),
  driver_id: z.string().nullable().optional(),
});
export type WaterfallStep = z.infer<typeof WaterfallStep>;

export const PlanWhatifOverlayData = z.object({
  series: z.array(WhatifSeries),
  waterfall: z.array(WaterfallStep),
});
export type PlanWhatifOverlayData = z.infer<typeof PlanWhatifOverlayData>;

/** `plan.sensitivity` — driver variation within bounds generating tornado bars. */
export const PlanSensitivityArgs = z
  .object({
    driver_id: z.string(),
    lo: DecimalString,
    hi: DecimalString,
    steps: z.number().int().min(2).max(100),
    target_lines: z.array(z.string()),
  })
  .strict();
export type PlanSensitivityArgs = z.infer<typeof PlanSensitivityArgs>;

export const TornadoBar = z.object({
  target_line_id: z.string(),
  target_line_name: z.string(),
  base_value: DecimalString,
  base_minor: MoneyMinor,
  low_value: DecimalString,
  low_minor: MoneyMinor,
  high_value: DecimalString,
  high_minor: MoneyMinor,
  swing_minor: MoneyMinor,
  swing_text: DecimalString,
});
export type TornadoBar = z.infer<typeof TornadoBar>;

export const SensitivityValueStep = z.object({
  driver_value: DecimalString,
  step_index: z.number().int(),
  target_impacts: z.record(z.string(), DecimalString),
});
export type SensitivityValueStep = z.infer<typeof SensitivityValueStep>;

export const PlanSensitivityData = z.object({
  tornado: z.array(TornadoBar),
  values: z.array(SensitivityValueStep),
});
export type PlanSensitivityData = z.infer<typeof PlanSensitivityData>;

/** `plan.goal_seek` — bounded bisection solver to achieve a target cell value. */
export const PlanGoalSeekArgs = z
  .object({
    target_cell: z.string(),
    target_value: DecimalString,
    driver_id: z.string(),
    bounds: z.tuple([DecimalString, DecimalString]),
  })
  .strict();
export type PlanGoalSeekArgs = z.infer<typeof PlanGoalSeekArgs>;

export const PlanGoalSeekData = z.object({
  driver_value: DecimalString,
  iterations: z.number().int(),
  converged: z.boolean(),
  last_target_value: DecimalString.optional(),
});
export type PlanGoalSeekData = z.infer<typeof PlanGoalSeekData>;

/* ── Planning Cycle & Input Collection Schemas (M4-5 · M4-6 · S-053) ── */

export const CycleStartArgs = z
  .object({
    model_id: z.string(),
    kind: z.enum(["budget", "forecast", "rolling"]),
    name: z.string().trim().min(1).max(120),
    due: z.string().min(1),
  })
  .strict();
export type CycleStartArgs = z.infer<typeof CycleStartArgs>;

export const CycleStartData = z.object({
  cycle_id: z.string(),
});
export type CycleStartData = z.infer<typeof CycleStartData>;

export const CycleTaskUpdateArgs = z
  .object({
    task_id: z.string(),
    status: z.enum(["pending", "done", "blocked"]),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export type CycleTaskUpdateArgs = z.infer<typeof CycleTaskUpdateArgs>;

export const CycleTaskUpdateData = z.object({
  updated: z.boolean(),
});
export type CycleTaskUpdateData = z.infer<typeof CycleTaskUpdateData>;

export const CycleTask = z.object({
  id: z.string(),
  cycle_id: z.string(),
  title: z.string(),
  owner: z.string(),
  depends_on_id: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  status: z.enum(["pending", "done", "blocked"]),
  sort_order: z.number().int(),
});
export type CycleTask = z.infer<typeof CycleTask>;

export const CycleChecklistStatusArgs = z
  .object({
    model_id: z.string(),
    period_id: z.string().optional(),
  })
  .strict();
export type CycleChecklistStatusArgs = z.infer<typeof CycleChecklistStatusArgs>;

export const CycleChecklistStatusData = z.object({
  cycle_id: z.string().nullable(),
  tasks: z.array(CycleTask),
  ready: z.boolean(),
});
export type CycleChecklistStatusData = z.infer<typeof CycleChecklistStatusData>;

export const CollectionExportArgs = z
  .object({
    cycle_id: z.string(),
    driver_ids: z.array(z.string()),
    template: z.string(),
  })
  .strict();
export type CollectionExportArgs = z.infer<typeof CollectionExportArgs>;

export const CollectionExportData = z.object({
  file: z.string(),
  rows: z.number().int(),
});
export type CollectionExportData = z.infer<typeof CollectionExportData>;

export const CollectionConflictItem = z.object({
  id: z.string(),
  upload_id: z.string(),
  driver_id: z.string(),
  driver_name: z.string(),
  period_id: z.string(),
  contributor_a: z.string(),
  value_a: DecimalString,
  contributor_b: z.string(),
  value_b: DecimalString,
  resolved: z.boolean(),
  resolution_choice: z.string().nullable().optional(),
  resolved_value: DecimalString.nullable().optional(),
});
export type CollectionConflictItem = z.infer<typeof CollectionConflictItem>;

export const CollectionImportArgs = z
  .object({
    cycle_id: z.string(),
    file_path: z.string(),
    mapping_id: z.string(),
  })
  .strict();
export type CollectionImportArgs = z.infer<typeof CollectionImportArgs>;

export const CollectionImportData = z.object({
  batch_id: z.string(),
  conflicts: z.array(CollectionConflictItem),
});
export type CollectionImportData = z.infer<typeof CollectionImportData>;

export const CollectionResolveConflictArgs = z
  .object({
    conflict_id: z.string(),
    choice: z.enum(["choose_a", "choose_b", "average"]),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export type CollectionResolveConflictArgs = z.infer<typeof CollectionResolveConflictArgs>;

export const CollectionResolveConflictData = z.object({
  resolved: z.boolean(),
});
export type CollectionResolveConflictData = z.infer<typeof CollectionResolveConflictData>;

/* ── Variance & Attribution (F-024 · M5-1 · M5-2 · S-054 · API-SPEC §2 row 77-78) ─── */

export const VarianceRow = z.object({
  line_id: z.string(),
  line_name: z.string(),
  account_code: z.string().optional(),
  actual_minor: MoneyMinor,
  actual_text: DecimalString,
  compare_minor: MoneyMinor,
  compare_text: DecimalString,
  delta_minor: MoneyMinor,
  delta_text: DecimalString,
  delta_pct: z.number().nullable(),
  direction: z.enum(["favorable", "unfavorable", "neutral"]),
  reason_code: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});
export type VarianceRow = z.infer<typeof VarianceRow>;

export const VarianceAttributionItem = z.object({
  line_id: z.string(),
  driver_id: z.string().nullable().optional(),
  driver_name: z.string().nullable().optional(),
  volume_minor: MoneyMinor,
  volume_text: DecimalString,
  price_minor: MoneyMinor,
  price_text: DecimalString,
  mix_minor: MoneyMinor,
  mix_text: DecimalString,
  fx_minor: MoneyMinor,
  fx_text: DecimalString,
  efficiency_minor: MoneyMinor,
  efficiency_text: DecimalString,
  total_attributed_minor: MoneyMinor,
  total_attributed_text: DecimalString,
  unattributable: z.boolean().default(false),
});
export type VarianceAttributionItem = z.infer<typeof VarianceAttributionItem>;

export const VarianceThreewayItem = z.object({
  line_id: z.string(),
  line_name: z.string(),
  plan_minor: MoneyMinor,
  plan_text: DecimalString,
  commit_minor: MoneyMinor,
  commit_text: DecimalString,
  actual_minor: MoneyMinor,
  actual_text: DecimalString,
  actual_vs_plan_delta_minor: MoneyMinor,
  actual_vs_plan_delta_text: DecimalString,
  actual_vs_plan_direction: z.enum(["favorable", "unfavorable", "neutral"]),
  actual_vs_commit_delta_minor: MoneyMinor,
  actual_vs_commit_delta_text: DecimalString,
  actual_vs_commit_direction: z.enum(["favorable", "unfavorable", "neutral"]),
});
export type VarianceThreewayItem = z.infer<typeof VarianceThreewayItem>;

/** `variance.get` — calculate variance analysis, attribution decomposition, and 3-way view. */
export const VarianceGetArgs = z
  .object({
    company_id: z.string(),
    period_id: z.string(),
    compare: z.string(),
    attribution: z.boolean().optional(),
  })
  .strict();
export type VarianceGetArgs = z.infer<typeof VarianceGetArgs>;

export const VarianceGetData = z.object({
  rows: z.array(VarianceRow),
  attribution: z.array(VarianceAttributionItem).optional(),
  threeway: z.array(VarianceThreewayItem).optional(),
});
export type VarianceGetData = z.infer<typeof VarianceGetData>;

/** `variance.set_reason_code` — attach reason code and commentary note to a variance line. */
export const VarianceSetReasonCodeArgs = z
  .object({
    line_id: z.string(),
    period_id: z.string(),
    code: z.string(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export type VarianceSetReasonCodeArgs = z.infer<typeof VarianceSetReasonCodeArgs>;

export const VarianceSetReasonCodeData = z.object({
  saved: z.boolean(),
});
export type VarianceSetReasonCodeData = z.infer<typeof VarianceSetReasonCodeData>;

/* ── Statements (F-027, M6-1, S-060) ────────────────────────────── */

export const StatementType = z.enum(["pl", "bs", "cf", "soce", "segment"]);
export type StatementType = z.infer<typeof StatementType>;

export const StatementPreset = z.enum(["us_gaap", "ifrs"]);
export type StatementPreset = z.infer<typeof StatementPreset>;

export const RoundingMode = z.enum(["major_units", "thousands", "two_decimals"]);
export type RoundingMode = z.infer<typeof RoundingMode>;

export const RoundingRequest = z.object({
  mode: RoundingMode,
  largest_remainder: z.boolean(),
});
export type RoundingRequest = z.infer<typeof RoundingRequest>;

export const BuScope = z.object({
  kind: z.enum(["all", "group", "single"]),
  bu_id: Uuid.nullable().optional(),
});
export type BuScope = z.infer<typeof BuScope>;

export const StatementLineValues = z.record(z.string(), MoneyMinor);
export type StatementLineValues = z.infer<typeof StatementLineValues>;

export const StatementLine = z.object({
  account_id: Uuid,
  label: z.string(),
  values: StatementLineValues,
});
export type StatementLine = z.infer<typeof StatementLine>;

export const StatementSection = z.object({
  section: z.string(),
  lines: z.array(StatementLine),
});
export type StatementSection = z.infer<typeof StatementSection>;

export const StatementTotals = z.object({
  revenue: MoneyMinor.nullable(),
  gross_profit: MoneyMinor.nullable(),
  operating_income: MoneyMinor.nullable(),
  net_income: MoneyMinor.nullable(),
  total_assets: MoneyMinor.nullable(),
  total_liabilities: MoneyMinor.nullable(),
  total_equity: MoneyMinor.nullable(),
  net_cash_change: MoneyMinor.nullable(),
  ending_cash: MoneyMinor.nullable(),
});
export type StatementTotals = z.infer<typeof StatementTotals>;

export const StatementTieOutFinding = z.object({
  code: z.string(),
  message: z.string(),
  detail: z.string(),
});
export type StatementTieOutFinding = z.infer<typeof StatementTieOutFinding>;

export const StatementGetData = z.object({
  rows: z.array(StatementSection),
  totals: StatementTotals,
  tieout_status: z.enum(["pass", "fail"]),
  rounding_status: z.enum(["exact", "approximate"]),
  findings: z.array(StatementTieOutFinding).default([]),
  /** ISO 4217 reporting-currency code — rows/totals are exact minor units of it. */
  currency: z.string().default("USD"),
});
export type StatementGetData = z.infer<typeof StatementGetData>;

export const StatementGetArgs = z
  .object({
    company_id: Uuid,
    type: StatementType,
    // Empty scope = the engine resolves the Company's current (latest with committed
    // Actuals) fiscal period (API-SPEC §6 single-period scope).
    period_scope: z.array(Uuid),
    preset: StatementPreset,
    rounding: RoundingRequest,
    bu_scope: BuScope,
  })
  // `kind: "single"` scopes one Business Unit — the id is what makes that scope
  // executable; without it the native deserializer would fail with an UNTYPED serde
  // error (B12). The gate rejects it as VALUE_INVALID at the boundary instead.
  .refine((a) => a.bu_scope.kind !== "single" || typeof a.bu_scope.bu_id === "string", {
    message: "bu_scope.kind 'single' requires a bu_id",
    path: ["bu_scope", "bu_id"],
  });
export type StatementGetArgs = z.infer<typeof StatementGetArgs>;

/* ── FVA (Forecast Value Add) (F-025, S-055) ────────────────────── */

export const FvaTrend = z.enum(["improving", "worsening", "neutral"]);
export type FvaTrend = z.infer<typeof FvaTrend>;

export const FvaScoreItem = z.object({
  line_id: z.string(),
  line_name: z.string(),
  business_unit_id: z.string().optional(),
  business_unit_name: z.string().optional(),
  version_count: z.number().int(),
  mape_pct: z.number().nullable(),
  bias_pct: z.number().nullable(),
  hit_rate_pct: z.number().nullable(),
  trend: FvaTrend,
  sparkline: z.array(z.number()),
});
export type FvaScoreItem = z.infer<typeof FvaScoreItem>;

export const FvaGetArgs = z
  .object({
    company_id: z.string(),
    line_ids: z.array(z.string()).optional(),
  })
  .strict();
export type FvaGetArgs = z.infer<typeof FvaGetArgs>;

export const FvaGetData = z.object({
  scores: z.array(FvaScoreItem),
  restated: z.boolean().optional(),
});
export type FvaGetData = z.infer<typeof FvaGetData>;

/* ── Registered command table ───────────────────────────────────── */

/* ── Alerts (F-026 · API-SPEC §7 alerts.* · SCREENS-SPEC S-056 · M5-4) ────────────── */

/** Mirrors the `alert_rules` DB CHECK domains (001_initial.sql) — never widen here. */
export const AlertSeverity = z.enum(["info", "warning", "critical"]);
export type AlertSeverity = z.infer<typeof AlertSeverity>;

export const AlertThresholdOperator = z.enum(["lt", "lte", "gt", "gte", "eq"]);
export type AlertThresholdOperator = z.infer<typeof AlertThresholdOperator>;

/** `alerts.list` — `{filter}`: severity narrowing + the dismissed log view (S-056). */
export const AlertFilter = z
  .object({
    severity: AlertSeverity.nullable().optional(),
    include_dismissed: z.boolean().default(false),
  })
  .strict();
export type AlertFilter = z.infer<typeof AlertFilter>;

export const AlertsListArgs = z.object({ filter: AlertFilter.optional() }).strict();
export type AlertsListArgs = z.infer<typeof AlertsListArgs>;

/**
 * Trigger chain persisted with each firing (DATABASE-SCHEMA §alerts `trigger_chain_json`;
 * chain = rule → value → threshold → period per WIREFRAMES-ANALYTICS S-056). `value` and
 * `threshold` are exact decimal strings of minor units — never floats (B3/B18-2).
 */
export const AlertTriggerChain = z
  .object({
    rule: z.string(),
    line: z.string().optional(),
    driver: z.string().optional(),
    period_id: z.string().nullable().optional(),
    value: DecimalString,
    threshold: DecimalString,
  })
  .strict();
export type AlertTriggerChain = z.infer<typeof AlertTriggerChain>;

export const AlertRecord = z
  .object({
    id: Uuid,
    rule_id: Uuid,
    rule_name: z.string(),
    severity: AlertSeverity,
    fired_at: z.string().datetime({ offset: true }),
    trigger_chain: AlertTriggerChain,
    dismissed_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type AlertRecord = z.infer<typeof AlertRecord>;

export const AlertsListData = z.object({ alerts: z.array(AlertRecord) }).strict();
export type AlertsListData = z.infer<typeof AlertsListData>;

/**
 * `alerts.create_rule` rule payload — no `id` (engine-generated). `kpi_id`/`line_ref` are
 * the DB's TEXT targets (`kpis.id`, model line id; covenants are KPI rules — the locked
 * schema offers no separate covenant column). Exactly one target: the same gate the native
 * handler enforces as typed ALERT_RULE_INVALID.
 */
export const AlertRuleInput = z
  .object({
    name: z.string().min(1).max(120),
    kpi_id: z.string().min(1).max(120).nullable().optional(),
    line_ref: z.string().min(1).max(120).nullable().optional(),
    threshold_operator: AlertThresholdOperator,
    threshold_value: DecimalString,
    severity: AlertSeverity.default("warning"),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((r) => (r.kpi_id != null) !== (r.line_ref != null), {
    message: "exactly one of kpi_id or line_ref is required",
    path: ["kpi_id"],
  });
export type AlertRuleInput = z.infer<typeof AlertRuleInput>;

export const AlertsCreateRuleArgs = z.object({ rule: AlertRuleInput }).strict();
export type AlertsCreateRuleArgs = z.infer<typeof AlertsCreateRuleArgs>;

/** Audited mutation response (B4): positive audit_events rowid alongside the id. */
export const AlertsCreateRuleData = z
  .object({
    rule_id: Uuid,
    audit_id: z.number().int().positive(),
  })
  .strict();
export type AlertsCreateRuleData = z.infer<typeof AlertsCreateRuleData>;

/* ── Audit Trail (F-033 · API-SPEC §2 `audit.list` · SCREENS-SPEC S-070 · M7) ─────── */

/**
 * Audit filters (SCREENS-SPEC S-070 "filters" + WIREFRAMES-ANALYTICS S-070 toolbar:
 * date range · actor ▾ · action ▾ · object ▾). Every field is optional narrowing — no
 * field invents a capability the `audit_events` table cannot answer (DATABASE-SCHEMA:
 * seq, company_id, actor, action, object_type, object_id, before_json, after_json,
 * prev_hash, hash, created_at).
 */
export const AuditFilters = z
  .object({
    /** Inclusive ISO-8601 lower bound on `created_at`. */
    from: z.string().datetime({ offset: true }).nullable().optional(),
    /** Inclusive ISO-8601 upper bound on `created_at`. */
    to: z.string().datetime({ offset: true }).nullable().optional(),
    actor: z.string().min(1).max(120).nullable().optional(),
    action: z.string().min(1).max(120).nullable().optional(),
    object_type: z.string().min(1).max(120).nullable().optional(),
    object_id: z.string().min(1).max(120).nullable().optional(),
  })
  .strict();
export type AuditFilters = z.infer<typeof AuditFilters>;

export const AuditListArgs = z
  .object({
    company_id: Uuid,
    filters: AuditFilters.optional(),
    page: z.number().int().positive().max(1_000_000),
  })
  .strict();
export type AuditListArgs = z.infer<typeof AuditListArgs>;

/**
 * One immutable event. `before_json`/`after_json` are the raw persisted payload strings —
 * the screen renders them verbatim (never re-derives or "prettifies" money out of them).
 * `seq` is the AUTOINCREMENT chain position; `prev_hash`/`hash` are the HMAC links.
 */
export const AuditEventRecord = z
  .object({
    seq: z.number().int().positive(),
    actor: z.string().min(1),
    action: z.string().min(1),
    object_type: z.string().min(1),
    object_id: z.string(),
    before_json: z.string().nullable(),
    after_json: z.string().nullable(),
    prev_hash: z.string().min(1),
    hash: z.string().min(1),
    created_at: z.string().min(1),
  })
  .strict();
export type AuditEventRecord = z.infer<typeof AuditEventRecord>;

/**
 * Chain verification result (US-034 / AUTH-SPEC §2.5). `verified` false carries the first
 * failing `broken_at_seq`; the screen then shows the read-only banner + restore path. The
 * engine reports the break as DATA — `AUDIT_CHAIN_BREAK` as an *error* is reserved for
 * mutation attempts, so the auditor can still read the log of a tampered Company.
 */
export const AuditChainStatus = z
  .object({
    verified: z.boolean(),
    broken_at_seq: z.number().int().positive().nullable(),
    /** Total events in the Company chain (the footstrip count). */
    event_count: z.number().int().min(0),
  })
  .strict();
export type AuditChainStatus = z.infer<typeof AuditChainStatus>;

export const AuditListMeta = z
  .object({
    page: z.number().int().positive(),
    page_size: z.number().int().positive(),
    total: z.number().int().min(0),
    total_pages: z.number().int().min(0),
  })
  .strict();
export type AuditListMeta = z.infer<typeof AuditListMeta>;

export const AuditListData = z
  .object({
    events: z.array(AuditEventRecord),
    chain_status: AuditChainStatus,
    meta: AuditListMeta,
    /** Distinct values present in this Company's chain — populates the toolbar selects. */
    facets: z
      .object({
        actors: z.array(z.string()),
        actions: z.array(z.string()),
        object_types: z.array(z.string()),
      })
      .strict(),
  })
  .strict();
export type AuditListData = z.infer<typeof AuditListData>;

export const CommandArgs = {
  "session.status": SessionStatusArgs,
  "session.unlock": SessionUnlockArgs,
  "session.lock": SessionLockArgs,
  "security.pin_setup": SecurityPinSetupArgs,
  "license.verify": LicenseVerifyArgs,
  "license.request_file": LicenseRequestFileArgs,
  "license.apply_response": LicenseApplyResponseArgs,
  "settings.get": SettingsGetArgs,
  "settings.set": SettingsSetArgs,
  "company.list": CompanyListArgs,
  "company.create": CompanyCreateArgs,
  "company.open": CompanyOpenArgs,
  "company.clone_sandbox": CompanyCloneArgs,
  "company.archive_year": CompanyArchiveYearArgs,
  "company.delete": CompanyDeleteArgs,
  "calendar.preview": CalendarPreviewArgs,
  "calendar.apply": CalendarApplyArgs,
  "coa.list": CoaListArgs,
  "coa.import": CoaImportArgs,
  "coa.merge_accounts": CoaMergeArgs,
  "pack.list": PackListArgs,
  "import.parse": ImportParseArgs,
  "import.map.save_v1": ImportMapSaveArgs,
  "import.validate": ImportValidateArgs,
  "import.tieout": ImportTieoutArgs,
  "import.commit": ImportCommitArgs,
  "import.rollback": ImportRollbackArgs,
  "import.history": ImportHistoryArgs,
  "model.cell.set.v1": ModelCellSetArgs,
  "model.recalc": ModelRecalcArgs,
  "model.inspect": ModelInspectArgs,
  "model.schedule.upsert": ModelScheduleUpsertArgs,
  "driver.upsert": DriverUpsertArgs,
  "driver.set_value": DriverSetValueArgs,
  "driver.import": DriverImportArgs,
  "assumption.upsert": AssumptionUpsertArgs,
  "assumption.list": AssumptionListArgs,
  "assumption.find_usages": AssumptionFindUsagesArgs,
  "model.list": ModelListArgs,
  "scenario.create": ScenarioCreateArgs,
  "scenario.duplicate": ScenarioCreateArgs,
  "scenario.submit": ScenarioIdArgs,
  "scenario.approve": ScenarioIdArgs,
  "scenario.lock": ScenarioIdArgs,
  "scenario.reopen": ScenarioReopenArgs,
  "scenario.delete": ScenarioIdArgs,
  "baseline.set": BaselineSetArgs,
  "model.diff": ModelDiffArgs,
  "plan.whatif_overlay": PlanWhatifOverlayArgs,
  "plan.sensitivity": PlanSensitivityArgs,
  "plan.goal_seek": PlanGoalSeekArgs,
  "cycle.start": CycleStartArgs,
  "cycle.task.update": CycleTaskUpdateArgs,
  "cycle.checklist.status": CycleChecklistStatusArgs,
  "collection.export": CollectionExportArgs,
  "collection.import": CollectionImportArgs,
  "collection.resolve_conflict": CollectionResolveConflictArgs,
  "variance.get": VarianceGetArgs,
  "variance.set_reason_code": VarianceSetReasonCodeArgs,
  "fva.get": FvaGetArgs,
  "statement.get.v1": StatementGetArgs,
  "alerts.list": AlertsListArgs,
  "alerts.create_rule": AlertsCreateRuleArgs,
  "audit.list": AuditListArgs,
} as const;

export type CommandName = keyof typeof CommandArgs;
export type CommandInput<C extends CommandName> = z.infer<(typeof CommandArgs)[C]>;
