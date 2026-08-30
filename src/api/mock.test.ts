import { describe, expect, it } from "vitest";
import { isTauriRuntime, mockInvoke } from "./mock";

describe("dev mock — browser-preview simulation only (B18-3)", () => {
  it("isTauriRuntime is false in plain webview (jsdom)", () => {
    expect(isTauriRuntime()).toBe(false);
  });

  it("mirrors the documented error envelope for a wrong PIN", async () => {
    const out = (await mockInvoke("session.unlock", {
      pin: "WrongPin9!",
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    })) as { error: { code: string } };
    expect(out.error.code).toBe("AUTH_PIN_INVALID");
  });

  it("mirrors STORAGE_DECRYPT_FAILED for an unknown company", async () => {
    const out = (await mockInvoke("session.unlock", {
      pin: "Meridian2026",
      company_id: "00000000-0000-0000-0000-000000000000",
    })) as { error: { code: string; httpStatus: number; userMessage: string; retryable: boolean } };
    // The mock is the dev-only mirror of the Rust core: code, status and text must match
    // ERROR-HANDLING.md §B and AppError::DecryptFailed exactly.
    expect(out.error.code).toBe("STORAGE_DECRYPT_FAILED");
    expect(out.error.httpStatus).toBe(401);
    expect(out.error.userMessage).toBe("The Company file cannot be decrypted with this PIN.");
    expect(out.error.retryable).toBe(false);
  });

  it("security.pin_setup mirrors the documented {ok} success shape", async () => {
    const out = (await mockInvoke("security.pin_setup", {
      pin: "Meridian#2026",
      confirm: "Meridian#2026",
    })) as { data: { ok: boolean } };
    expect(out.data.ok).toBe(true);
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

  it("company.open returns a summary and company.delete honours the retention window", async () => {
    const open = (await mockInvoke("company.open", {
      path: "/Users/demo/Meridian Holdings.fpa",
    })) as { data: { company_id: string; summary: { name: string } } };
    expect(open.data.summary.name).toContain("Meridian");

    // The demo company was used recently → deletion blocked by retention (COMPANY_IN_USE_RECENT)
    const blocked = (await mockInvoke("company.delete", {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      reason: "cleanup",
    })) as { error: { code: string; httpStatus: number } };
    expect(blocked.error.code).toBe("COMPANY_IN_USE_RECENT");
    expect(blocked.error.httpStatus).toBe(409);

    // The old sandbox company is outside the window → deletable
    const ok = (await mockInvoke("company.delete", {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000002",
      reason: "cleanup",
    })) as { data: { deleted: boolean } };
    expect(ok.data.deleted).toBe(true);
  });

  it("calendar.apply and coa.list mirror their documented success shapes", async () => {
    const applied = (await mockInvoke("calendar.apply", {
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
    })) as { data: { applied: boolean } };
    expect(applied.data.applied).toBe(true);

    const coa = (await mockInvoke("coa.list", {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    })) as { data: unknown[] };
    expect(coa.data).toEqual([]);
  });

  it("pack.list exposes all 12 bundled packs", async () => {
    const packs = (await mockInvoke("pack.list", {})) as { data: { key: string }[] };
    expect(packs.data).toHaveLength(12);
    expect(packs.data.map((p) => p.key)).toContain("real-estate");
  });
});
