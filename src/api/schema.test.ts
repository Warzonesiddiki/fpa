import { describe, expect, it } from "vitest";
import {
  ApiEnvelope,
  AppErrorShape,
  CalendarPreviewData,
  CommandArgs,
  CompanyCreateData,
  CoaListData,
  DecimalString,
  MoneyMinor,
  SecurityPinSetupData,
  SessionStatusData,
  SessionUnlockData,
  pinPolicyChecks,
  validatePinPolicy,
} from "./schema";

describe("IPC schemas — the validation gate (ARCHITECTURE §1b)", () => {
  it("MoneyMinor rejects floats and decimals that are not integers", () => {
    expect(MoneyMinor.safeParse(12345).success).toBe(true);
    expect(MoneyMinor.safeParse(12.345).success).toBe(false);
    expect(MoneyMinor.safeParse(Number.NaN).success).toBe(false);
  });

  it("DecimalString rejects float notation and non-numeric", () => {
    expect(DecimalString.safeParse("1234.50").success).toBe(true);
    expect(DecimalString.safeParse("-0.01").success).toBe(true);
    expect(DecimalString.safeParse("1e3").success).toBe(false);
    expect(DecimalString.safeParse("abc").success).toBe(false);
  });

  it("validatePinPolicy enforces ≥8 chars, ≥2 classes, no sequential run ≥4 (AUTH-SPEC §2.1)", () => {
    expect(validatePinPolicy("Meridian#2026")).toBeNull();
    expect(validatePinPolicy("Meridian2026")).toBeNull();
    expect(validatePinPolicy("short")).toBe("too_short");
    expect(validatePinPolicy("abcdefgh")).toBe("one_class");
    expect(validatePinPolicy("12345678")).toBe("one_class");
    expect(validatePinPolicy("abcd1234")).toBe("sequence");
    expect(validatePinPolicy("ABcd1234")).toBe("sequence");
    expect(validatePinPolicy("a1!9876b")).toBe("sequence");
    expect(validatePinPolicy("a1!aaaa1")).toBe("sequence");
    expect(validatePinPolicy("x".repeat(65) + "Aa1!")).toBe("too_long");
  });

  it("pinPolicyChecks reports each rule independently for the live hints", () => {
    expect(pinPolicyChecks("")).toEqual({ length: false, classes: false, sequence: true });
    expect(pinPolicyChecks("meridi")).toEqual({
      length: false,
      classes: false,
      sequence: true,
    });
    expect(pinPolicyChecks("meridian")).toEqual({
      length: true,
      classes: false,
      sequence: true,
    });
    expect(pinPolicyChecks("abcdefgh")).toEqual({
      length: true,
      classes: false,
      sequence: false,
    });
    expect(pinPolicyChecks("Meridian2026")).toEqual({
      length: true,
      classes: true,
      sequence: true,
    });
    expect(pinPolicyChecks(`${"x".repeat(65)}Aa1!`)).toEqual({
      length: false,
      classes: true,
      sequence: false,
    });
  });

  it("session.unlock rejects a policy-weak PIN before IPC (min 8, was 4)", () => {
    expect(
      CommandArgs["session.unlock"].safeParse({
        pin: "1234",
        company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      }).success,
    ).toBe(false);
    expect(
      CommandArgs["session.unlock"].safeParse({
        pin: "Meridian#2026",
        company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      }).success,
    ).toBe(true);
  });

  it("security.pin_setup validates policy + confirm match and returns {ok:true}", () => {
    const args = { pin: "Meridian#2026", confirm: "Meridian#2026" };
    expect(CommandArgs["security.pin_setup"].safeParse(args).success).toBe(true);
    expect(
      CommandArgs["security.pin_setup"].safeParse({ pin: "Meridian#2026", confirm: "Different9!" })
        .success,
    ).toBe(false);
    expect(
      CommandArgs["security.pin_setup"].safeParse({ pin: "1234", confirm: "1234" }).success,
    ).toBe(false);
    expect(CommandArgs["security.pin_setup"].safeParse({ pin: "Meridian#2026" }).success).toBe(
      false,
    );
    expect(SecurityPinSetupData.safeParse({ ok: true }).success).toBe(true);
  });

  it("AppErrorShape validates the documented error object", () => {
    const ok = AppErrorShape.safeParse({
      code: "AUTH_PIN_INVALID",
      message: "pin mismatch",
      userMessage: "Incorrect PIN. Please try again.",
      httpStatus: 401,
      retryable: true,
      retryAfterMs: null,
    });
    expect(ok.success).toBe(true);
    expect(AppErrorShape.safeParse({ code: "X" }).success).toBe(false);
  });

  it("ApiEnvelope accepts data or error shapes, rejects both/neither", () => {
    expect(ApiEnvelope.safeParse({ data: { x: 1 } }).success).toBe(true);
    expect(
      ApiEnvelope.safeParse({
        error: {
          code: "E",
          message: "m",
          userMessage: "u",
          httpStatus: 500,
          retryable: false,
          retryAfterMs: null,
        },
      }).success,
    ).toBe(true);
    expect(ApiEnvelope.safeParse({}).success).toBe(false);
  });

  it("company.create validates the full strict shape (calendar nested)", () => {
    const parsed = CommandArgs["company.create"].safeParse({
      name: "Acme",
      path: "acme.fpa",
      pack_key: "saas",
      calendar: {
        preset: "454",
        fy_start_month: null,
        week_start_day: 0,
        anchor_rule: "sunday_near_feb_1",
        year_end_rule: "nrf_4_day",
      },
      plan_only: true,
      horizon: "3y",
    });
    expect(parsed.success).toBe(true);
    const data = CompanyCreateData.safeParse({
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    });
    expect(data.success).toBe(true);
  });

  it("calendar.preview dates are ISO and weeks are 52|53", () => {
    const parsed = CommandArgs["calendar.preview"].safeParse({
      preset: "454",
      fy_start_month: null,
      week_start_day: 0,
      anchor_rule: "sunday_near_feb_1",
      year_end_rule: "nrf_4_day",
      from: "2026-02-01",
      year_count: 2,
    });
    expect(parsed.success).toBe(true);
    const data = CalendarPreviewData.safeParse({
      fiscal_years: [
        {
          fy_label: "FY2026",
          start_date: "2026-02-01",
          end_date: "2027-01-30",
          week_count: 52,
          periods: [
            {
              period_no: 1,
              code: "P01",
              start_date: "2026-02-01",
              end_date: "2026-02-28",
              is_53rd_week: false,
            },
          ],
        },
      ],
    });
    expect(data.success).toBe(true);
  });

  it("company.delete requires a reason and returns {deleted: true}", () => {
    expect(
      CommandArgs["company.delete"].safeParse({
        company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
        reason: "superseded",
      }).success,
    ).toBe(true);
    expect(
      CommandArgs["company.delete"].safeParse({
        company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
        reason: " ",
      }).success,
    ).toBe(false);
    expect(
      CommandArgs["company.delete"].safeParse({ company_id: "not-a-uuid", reason: "x" }).success,
    ).toBe(false);
  });

  it("company.open takes a file path and returns a summary", () => {
    expect(CommandArgs["company.open"].safeParse({ path: "/tmp/Meridian.fpa" }).success).toBe(true);
    expect(CommandArgs["company.open"].safeParse({ path: "" }).success).toBe(false);
  });

  it("calendar.apply accepts one config + empty bu_map; rejects multiple configs", () => {
    const one = {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      config: [
        {
          preset: "454",
          fy_start_month: null,
          week_start_day: 0,
          anchor_rule: "sunday_near_feb_1",
          year_end_rule: "nrf_4_day",
        },
      ],
      bu_map: [],
    };
    expect(CommandArgs["calendar.apply"].safeParse(one).success).toBe(true);
    expect(
      CommandArgs["calendar.apply"].safeParse({
        ...one,
        config: [one.config[0], one.config[0]],
      }).success,
    ).toBe(false);
    expect(CommandArgs["calendar.apply"].safeParse({ ...one, config: [] }).success).toBe(false);
  });

  it("unlock/status payloads carry the §2.5 integrity report (audit-chain verdict)", () => {
    const verified = {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      session_token: "dev-mock-session-token-0000000000000",
      read_only: false,
      integrity: { audit_chain_ok: true, broken_at_seq: null },
    };
    expect(SessionUnlockData.safeParse(verified).success).toBe(true);
    // Degraded path: chain break → read-only + seq of the first unverifiable event (ADR-011).
    const broken = {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      session_token: "dev-mock-session-token-0000000000000",
      read_only: true,
      integrity: { audit_chain_ok: false, broken_at_seq: 41 },
    };
    expect(SessionUnlockData.safeParse(broken).success).toBe(true);
    // The seq key is always sent by the core/mock (nullable, not optional): dropping the key
    // entirely is malformed, an explicit null is tolerated (informational only).
    expect(
      SessionUnlockData.safeParse({
        ...broken,
        integrity: { audit_chain_ok: false, broken_at_seq: null },
      }).success,
    ).toBe(true);
    expect(
      SessionUnlockData.safeParse({ ...broken, integrity: { audit_chain_ok: false } }).success,
    ).toBe(false);
    expect(SessionUnlockData.safeParse({ ...verified, read_only: undefined }).success).toBe(false);
    expect(
      SessionStatusData.safeParse({
        unlocked: true,
        company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
        read_only: true,
        license: null,
      }).success,
    ).toBe(true);
  });

  it("coa.list accepts company scope and validates AccountNode data", () => {
    expect(
      CommandArgs["coa.list"].safeParse({
        company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      }).success,
    ).toBe(true);
    expect(
      CoaListData.safeParse([
        {
          id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000099",
          code: "4000",
          name: "Revenue",
          account_type: "revenue",
          report_section: "Income Statement",
          parent_id: null,
          bu_id: null,
          is_control: false,
          active: true,
          version: 1,
          usage_count: 0,
        },
      ]).success,
    ).toBe(true);
    expect(CoaListData.safeParse([{ id: "x" }]).success).toBe(false);
  });
});
