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
    pin: z.string().min(4, "PIN_POLICY_WEAK").max(64),
    company_id: Uuid,
  })
  .strict();
export const SessionUnlockData = z.object({
  company_id: Uuid,
  session_token: z.string().min(16),
});

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
  license_status: z.enum(["active", "grace", "expired", "invalid"]),
});
export type CompanyMeta = z.infer<typeof CompanyMeta>;

export const CompanyListArgs = z.object({}).strict();
export const CompanyListData = z.array(CompanyMeta).default([]);

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
  "company.list": CompanyListArgs,
  "company.create": CompanyCreateArgs,
  "calendar.preview": CalendarPreviewArgs,
  "pack.list": PackListArgs,
} as const;

export type CommandName = keyof typeof CommandArgs;
export type CommandInput<C extends CommandName> = z.infer<(typeof CommandArgs)[C]>;
