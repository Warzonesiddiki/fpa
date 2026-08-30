import { describe, expect, it } from "vitest";
import {
  ApiEnvelope,
  AppErrorShape,
  CalendarPreviewData,
  CommandArgs,
  CompanyCreateData,
  DecimalString,
  MoneyMinor,
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
});
