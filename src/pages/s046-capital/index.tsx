/**
 * S-046 Capital, Debt & Working Capital screen (F-017 · M3-7 · SCREENS-SPEC S-046).
 *
 * Elements:
 * - 5 sub-tabs:
 *   1. Capital Projects: table (project name, asset class, in-service date, life years, method SL/DDB/units, capex amount in minor units, monthly depreciation preview).
 *   2. Debt Schedule: facility name, type (Term/Revolver), interest rate bps, drawdowns, repayments, interest calc, balance.
 *   3. Working Capital Drivers: DSO, DPO, DIO inputs with impact on AR/AP/Inventory cash flow.
 *   4. 13-Week Cash: 13-week cash flow sheet (opening, operating receipts/disbursements, financing, closing cash balance).
 *   5. Covenant Gauges: Net Debt / EBITDA (target <= 3.5x), Interest Cover (target >= 2.5x) with gauge visualization and breach indicators (COVENANT_BREACH).
 *
 * 5 Canonical states:
 * - loading: roll-forward computation spinner
 * - empty: "Add a Capital Project or Debt Facility"
 * - error: CAPEX_IN_SERVICE_INVALID, DEBT_SCHEDULE_OVERDRAWN, COVENANT_BREACH
 * - success: schedules render with confirmation banner
 * - populated: balances + cash + gauges
 *
 * WCAG 2.2 AA compliant (vitest-axe clean).
 * ZERO floating point: All money amounts formatted via MoneyCell or exact minor units.
 */
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Plus, Trash2, ShieldAlert, CheckCircle2 } from "lucide-react";
import { Button, Input, StatePanel } from "@/components/ui";
import Decimal from "decimal.js";
import { MoneyCell } from "@/components/domain/MoneyCell";
import { ModelSectionNav } from "@/components/domain/ModelSectionNav";
import { useCapitalStore } from "@/stores/capital";
import type { DepreciationMethod, DebtFacilityType } from "@/model/capital";

function parseMajorToMinor(val: string | number): number {
  try {
    const d = new Decimal(val || 0);
    return d.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  } catch {
    return 0;
  }
}

function parseInteger(val: string | number): number {
  try {
    const d = new Decimal(val || 0);
    return d.toDecimalPlaces(0, Decimal.ROUND_FLOOR).toNumber();
  } catch {
    return 0;
  }
}

function formatBpsPercent(bps: number): string {
  try {
    const d = new Decimal(bps).dividedBy(100);
    return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString();
  } catch {
    return "0.00";
  }
}

function parseRatioPercent(ratioStr: string): number {
  try {
    const d = new Decimal(ratioStr.replace(/[^0-9.]/g, "") || 0);
    return d.dividedBy(5).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  } catch {
    return 0;
  }
}

function parseRatioNumber(ratioStr: string): number {
  try {
    const d = new Decimal(ratioStr.replace(/[^0-9.]/g, "") || 0);
    return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  } catch {
    return 0;
  }
}

const SUB_TABS = [
  { id: "capital", label: "Capital Projects" },
  { id: "debt", label: "Debt Schedule" },
  { id: "working_capital", label: "Working Capital Drivers" },
  { id: "cash13", label: "13-Week Cash" },
  { id: "covenants", label: "Covenant Gauges" },
] as const;

