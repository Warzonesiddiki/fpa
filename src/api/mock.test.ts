import { describe, expect, it } from "vitest";
import { isTauriRuntime, mockInvoke } from "./mock";

describe("dev mock — browser-preview simulation only (B18-3)", () => {
  it("isTauriRuntime is false in plain webview (jsdom)", () => {
    expect(isTauriRuntime()).toBe(false);
  });

  it("mirrors the documented error envelope for a wrong PIN", async () => {
    const out = (await mockInvoke("session.unlock", {
      pin: "wrong",
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    })) as { error: { code: string } };
    expect(out.error.code).toBe("AUTH_PIN_INVALID");
  });

  it("mirrors STORAGE_DECRYPT_FAILED for an unknown company", async () => {
    const out = (await mockInvoke("session.unlock", {
      pin: "1234",
      company_id: "00000000-0000-0000-0000-000000000000",
    })) as { error: { code: string } };
    expect(out.error.code).toBe("STORAGE_DECRYPT_FAILED");
  });

  it("returns the Meridian demo company and NRF oracle sample", async () => {
    const companies = (await mockInvoke("company.list", {})) as { data: { name: string }[] };
    expect(companies.data[0].name).toContain("Meridian");
    const cal = (await mockInvoke("calendar.preview", {
      preset: "454",
      fy_start_month: null,
      week_start_day: 0,
      anchor_rule: "sunday_near_feb_1",
      year_end_rule: "nrf_4_day",
      from: "2026-02-01",
      year_count: 1,
    })) as { data: { fiscal_years: { fy_label: string }[] } };
    expect(cal.data.fiscal_years[0].fy_label).toBe("FY2026");
  });
});
