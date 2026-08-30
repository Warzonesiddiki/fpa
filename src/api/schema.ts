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

export const SessionStatusArgs = z.object({}).strict();
export const SessionStatusData = z.object({
  unlocked: z.boolean(),
  company_id: Uuid.nullable(),
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
  session_token: z.string().min(16),
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
export const CompanyCreateData = z.object({ company_id: Uuid });

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
} as const;

export type CommandName = keyof typeof CommandArgs;
export type CommandInput<C extends CommandName> = z.infer<(typeof CommandArgs)[C]>;
