import { beforeEach, describe, expect, it } from "vitest";
import { INITIAL_FACILITIES, INITIAL_PROJECTS, useCapitalStore } from "./capital";
import type { CapitalProject, DebtFacility } from "@/model/capital";

/** Pristine store snapshot captured at module load — restored before every test. */
const INITIAL_SNAPSHOT = useCapitalStore.getState();

const NEW_PROJECT: Omit<CapitalProject, "id"> = {
  name: "Fleet renewal",
  asset_class: "Vehicles",
  in_service_date: "2026-10-01",
  depreciation_start_date: "2026-10-01",
  life_years: 5,
  method: "SL",
  capex_minor: 600_000,
};

describe("S-046 capital store (F-017 · M3-7)", () => {
  beforeEach(() => {
    // Reset to the seeded US-018 baseline (populated, healthy covenants).
    useCapitalStore.setState(INITIAL_SNAPSHOT);
  });

  it("seeds the US-018 baseline populated with computed schedules and no covenant error", () => {
    const s = useCapitalStore.getState();
    expect(s.status).toBe("populated");
    expect(s.error).toBeNull();
    expect(s.projects).toHaveLength(1);
    expect(s.cashSchedule).toHaveLength(13);
    expect(s.projectPreviews["proj-001"]?.monthly_depreciation_minor).toBe(33_333_333); // 4B/120
    expect(s.calculatedFacilities[0]?.closing_balance_minor).toBe(2_437_500_000);
    expect(s.covenants.is_breached).toBe(false);
  });

  it("setActiveTab switches tabs", () => {
    useCapitalStore.getState().setActiveTab("covenants");
    expect(useCapitalStore.getState().activeTab).toBe("covenants");
    useCapitalStore.getState().setActiveTab("debt");
    expect(useCapitalStore.getState().activeTab).toBe("debt");
  });

  it("load resolves to populated with seed data and empty after clearAll", async () => {
    await useCapitalStore.getState().load();
    expect(useCapitalStore.getState().status).toBe("populated");

    useCapitalStore.getState().clearAll();
    expect(useCapitalStore.getState().status).toBe("empty");
    expect(useCapitalStore.getState().projects).toEqual([]);
    await useCapitalStore.getState().load();
    expect(useCapitalStore.getState().status).toBe("empty");
  });

  it("addProject accepts a valid project and computes its depreciation preview", () => {
    const ok = useCapitalStore.getState().addProject(NEW_PROJECT);
    expect(ok).toBe(true);
    const s = useCapitalStore.getState();
    expect(s.projects).toHaveLength(2);
    expect(s.status).toBe("populated");
    const added = s.projects[1];
    expect(s.projectPreviews[added.id]?.monthly_depreciation_minor).toBe(10_000); // 600k / 60
  });

  it("addProject rejects depreciation before in-service with CAPEX_IN_SERVICE_INVALID", () => {
    const ok = useCapitalStore.getState().addProject({
      ...NEW_PROJECT,
      depreciation_start_date: "2026-09-30",
    });
    expect(ok).toBe(false);
    const s = useCapitalStore.getState();
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("CAPEX_IN_SERVICE_INVALID");
    expect(s.error?.details).toEqual({ project_id: s.projects[1].id });
  });

  it("updateProject edits in place and validates like add", () => {
    const ok = useCapitalStore.getState().updateProject({
      ...INITIAL_PROJECTS[0],
      capex_minor: 80_000_000_00,
    });
    expect(ok).toBe(true);
    expect(useCapitalStore.getState().projectPreviews["proj-001"]?.monthly_depreciation_minor).toBe(
      66_666_667, // 8B / 120 = 66,666,666.67 → HALF_UP
    );

    const bad = useCapitalStore.getState().updateProject({
      ...INITIAL_PROJECTS[0],
      in_service_date: "oops",
    });
    expect(bad).toBe(false);
    expect(useCapitalStore.getState().error?.code).toBe("CAPEX_IN_SERVICE_INVALID");
  });

  it("removeProject recomputes and can reach the empty state once facilities are gone too", () => {
    useCapitalStore.getState().removeFacility("debt-001");
    expect(useCapitalStore.getState().status).toBe("populated"); // project remains
    useCapitalStore.getState().removeProject("proj-001");
    const s = useCapitalStore.getState();
    expect(s.projects).toEqual([]);
    expect(s.status).toBe("empty");
  });

  const NEW_FACILITY: Omit<DebtFacility, "id"> = {
    name: "Revolver",
    facility_type: "Revolver",
    interest_rate_bps: 750,
    opening_balance_minor: 0,
    drawdowns_minor: 5_000_000_00,
    repayments_minor: 0,
    credit_limit_minor: 6_000_000_00,
  };

  it("addFacility accepts a within-limit revolver and computes interest", () => {
    const ok = useCapitalStore.getState().addFacility(NEW_FACILITY);
    expect(ok).toBe(true);
    const s = useCapitalStore.getState();
    expect(s.facilities).toHaveLength(2);
    expect(s.status).toBe("populated");
    const added = s.calculatedFacilities.find((f) => f.name === "Revolver");
    expect(added?.closing_balance_minor).toBe(500_000_000);
    expect(added?.annual_interest_minor).toBe(37_500_000); // 7.5% × 5M
    expect(added?.is_overdrawn).toBe(false);
  });

  it("addFacility rejects an over-limit revolver with DEBT_SCHEDULE_OVERDRAWN", () => {
    const ok = useCapitalStore.getState().addFacility({
      ...NEW_FACILITY,
      credit_limit_minor: 4_000_000_00,
    });
    expect(ok).toBe(false);
    const s = useCapitalStore.getState();
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("DEBT_SCHEDULE_OVERDRAWN");
    expect(s.error?.details).toEqual({ facility_id: s.facilities[1].id });
  });

  it("updateFacility rejects over-repayment and recovers on a valid update", () => {
    const bad = useCapitalStore.getState().updateFacility({
      ...INITIAL_FACILITIES[0],
      repayments_minor: 99_000_000_00,
    });
    expect(bad).toBe(false);
    expect(useCapitalStore.getState().error?.code).toBe("DEBT_SCHEDULE_OVERDRAWN");

    const good = useCapitalStore.getState().updateFacility({
      ...INITIAL_FACILITIES[0],
      repayments_minor: 1_250_000_00,
    });
    expect(good).toBe(true);
    expect(useCapitalStore.getState().error).toBeNull();
    expect(useCapitalStore.getState().status).toBe("populated");
  });

  it("setWcDrivers merges partially and recomputes the working-capital impact", () => {
    useCapitalStore.getState().setWcDrivers({ dso_days: 73 });
    const s = useCapitalStore.getState();
    expect(s.wcDrivers.dso_days).toBe(73);
    expect(s.wcDrivers.dpo_days).toBe(30); // untouched
    // AR = 12B × 73/365 = 2.4B exactly
    expect(s.wcImpact.ar_balance_minor).toBe(2_400_000_000);
  });

  it("updateWeeklyCash edits one week and rechains the 13-week schedule", () => {
    useCapitalStore.getState().updateWeeklyCash(0, { receipts: 3_000_000_00 });
    const s = useCapitalStore.getState();
    expect(s.weeklyReceipts[0]).toBe(3_000_000_00);
    expect(s.cashSchedule[0].receipts_minor).toBe(3_000_000_00);
    // Every later opening shifts by the same +500M
    expect(s.cashSchedule[1].opening_cash_minor).toBe(
      useCapitalStore.getState().cashSchedule[0].closing_cash_minor,
    );
  });

  it("setEbitda drives the covenant gauges and flags COVENANT_BREACH at zero EBITDA", () => {
    useCapitalStore.getState().setEbitda(10_000_000_00); // ₹10M EBITDA → 0.49x debt, 6.3x cover
    expect(useCapitalStore.getState().covenants.is_breached).toBe(false);

    useCapitalStore.getState().setEbitda(0);
    const s = useCapitalStore.getState();
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("COVENANT_BREACH");
    expect(s.covenants.is_breached).toBe(true);
  });

  it("setOpeningCash rechains week 1 opening and covenants", () => {
    useCapitalStore.getState().setOpeningCash(20_000_000_00);
    const s = useCapitalStore.getState();
    expect(s.openingCashMinor).toBe(20_000_000_00);
    expect(s.cashSchedule[0].opening_cash_minor).toBe(20_000_000_00);
    // More cash → lower net debt → ratio still healthy
    expect(s.covenants.is_breached).toBe(false);
  });

  it("triggerError surfaces each typed capital error code with retryable semantics", () => {
    for (const code of [
      "CAPEX_IN_SERVICE_INVALID",
      "DEBT_SCHEDULE_OVERDRAWN",
      "COVENANT_BREACH",
    ] as const) {
      useCapitalStore.getState().triggerError(code);
      const err = useCapitalStore.getState().error;
      expect(err?.code).toBe(code);
      expect(err?.httpStatus).toBe(422);
      expect(err?.retryable).toBe(true);
      expect(useCapitalStore.getState().status).toBe("error");
    }
  });

  it("retry recomputes: recovers from a triggered error, stays error on real data issues", async () => {
    useCapitalStore.getState().triggerError("COVENANT_BREACH");
    await useCapitalStore.getState().retry();
    expect(useCapitalStore.getState().status).toBe("populated"); // seed data is healthy
    expect(useCapitalStore.getState().error).toBeNull();

    // A real validation issue does not clear on retry — the data is still invalid.
    useCapitalStore.getState().addProject({
      ...NEW_PROJECT,
      depreciation_start_date: "2026-09-30",
    });
    await useCapitalStore.getState().retry();
    expect(useCapitalStore.getState().status).toBe("error");
    expect(useCapitalStore.getState().error?.code).toBe("CAPEX_IN_SERVICE_INVALID");
  });

  it("error precedence is capex over debt over covenant when several are wrong", () => {
    useCapitalStore.getState().addFacility({ ...NEW_FACILITY, credit_limit_minor: 1 }); // debt error
    useCapitalStore.getState().addProject({
      ...NEW_PROJECT,
      depreciation_start_date: "2026-09-30",
    }); // capex error too
    expect(useCapitalStore.getState().error?.code).toBe("CAPEX_IN_SERVICE_INVALID");
  });
});