export function CapitalPage() {
  const { t } = useTranslation();

  const status = useCapitalStore((s) => s.status);
  const error = useCapitalStore((s) => s.error);
  const currency = useCapitalStore((s) => s.currency);
  const activeTab = useCapitalStore((s) => s.activeTab);

  const projects = useCapitalStore((s) => s.projects);
  const wcDrivers = useCapitalStore((s) => s.wcDrivers);
  const openingCashMinor = useCapitalStore((s) => s.openingCashMinor);
  const ebitdaMinor = useCapitalStore((s) => s.ebitdaMinor);

  const projectPreviews = useCapitalStore((s) => s.projectPreviews);
  const calculatedFacilities = useCapitalStore((s) => s.calculatedFacilities);
  const wcImpact = useCapitalStore((s) => s.wcImpact);
  const cashSchedule = useCapitalStore((s) => s.cashSchedule);
  const covenants = useCapitalStore((s) => s.covenants);

  const setActiveTab = useCapitalStore((s) => s.setActiveTab);
  const load = useCapitalStore((s) => s.load);
  const addProject = useCapitalStore((s) => s.addProject);
  const removeProject = useCapitalStore((s) => s.removeProject);
  const addFacility = useCapitalStore((s) => s.addFacility);
  const removeFacility = useCapitalStore((s) => s.removeFacility);
  const setWcDrivers = useCapitalStore((s) => s.setWcDrivers);
  const setEbitda = useCapitalStore((s) => s.setEbitda);
  const retry = useCapitalStore((s) => s.retry);

  // Form states
  const [showAddProject, setShowAddProject] = useState(false);
  const [projName, setProjName] = useState("");
  const [projAssetClass, setProjAssetClass] = useState("Plant & Machinery");
  const [projInService, setProjInService] = useState("2026-08-01");
  const [projDeprecStart, setProjDeprecStart] = useState("2026-08-01");
  const [projLifeYears, setProjLifeYears] = useState("10");
  const [projMethod, setProjMethod] = useState<DepreciationMethod>("SL");
  const [projCapexMajor, setProjCapexMajor] = useState("40000000");
  const [projFormError, setProjFormError] = useState<string | null>(null);

  const [showAddFacility, setShowAddFacility] = useState(false);
  const [facilityName, setFacilityName] = useState("");
  const [facilityType, setFacilityType] = useState<DebtFacilityType>("Term");
  const [facilityBps, setFacilityBps] = useState("650");
  const [facilityOpeningMajor, setFacilityOpeningMajor] = useState("25000000");
  const [facilityDrawsMajor, setFacilityDrawsMajor] = useState("0");
  const [facilityRepayMajor, setFacilityRepayMajor] = useState("625000");
  const [facilityFormError, setFacilityFormError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") {
      void load();
    }
  }, [status, load]);

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    setProjFormError(null);
    if (!projName.trim()) {
      setProjFormError("Project name is required.");
      return;
    }
    const capexMinor = parseMajorToMinor(projCapexMajor);
    const lifeNum = parseInteger(projLifeYears);
    if (capexMinor <= 0) {
      setProjFormError("Valid capex amount is required.");
      return;
    }
    if (lifeNum <= 0) {
      setProjFormError("Valid useful life is required.");
      return;
    }

    const ok = addProject({
      name: projName.trim(),
      asset_class: projAssetClass,
      in_service_date: projInService,
      depreciation_start_date: projDeprecStart,
      life_years: lifeNum,
      method: projMethod,
      capex_minor: capexMinor,
    });

    if (ok) {
      setShowAddProject(false);
      setProjName("");
      setProjCapexMajor("");
      setProjFormError(null);
    }
  };

  const handleCreateFacility = (e: React.FormEvent) => {
    e.preventDefault();
    setFacilityFormError(null);
    if (!facilityName.trim()) {
      setFacilityFormError("Facility name is required.");
      return;
    }
    const bps = parseInteger(facilityBps);
    const openingMinor = parseMajorToMinor(facilityOpeningMajor);
    const drawsMinor = parseMajorToMinor(facilityDrawsMajor);
    const repayMinor = parseMajorToMinor(facilityRepayMajor);

    if (bps < 0) {
      setFacilityFormError("Valid interest rate bps is required.");
      return;
    }

    const ok = addFacility({
      name: facilityName.trim(),
      facility_type: facilityType,
      interest_rate_bps: bps,
      opening_balance_minor: openingMinor,
      drawdowns_minor: drawsMinor,
      repayments_minor: repayMinor,
    });

    if (ok) {
      setShowAddFacility(false);
      setFacilityName("");
      setFacilityOpeningMajor("");
      setFacilityFormError(null);
    }
  };

  // Calculations for footstrips
  const totalCapexMinor = projects.reduce((acc, p) => acc + p.capex_minor, 0);
  const totalMonthlyDeprecMinor = Object.values(projectPreviews).reduce(
    (acc, p) => acc + p.monthly_depreciation_minor,
    0,
  );
  const totalDebtBalanceMinor = calculatedFacilities.reduce(
    (acc, f) => acc + f.closing_balance_minor,
    0,
  );
  const totalAnnualInterestMinor = calculatedFacilities.reduce(
    (acc, f) => acc + f.annual_interest_minor,
    0,
  );
  const closingCashMinor =
    cashSchedule.length > 0
      ? cashSchedule[cashSchedule.length - 1].closing_cash_minor
      : openingCashMinor;

  if (status === "loading") {
    return (
      <div className="p-6">
        <ModelSectionNav />
        <div className="mt-8 flex justify-center">
          <StatePanel
            state="loading"
            message="Calculating capital asset roll-forwards, debt schedules & 13-week cash..."
          />
        </div>
      </div>
    );
  }

  if (status === "empty") {
    return (
      <div className="p-6">
        <ModelSectionNav />
        <div className="mt-8">
          <StatePanel
            state="empty"
            message="Add a Capital Project or Debt Facility"
            actionLabel="Add Capital Project"
            onAction={() => {
              useCapitalStore.setState({ status: "populated" });
              setShowAddProject(true);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-oneapp)] p-6">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-[var(--color-onetext)]">
          {t("capitalPage.title", "Capital, Debt & Working Capital")}
        </h1>
        <p className="text-sm text-[var(--color-onetextmuted)]">
          {t(
            "capitalPage.subtitle",
            "Capex roll-forwards, debt amortization schedules, working capital drivers, 13-week cash projections, and covenant monitoring.",
          )}
        </p>
      </header>

      <ModelSectionNav />

      {/* Error state / Banner */}
      {status === "error" && error && (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-4 flex items-center justify-between rounded-lg border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" aria-hidden="true" />
            <div>
              <span className="font-mono text-xs font-semibold uppercase tracking-wide bg-red-100 dark:bg-red-900/60 px-2 py-0.5 rounded mr-2">
                {error.code}
              </span>
              <span className="text-sm font-medium">{error.userMessage}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void retry()}>
              {t("common.retry", "Retry")}
            </Button>
          </div>
        </div>
      )}

      {/* Covenant Breach Warning banner if breached but status is not strictly error */}
      {covenants.is_breached && status !== "error" && (
        <div
          role="alert"
          className="mt-4 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <div>
            <span className="font-mono text-xs font-semibold uppercase tracking-wide bg-amber-200 dark:bg-amber-900/60 px-2 py-0.5 rounded mr-2">
              COVENANT_BREACH
            </span>
            <span className="text-sm font-medium">
              Covenant breach detected: Net Debt / EBITDA ({covenants.net_debt_to_ebitda}x) or
              Interest Cover ({covenants.interest_cover}x) breach threshold limits.
            </span>
          </div>
        </div>
      )}

      {/* Success banner */}
      {status === "success" && (
        <div
          role="status"
          className="mt-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300"
        >
          <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden="true" />
          <p className="text-sm font-medium">
            {t("capitalPage.success", "Capital and debt schedules updated successfully.")}
          </p>
        </div>
      )}

      {/* Sub-Tabs */}
      <div
        role="tablist"
        aria-label="Capital sub tabs"
        className="mt-6 flex flex-wrap gap-2 border-b border-[var(--color-oneborder)] pb-2"
      >
        {SUB_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              id={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[var(--color-oneprimary)] text-white"
                  : "text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurfacealt)]"
              }`}
            >
              {tab.label}
              {tab.id === "covenants" && covenants.is_breached && (
                <span
                  className="ml-1.5 inline-block h-2 w-2 rounded-full bg-red-500"
                  title="Covenant breach alert"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      <main className="mt-4 flex-1">
        {/* 1. CAPITAL PROJECTS TAB */}
        {activeTab === "capital" && (
          <section
            id="tabpanel-capital"
            role="tabpanel"
            aria-labelledby="tab-capital"
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--color-onetext)]">
                Capital Expenditure & Asset Roll-Forward
              </h2>
              <Button
                size="sm"
                onClick={() => setShowAddProject(!showAddProject)}
                aria-expanded={showAddProject}
              >
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                Add Project
              </Button>
            </div>

            {/* Add Project Form */}
            {showAddProject && (
              <form
                aria-label="Add Capital Project Form"
                onSubmit={handleCreateProject}
                className="grid gap-3 rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-4 md:grid-cols-3"
              >
                <Input
                  label="Project Name"
                  value={projName}
                  onChange={(e) => setProjName(e.target.value)}
                  placeholder="e.g. Data Center Hardware"
                  required
                />
                <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-onetext)]">
                  Asset Class
                  <select
                    value={projAssetClass}
                    onChange={(e) => setProjAssetClass(e.target.value)}
                    className="h-9 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-3 text-sm"
                  >
                    <option value="Buildings & Infrastructure">Buildings & Infrastructure</option>
                    <option value="Plant & Machinery">Plant & Machinery</option>
                    <option value="IT & Software">IT & Software</option>
                    <option value="Vehicles">Vehicles</option>
                  </select>
                </label>
                <Input
                  label="In-Service Date"
                  type="date"
                  value={projInService}
                  onChange={(e) => setProjInService(e.target.value)}
                  required
                />
                <Input
                  label="Depreciation Start Date"
                  type="date"
                  value={projDeprecStart}
                  onChange={(e) => setProjDeprecStart(e.target.value)}
                  required
                />
                <Input
                  label="Useful Life (Years)"
                  type="number"
                  min={1}
                  max={50}
                  value={projLifeYears}
                  onChange={(e) => setProjLifeYears(e.target.value)}
                  required
                />
                <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-onetext)]">
                  Depreciation Method
                  <select
                    value={projMethod}
                    onChange={(e) => setProjMethod(e.target.value as DepreciationMethod)}
                    className="h-9 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-3 text-sm"
                  >
                    <option value="SL">Straight Line (SL)</option>
                    <option value="DDB">Double Declining Balance (DDB)</option>
                    <option value="UNITS">Units of Production</option>
                  </select>
                </label>
                <Input
                  label={`Capex Amount (${currency})`}
                  type="number"
                  min={1}
                  value={projCapexMajor}
                  onChange={(e) => setProjCapexMajor(e.target.value)}
                  placeholder="e.g. 40000000"
                  required
                />

                {projFormError && (
                  <p role="alert" className="text-xs text-red-600 md:col-span-3">
                    {projFormError}
                  </p>
                )}

                <div className="flex gap-2 md:col-span-3">
                  <Button type="submit" size="sm">
                    Save Project
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowAddProject(false);
                      setProjFormError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}

            {/* Projects Table */}
            <div className="overflow-x-auto rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)]">
              <table
                className="w-full border-collapse text-left text-sm"
                aria-label="Capital Projects Table"
              >
                <thead>
                  <tr className="border-b border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] text-xs uppercase text-[var(--color-onetextmuted)]">
                    <th className="p-3">Project Name</th>
                    <th className="p-3">Asset Class</th>
                    <th className="p-3">In-Service</th>
                    <th className="p-3">Deprec Start</th>
                    <th className="p-3">Life</th>
                    <th className="p-3">Method</th>
                    <th className="p-3 text-right">Capex Amount</th>
                    <th className="p-3 text-right">Monthly Deprec</th>
                    <th className="p-3 text-right">Yr 1 Accum</th>
                    <th className="p-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-oneborder)]">
                  {projects.length === 0 ? (
                    <tr>
                      <td
                        colSpan={10}
                        className="p-6 text-center text-sm text-[var(--color-onetextmuted)]"
                      >
                        No capital projects added. Click &quot;Add Project&quot; to begin.
                      </td>
                    </tr>
                  ) : (
                    projects.map((proj) => {
                      const prev = projectPreviews[proj.id];
                      return (
                        <tr key={proj.id} className="hover:bg-[var(--color-onesurfacealt)]">
                          <td className="p-3 font-medium text-[var(--color-onetext)]">
                            {proj.name}
                          </td>
                          <td className="p-3 text-[var(--color-onetextsecondary)]">
                            {proj.asset_class}
                          </td>
                          <td className="p-3 text-[var(--color-onetextsecondary)]">
                            {proj.in_service_date}
                          </td>
                          <td className="p-3 text-[var(--color-onetextsecondary)]">
                            {proj.depreciation_start_date}
                          </td>
                          <td className="p-3 text-[var(--color-onetextsecondary)]">
                            {proj.life_years}y
                          </td>
                          <td className="p-3">
                            <span className="rounded bg-[var(--color-onesurfacealt)] px-2 py-0.5 text-xs font-semibold">
                              {proj.method}
                            </span>
                          </td>
                          <td className="p-3 text-right font-mono">
                            <MoneyCell minor={proj.capex_minor} currency={currency} />
                          </td>
                          <td className="p-3 text-right font-mono">
                            <MoneyCell
                              minor={prev ? prev.monthly_depreciation_minor : 0}
                              currency={currency}
                            />
                          </td>
                          <td className="p-3 text-right font-mono">
                            <MoneyCell
                              minor={prev ? prev.accumulated_first_year_minor : 0}
                              currency={currency}
                            />
                          </td>
                          <td className="p-3 text-center">
                            <button
                              type="button"
                              onClick={() => removeProject(proj.id)}
                              aria-label={`Remove ${proj.name}`}
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>

              {/* Footstrip */}
              <div className="flex flex-wrap items-center justify-between border-t border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-3 text-xs font-medium">
                <div>Total Projects: {projects.length}</div>
                <div className="flex gap-6">
                  <span>
                    Total Capex: <MoneyCell minor={totalCapexMinor} currency={currency} />
                  </span>
                  <span>
                    Total Monthly Depreciation:{" "}
                    <MoneyCell minor={totalMonthlyDeprecMinor} currency={currency} />
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 2. DEBT SCHEDULE TAB */}
        {activeTab === "debt" && (
          <section
            id="tabpanel-debt"
            role="tabpanel"
            aria-labelledby="tab-debt"
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--color-onetext)]">
                Debt Facilities & Amortization Schedule
              </h2>
              <Button
                size="sm"
                onClick={() => setShowAddFacility(!showAddFacility)}
                aria-expanded={showAddFacility}
              >
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                Add Facility
              </Button>
            </div>

            {/* Add Facility Form */}
            {showAddFacility && (
              <form
                aria-label="Add Debt Facility Form"
                onSubmit={handleCreateFacility}
                className="grid gap-3 rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-4 md:grid-cols-3"
              >
                <Input
                  label="Facility Name"
                  value={facilityName}
                  onChange={(e) => setFacilityName(e.target.value)}
                  placeholder="e.g. Revolving Credit Facility"
                  required
                />
                <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-onetext)]">
                  Facility Type
                  <select
                    value={facilityType}
                    onChange={(e) => setFacilityType(e.target.value as DebtFacilityType)}
                    className="h-9 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-3 text-sm"
                  >
                    <option value="Term">Term Loan</option>
                    <option value="Revolver">Revolving Credit Facility</option>
                  </select>
                </label>
                <Input
                  label="Interest Rate (bps, 650 = 6.5%)"
                  type="number"
                  min={0}
                  value={facilityBps}
                  onChange={(e) => setFacilityBps(e.target.value)}
                  required
                />
                <Input
                  label={`Opening Balance (${currency})`}
                  type="number"
                  min={0}
                  value={facilityOpeningMajor}
                  onChange={(e) => setFacilityOpeningMajor(e.target.value)}
                  required
                />
                <Input
                  label={`Drawdowns (${currency})`}
                  type="number"
                  min={0}
                  value={facilityDrawsMajor}
                  onChange={(e) => setFacilityDrawsMajor(e.target.value)}
                />
                <Input
                  label={`Repayments (${currency})`}
                  type="number"
                  min={0}
                  value={facilityRepayMajor}
                  onChange={(e) => setFacilityRepayMajor(e.target.value)}
                />

                {facilityFormError && (
                  <p role="alert" className="text-xs text-red-600 md:col-span-3">
                    {facilityFormError}
                  </p>
                )}

                <div className="flex gap-2 md:col-span-3">
                  <Button type="submit" size="sm">
                    Save Facility
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowAddFacility(false);
                      setFacilityFormError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}

            {/* Debt Table */}
            <div className="overflow-x-auto rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)]">
              <table
                className="w-full border-collapse text-left text-sm"
                aria-label="Debt Facilities Table"
              >
                <thead>
                  <tr className="border-b border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] text-xs uppercase text-[var(--color-onetextmuted)]">
                    <th className="p-3">Facility Name</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Rate</th>
                    <th className="p-3 text-right">Opening</th>
                    <th className="p-3 text-right">Draws (+)</th>
                    <th className="p-3 text-right">Repayments (-)</th>
                    <th className="p-3 text-right">Monthly Int</th>
                    <th className="p-3 text-right">Annual Int</th>
                    <th className="p-3 text-right">Closing Balance</th>
                    <th className="p-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-oneborder)]">
                  {calculatedFacilities.length === 0 ? (
                    <tr>
                      <td
                        colSpan={10}
                        className="p-6 text-center text-sm text-[var(--color-onetextmuted)]"
                      >
                        No debt facilities defined.
                      </td>
                    </tr>
                  ) : (
                    calculatedFacilities.map((fac) => {
                      const ratePct = formatBpsPercent(fac.interest_rate_bps);
                      return (
                        <tr
                          key={fac.id}
                          className={`hover:bg-[var(--color-onesurfacealt)] ${
                            fac.is_overdrawn ? "bg-red-50 dark:bg-red-950/20" : ""
                          }`}
                        >
                          <td className="p-3 font-medium text-[var(--color-onetext)]">
                            {fac.name}
                            {fac.is_overdrawn && (
                              <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                                OVERDRAWN
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-[var(--color-onetextsecondary)]">
                            {fac.facility_type}
                          </td>
                          <td className="p-3 font-mono text-[var(--color-onetextsecondary)]">
                            {ratePct}% ({fac.interest_rate_bps} bps)
                          </td>
                          <td className="p-3 text-right font-mono">
                            <MoneyCell minor={fac.opening_balance_minor} currency={currency} />
                          </td>
                          <td className="p-3 text-right font-mono">
                            <MoneyCell minor={fac.drawdowns_minor} currency={currency} />
                          </td>
                          <td className="p-3 text-right font-mono">
                            <MoneyCell minor={fac.repayments_minor} currency={currency} />
                          </td>
                          <td className="p-3 text-right font-mono">
                            <MoneyCell minor={fac.monthly_interest_minor} currency={currency} />
                          </td>
                          <td className="p-3 text-right font-mono">
                            <MoneyCell minor={fac.annual_interest_minor} currency={currency} />
                          </td>
                          <td className="p-3 text-right font-mono font-semibold">
                            <MoneyCell minor={fac.closing_balance_minor} currency={currency} />
                          </td>
                          <td className="p-3 text-center">
                            <button
                              type="button"
                              onClick={() => removeFacility(fac.id)}
                              aria-label={`Remove ${fac.name}`}
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>

              {/* Footstrip */}
              <div className="flex flex-wrap items-center justify-between border-t border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-3 text-xs font-medium">
                <div>Total Facilities: {calculatedFacilities.length}</div>
                <div className="flex gap-6">
                  <span>
                    Total Debt Balance:{" "}
                    <MoneyCell minor={totalDebtBalanceMinor} currency={currency} />
                  </span>
                  <span>
                    Total Annual Interest:{" "}
                    <MoneyCell minor={totalAnnualInterestMinor} currency={currency} />
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 3. WORKING CAPITAL DRIVERS TAB */}
        {activeTab === "working_capital" && (
          <section
            id="tabpanel-working_capital"
            role="tabpanel"
            aria-labelledby="tab-working_capital"
            className="space-y-4"
          >
            <h2 className="text-base font-semibold text-[var(--color-onetext)]">
              Working Capital Drivers & Cash Flow Sensitivity
            </h2>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-4">
                <label
                  htmlFor="wc-dso-input"
                  className="text-xs font-semibold uppercase tracking-wider text-[var(--color-onetextmuted)]"
                >
                  Days Sales Outstanding (DSO)
                </label>
                <div className="mt-2 flex items-baseline gap-2">
                  <input
                    id="wc-dso-input"
                    type="number"
                    min={0}
                    max={365}
                    value={wcDrivers.dso_days}
                    onChange={(e) => setWcDrivers({ dso_days: parseInteger(e.target.value) })}
                    className="h-10 w-24 rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] px-3 font-mono text-lg font-bold text-[var(--color-onetext)]"
                  />
                  <span className="text-sm text-[var(--color-onetextsecondary)]">days</span>
                </div>
                <p className="mt-3 text-xs text-[var(--color-onetextmuted)]">
                  Accounts Receivable balance:
                </p>
                <p className="font-mono text-base font-semibold text-[var(--color-onetext)]">
                  <MoneyCell minor={wcImpact.ar_balance_minor} currency={currency} />
                </p>
              </div>

              <div className="rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-4">
                <label
                  htmlFor="wc-dpo-input"
                  className="text-xs font-semibold uppercase tracking-wider text-[var(--color-onetextmuted)]"
                >
                  Days Payable Outstanding (DPO)
                </label>
                <div className="mt-2 flex items-baseline gap-2">
                  <input
                    id="wc-dpo-input"
                    type="number"
                    min={0}
                    max={365}
                    value={wcDrivers.dpo_days}
                    onChange={(e) => setWcDrivers({ dpo_days: parseInteger(e.target.value) })}
                    className="h-10 w-24 rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] px-3 font-mono text-lg font-bold text-[var(--color-onetext)]"
                  />
                  <span className="text-sm text-[var(--color-onetextsecondary)]">days</span>
                </div>
                <p className="mt-3 text-xs text-[var(--color-onetextmuted)]">
                  Accounts Payable balance:
                </p>
                <p className="font-mono text-base font-semibold text-[var(--color-onetext)]">
                  <MoneyCell minor={wcImpact.ap_balance_minor} currency={currency} />
                </p>
              </div>

              <div className="rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-4">
                <label
                  htmlFor="wc-dio-input"
                  className="text-xs font-semibold uppercase tracking-wider text-[var(--color-onetextmuted)]"
                >
                  Days Inventory Outstanding (DIO)
                </label>
                <div className="mt-2 flex items-baseline gap-2">
                  <input
                    id="wc-dio-input"
                    type="number"
                    min={0}
                    max={365}
                    value={wcDrivers.dio_days}
                    onChange={(e) => setWcDrivers({ dio_days: parseInteger(e.target.value) })}
                    className="h-10 w-24 rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] px-3 font-mono text-lg font-bold text-[var(--color-onetext)]"
                  />
                  <span className="text-sm text-[var(--color-onetextsecondary)]">days</span>
                </div>
                <p className="mt-3 text-xs text-[var(--color-onetextmuted)]">Inventory balance:</p>
                <p className="font-mono text-base font-semibold text-[var(--color-onetext)]">
                  <MoneyCell minor={wcImpact.inventory_balance_minor} currency={currency} />
                </p>
              </div>
            </div>

            {/* Impact Summary Card */}
            <div className="rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--color-onetext)]">
                Net Working Capital & Operating Cash Flow Impact
              </h3>
              <div className="mt-3 grid grid-cols-2 gap-4 border-t border-[var(--color-oneborder)] pt-3 md:grid-cols-4 text-sm">
                <div>
                  <span className="text-xs text-[var(--color-onetextmuted)]">
                    Net Working Capital (AR + Inv - AP)
                  </span>
                  <div className="font-mono font-bold text-[var(--color-onetext)]">
                    <MoneyCell minor={wcImpact.net_working_capital_minor} currency={currency} />
                  </div>
                </div>
                <div>
                  <span className="text-xs text-[var(--color-onetextmuted)]">
                    Cash Conversion Cycle (CCC)
                  </span>
                  <div className="font-mono font-bold text-[var(--color-onetext)]">
                    {wcDrivers.dso_days + wcDrivers.dio_days - wcDrivers.dpo_days} days
                  </div>
                </div>
                <div>
                  <span className="text-xs text-[var(--color-onetextmuted)]">
                    Annual Baseline Revenue
                  </span>
                  <div className="font-mono text-[var(--color-onetextsecondary)]">
                    <MoneyCell minor={wcDrivers.annual_revenue_minor} currency={currency} />
                  </div>
                </div>
                <div>
                  <span className="text-xs text-[var(--color-onetextmuted)]">
                    Annual Baseline COGS
                  </span>
                  <div className="font-mono text-[var(--color-onetextsecondary)]">
                    <MoneyCell minor={wcDrivers.annual_cogs_minor} currency={currency} />
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 4. 13-WEEK CASH FLOW TAB */}
        {activeTab === "cash13" && (
          <section
            id="tabpanel-cash13"
            role="tabpanel"
            aria-labelledby="tab-cash13"
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--color-onetext)]">
                13-Week Direct Cash Flow Rolling Forecast
              </h2>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[var(--color-onetextmuted)]">Opening Cash:</span>
                <span className="font-mono font-semibold">
                  <MoneyCell minor={openingCashMinor} currency={currency} />
                </span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)]">
              <table
                className="w-full border-collapse text-left text-sm"
                aria-label="13-Week Cash Schedule Table"
              >
                <thead>
                  <tr className="border-b border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] text-xs uppercase text-[var(--color-onetextmuted)]">
                    <th className="p-3">Week</th>
                    <th className="p-3 text-right">Opening Cash</th>
                    <th className="p-3 text-right">Operating Receipts (+)</th>
                    <th className="p-3 text-right">Operating Disbursements (-)</th>
                    <th className="p-3 text-right">Financing Flows (±)</th>
                    <th className="p-3 text-right">Closing Cash Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-oneborder)]">
                  {cashSchedule.map((week) => {
                    const isClosingNegative = week.closing_cash_minor < 0;
                    return (
                      <tr
                        key={week.week_label}
                        className={`hover:bg-[var(--color-onesurfacealt)] ${
                          isClosingNegative ? "bg-red-50/50 dark:bg-red-950/20" : ""
                        }`}
                      >
                        <td className="p-3 font-semibold text-[var(--color-onetext)]">
                          {week.week_label}
                        </td>
                        <td className="p-3 text-right font-mono">
                          <MoneyCell minor={week.opening_cash_minor} currency={currency} />
                        </td>
                        <td className="p-3 text-right font-mono text-green-700 dark:text-green-400">
                          <MoneyCell minor={week.receipts_minor} currency={currency} />
                        </td>
                        <td className="p-3 text-right font-mono text-red-700 dark:text-red-400">
                          <MoneyCell minor={week.disbursements_minor} currency={currency} />
                        </td>
                        <td className="p-3 text-right font-mono text-[var(--color-onetextsecondary)]">
                          <MoneyCell minor={week.financing_minor} currency={currency} />
                        </td>
                        <td
                          className={`p-3 text-right font-mono font-bold ${
                            isClosingNegative
                              ? "text-red-700 dark:text-red-400"
                              : "text-[var(--color-onetext)]"
                          }`}
                        >
                          <MoneyCell minor={week.closing_cash_minor} currency={currency} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Footstrip */}
              <div className="flex flex-wrap items-center justify-between border-t border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-3 text-xs font-medium">
                <div>Horizon: 13 Weeks Direct Cash</div>
                <div className="flex gap-6">
                  <span>
                    Initial Cash: <MoneyCell minor={openingCashMinor} currency={currency} />
                  </span>
                  <span>
                    Forecast Ending Cash (W13):{" "}
                    <MoneyCell minor={closingCashMinor} currency={currency} />
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 5. COVENANT GAUGES TAB */}
        {activeTab === "covenants" && (
          <section
            id="tabpanel-covenants"
            role="tabpanel"
            aria-labelledby="tab-covenants"
            className="space-y-6"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-[var(--color-onetext)]">
                  Lender Covenant Gauges & Compliance Monitoring
                </h2>
                <p className="text-xs text-[var(--color-onetextmuted)]">
                  Real-time ratio computation against credit agreement covenants.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="ltm-ebitda-input"
                  className="text-xs text-[var(--color-onetextsecondary)]"
                >
                  LTM EBITDA:
                </label>
                <input
                  id="ltm-ebitda-input"
                  type="number"
                  aria-label="LTM EBITDA"
                  value={ebitdaMinor / 100}
                  onChange={(e) => setEbitda(parseMajorToMinor(e.target.value))}
                  className="h-8 w-32 rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] px-2 font-mono text-sm"
                />
              </div>
            </div>

            {/* Gauge Cards Grid */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Net Debt / EBITDA Gauge */}
              <div
                className={`rounded-xl border p-6 shadow-sm transition-all ${
                  covenants.net_debt_breached
                    ? "border-red-500 bg-red-50/40 dark:border-red-800 dark:bg-red-950/20"
                    : "border-[var(--color-oneborder)] bg-[var(--color-onesurface)]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--color-onetext)]">
                    Leverage Ratio (Net Debt / EBITDA)
                  </h3>
                  {covenants.net_debt_breached ? (
                    <span className="flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700 dark:bg-red-900/60 dark:text-red-300">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      COVENANT BREACH
                    </span>
                  ) : (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/60 dark:text-green-300">
                      COMPLIANT
                    </span>
                  )}
                </div>

                <div className="mt-4 flex items-baseline gap-2">
                  <span
                    className={`font-mono text-4xl font-extrabold ${
                      covenants.net_debt_breached
                        ? "text-red-600 dark:text-red-400"
                        : "text-[var(--color-onetext)]"
                    }`}
                  >
                    {covenants.net_debt_to_ebitda}x
                  </span>
                  <span className="text-sm text-[var(--color-onetextmuted)]">
                    / Target: ≤ 3.50x
                  </span>
                </div>

                {/* Progress bar gauge */}
                <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className={`h-full transition-all duration-300 ${
                      covenants.net_debt_breached ? "bg-red-600" : "bg-green-500"
                    }`}
                    style={{
                      width: `${Math.min(100, parseRatioPercent(covenants.net_debt_to_ebitda))}%`,
                    }}
                    role="progressbar"
                    aria-valuenow={parseRatioNumber(covenants.net_debt_to_ebitda)}
                    aria-valuemin={0}
                    aria-valuemax={5}
                    aria-label="Net Debt to EBITDA progress gauge"
                  />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-xs border-t border-[var(--color-oneborder)] pt-3">
                  <div>
                    <span className="text-[var(--color-onetextmuted)]">Total Gross Debt:</span>
                    <p className="font-mono font-semibold">
                      <MoneyCell minor={covenants.total_debt_minor} currency={currency} />
                    </p>
                  </div>
                  <div>
                    <span className="text-[var(--color-onetextmuted)]">
                      Net Debt (Debt - Cash):
                    </span>
                    <p className="font-mono font-semibold">
                      <MoneyCell minor={covenants.net_debt_minor} currency={currency} />
                    </p>
                  </div>
                </div>
              </div>

              {/* Interest Cover Gauge */}
              <div
                className={`rounded-xl border p-6 shadow-sm transition-all ${
                  covenants.interest_cover_breached
                    ? "border-red-500 bg-red-50/40 dark:border-red-800 dark:bg-red-950/20"
                    : "border-[var(--color-oneborder)] bg-[var(--color-onesurface)]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--color-onetext)]">
                    Interest Cover (EBITDA / Interest)
                  </h3>
                  {covenants.interest_cover_breached ? (
                    <span className="flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700 dark:bg-red-900/60 dark:text-red-300">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      COVENANT BREACH
                    </span>
                  ) : (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/60 dark:text-green-300">
                      COMPLIANT
                    </span>
                  )}
                </div>

                <div className="mt-4 flex items-baseline gap-2">
                  <span
                    className={`font-mono text-4xl font-extrabold ${
                      covenants.interest_cover_breached
                        ? "text-red-600 dark:text-red-400"
                        : "text-[var(--color-onetext)]"
                    }`}
                  >
                    {covenants.interest_cover}x
                  </span>
                  <span className="text-sm text-[var(--color-onetextmuted)]">
                    / Target: ≥ 2.50x
                  </span>
                </div>

                {/* Progress bar gauge */}
                <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className={`h-full transition-all duration-300 ${
                      covenants.interest_cover_breached ? "bg-red-600" : "bg-green-500"
                    }`}
                    style={{
                      width: `${Math.min(100, parseRatioPercent(covenants.interest_cover))}%`,
                    }}
                    role="progressbar"
                    aria-valuenow={parseRatioNumber(covenants.interest_cover)}
                    aria-valuemin={0}
                    aria-valuemax={5}
                    aria-label="Interest Cover progress gauge"
                  />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-xs border-t border-[var(--color-oneborder)] pt-3">
                  <div>
                    <span className="text-[var(--color-onetextmuted)]">EBITDA:</span>
                    <p className="font-mono font-semibold">
                      <MoneyCell minor={covenants.ebitda_minor} currency={currency} />
                    </p>
                  </div>
                  <div>
                    <span className="text-[var(--color-onetextmuted)]">Annual Interest:</span>
                    <p className="font-mono font-semibold">
                      <MoneyCell minor={covenants.interest_expense_minor} currency={currency} />
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
