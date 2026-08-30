#!/usr/bin/env node
/**
 * dev-only generator for the 12 bundled Industry Pack seeds (M0-4).
 * Output is committed DATA (packs/); industry content per INDUSTRY-PACK-SPEC §10.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const P = {
  saas: {
    name: "SaaS / Tech",
    calendar: "12month",
    currency: "USD",
    locale: "en-US",
    coa: [
      ["4000", "Subscription Revenue", "revenue", "Revenue"],
      ["4100", "Professional Services", "revenue", "Revenue"],
      ["5000", "R&D Expense", "opex", "OpEx"],
      ["5100", "S&M Expense", "opex", "OpEx"],
      ["5300", "G&A Expense", "opex", "OpEx"],
      ["1200", "Accounts Receivable", "asset", "Current Assets"],
      ["2300", "Deferred Revenue", "liability", "Current Liabilities"],
    ],
    kpis: [
      ["nrr", "Net Revenue Retention %", "nrr_pct", 115],
      ["burn", "Burn Multiple", "burn_x", 1.2],
      ["cac_payback", "CAC Payback (months)", "months", 18],
      ["arr", "Annual Recurring Revenue", "money", 12000000],
    ],
    drivers: [
      ["reps_quota", "Reps × quota", "volume_x_rate", "units"],
      ["churn", "Churn %", "ratio", "%"],
      ["arpu", "ARPU", "manual", "money"],
    ],
  },
  manufacturing: {
    name: "Manufacturing",
    calendar: "12month",
    currency: "USD",
    locale: "en-US",
    coa: [
      ["4000", "Sales Revenue", "revenue", "Revenue"],
      ["4100", "Direct Materials", "cogs", "COGS"],
      ["4200", "Direct Labor", "cogs", "COGS"],
      ["4300", "Manufacturing Overhead", "cogs", "COGS"],
      ["5000", "Salaries & Wages", "opex", "OpEx"],
      ["5100", "Rent", "opex", "OpEx"],
      ["1200", "Accounts Receivable", "asset", "Current Assets"],
      ["1300", "Inventory", "asset", "Current Assets"],
    ],
    kpis: [
      ["inventory_turns", "Inventory Turns", "x", 6.0],
      ["oee", "OEE %", "pct", 78.0],
      ["cost_variance", "Standard Cost Variance %", "pct", 2.0],
      ["gross_margin_pct", "Gross Margin %", "pct", 38.0],
    ],
    drivers: [
      ["units", "Units produced", "volume_x_rate", "units"],
      ["scrap_pct", "Scrap %", "ratio", "%"],
      ["material_price", "Material price index", "manual", "index"],
    ],
  },
  retail: {
    name: "Retail",
    calendar: "454",
    currency: "USD",
    locale: "en-US",
    coa: [
      ["4000", "Retail Sales", "revenue", "Revenue"],
      ["4100", "Cost of Goods Sold", "cogs", "COGS"],
      ["4300", "Shrinkage", "cogs", "COGS"],
      ["5000", "Store Payroll", "opex", "OpEx"],
      ["5100", "Store Occupancy", "opex", "OpEx"],
      ["1200", "Accounts Receivable", "asset", "Current Assets"],
      ["1300", "Inventory", "asset", "Current Assets"],
    ],
    kpis: [
      ["same_store", "Same-Store Sales %", "pct", 3.5],
      ["gmroi", "GMROI", "x", 2.2],
      ["footfall_conversion", "Conversion %", "pct", 24.0],
      ["inventory_turns", "Inventory Turns", "x", 4.0],
    ],
    drivers: [
      ["footfall", "Footfall", "volume_x_rate", "visitors"],
      ["conversion", "Conversion %", "ratio", "%"],
      ["aov", "Average Order Value", "manual", "money"],
    ],
  },
  healthcare: {
    name: "Healthcare",
    calendar: "12month",
    currency: "USD",
    locale: "en-US",
    coa: [
      ["4000", "Patient Service Revenue", "revenue", "Revenue"],
      ["4100", "Cost of Care", "cogs", "COGS"],
      ["5000", "Clinical Salaries", "opex", "OpEx"],
      ["5100", "Facilities", "opex", "OpEx"],
      ["1200", "Patient AR", "asset", "Current Assets"],
      ["2100", "Accrued Liabilities", "liability", "Current Liabilities"],
    ],
    kpis: [
      ["cost_per_patient", "Cost per Patient", "money", 2400],
      ["days_ar", "Net Days in AR", "days", 42],
      ["denial_rate", "Denial Rate %", "pct", 8.0],
      ["payer_mix_pct", "Payer Mix (commercial) %", "pct", 55.0],
    ],
    drivers: [
      ["volume", "Patient volume", "volume_x_rate", "visits"],
      ["length_of_stay", "Length of stay", "manual", "days"],
      ["reimbursement", "Avg reimbursement", "manual", "money"],
    ],
  },
  construction: {
    name: "Construction",
    calendar: "12month",
    currency: "USD",
    locale: "en-US",
    coa: [
      ["4000", "Contract Revenue", "revenue", "Revenue"],
      ["4100", "Cost of Contracts", "cogs", "COGS"],
      ["5000", "Project Overhead", "opex", "OpEx"],
      ["1300", "WIP", "asset", "Current Assets"],
      ["2000", "Billings in Excess", "liability", "Current Liabilities"],
      ["2100", "Retainage Payable", "liability", "Current Liabilities"],
    ],
    kpis: [
      ["backlog", "Backlog (months)", "months", 9],
      ["over_under_billing", "Over/Under Billing", "money", 250000],
      ["cost_to_cost_pct", "Cost-to-Cost % Complete", "pct", 45.0],
      ["gross_margin_pct", "Gross Margin %", "pct", 18.0],
    ],
    drivers: [
      ["contract_pct", "Contract % complete", "ratio", "%"],
      ["costs_to_date", "Costs to date", "manual", "money"],
      ["labor_rate", "Labor rate", "manual", "money"],
    ],
  },
  "professional-services": {
    name: "Professional Services",
    calendar: "12month",
    currency: "USD",
    locale: "en-US",
    coa: [
      ["4000", "Billable Revenue", "revenue", "Revenue"],
      ["5000", "Salaries", "opex", "OpEx"],
      ["5100", "Subcontractors", "opex", "OpEx"],
      ["5200", "Travel", "opex", "OpEx"],
      ["1200", "Accounts Receivable", "asset", "Current Assets"],
      ["2100", "Accrued Payroll", "liability", "Current Liabilities"],
    ],
    kpis: [
      ["utilization", "Utilization %", "pct", 72.0],
      ["rev_per_fte", "Revenue per FTE", "money", 210000],
      ["dso", "Days Sales Outstanding", "days", 45],
      ["pipeline", "Pipeline coverage", "x", 3.0],
    ],
    drivers: [
      ["fte", "FTEs", "headcount", "count"],
      ["rate", "Billable rate", "manual", "money"],
      ["utilization", "Utilization %", "ratio", "%"],
    ],
  },
  nonprofit: {
    name: "Nonprofit",
    calendar: "12month",
    currency: "USD",
    locale: "en-US",
    coa: [
      ["4000", "Contributions", "revenue", "Revenue"],
      ["4100", "Government Grants", "revenue", "Revenue"],
      ["5000", "Program Services", "opex", "OpEx"],
      ["5100", "Fundraising", "opex", "OpEx"],
      ["5200", "Management & General", "opex", "OpEx"],
      ["1200", "Pledges Receivable", "asset", "Current Assets"],
    ],
    kpis: [
      ["program_ratio", "Program Ratio %", "pct", 75.0],
      ["donor_retention", "Donor Retention %", "pct", 60.0],
      ["cost_per_dollar", "Cost per $ Raised", "money", 0.18],
      ["grant_coverage", "Grant Coverage (months)", "months", 6],
    ],
    drivers: [
      ["donors", "Donors", "volume_x_rate", "count"],
      ["avg_gift", "Average gift", "manual", "money"],
      ["grant_renewal", "Grant renewal %", "ratio", "%"],
    ],
  },
  government: {
    name: "Government",
    calendar: "12month",
    currency: "USD",
    locale: "en-US",
    coa: [
      ["4000", "Appropriations", "revenue", "Revenue"],
      ["4100", "Fees & Permits", "revenue", "Revenue"],
      ["5000", "Personnel", "opex", "OpEx"],
      ["5100", "Programs", "opex", "OpEx"],
      ["1200", "Grants Receivable", "asset", "Current Assets"],
      ["2300", "Encumbrances", "liability", "Current Liabilities"],
    ],
    kpis: [
      ["budget_execution", "Budget Execution %", "pct", 92.0],
      ["encumbrance", "Encumbrance %", "pct", 12.0],
      ["program_spend", "Program Spend %", "pct", 68.0],
      ["timely_close", "Timely Close %", "pct", 90.0],
    ],
    drivers: [
      ["appropriation", "Appropriation", "manual", "money"],
      ["allocation", "Allocation %", "ratio", "%"],
      ["fte", "FTEs", "headcount", "count"],
    ],
  },
  energy: {
    name: "Energy",
    calendar: "12month",
    currency: "USD",
    locale: "en-US",
    coa: [
      ["4000", "Energy Sales", "revenue", "Revenue"],
      ["4100", "Cost of Energy", "cogs", "COGS"],
      ["5000", "Grid O&M", "opex", "OpEx"],
      ["1700", "Plant & Equipment", "asset", "Non-current Assets"],
      ["2000", "Accounts Payable", "liability", "Current Liabilities"],
    ],
    kpis: [
      ["tariff_recovery", "Tariff Recovery %", "pct", 97.0],
      ["availability", "Plant Availability %", "pct", 88.0],
      ["cost_per_mwh", "Cost per MWh", "money", 42],
      ["hedge_ratio", "Hedge Ratio %", "pct", 70.0],
    ],
    drivers: [
      ["volume_mwh", "Volume (MWh)", "volume_x_rate", "MWh"],
      ["tariff", "Tariff", "manual", "money"],
      ["weather", "Weather adjustment", "ratio", "index"],
    ],
  },
  "financial-services": {
    name: "Financial Services",
    calendar: "12month",
    currency: "USD",
    locale: "en-US",
    coa: [
      ["4000", "Interest Income", "revenue", "Revenue"],
      ["4100", "Fee Income", "revenue", "Revenue"],
      ["5000", "Interest Expense", "opex", "OpEx"],
      ["5100", "Staff Costs", "opex", "OpEx"],
      ["1200", "Loans & Advances", "asset", "Current Assets"],
      ["2000", "Customer Deposits", "liability", "Current Liabilities"],
    ],
    kpis: [
      ["nim", "Net Interest Margin %", "pct", 3.2],
      ["mlr", "Medical Loss Ratio (insurance) %", "pct", 82.0],
      ["loss_ratio", "Loss Ratio %", "pct", 62.0],
      ["cost_income", "Cost/Income %", "pct", 58.0],
    ],
    drivers: [
      ["aum", "Assets under management", "manual", "money"],
      ["nim", "Net interest margin", "ratio", "%"],
      ["claims", "Claims frequency", "ratio", "x"],
    ],
  },
  logistics: {
    name: "Logistics",
    calendar: "12month",
    currency: "USD",
    locale: "en-US",
    coa: [
      ["4000", "Freight Revenue", "revenue", "Revenue"],
      ["4100", "Fuel", "cogs", "COGS"],
      ["5000", "Driver Payroll", "opex", "OpEx"],
      ["5100", "Maintenance", "opex", "OpEx"],
      ["1700", "Fleet", "asset", "Non-current Assets"],
      ["2000", "Accounts Payable", "liability", "Current Liabilities"],
    ],
    kpis: [
      ["cost_per_mile", "Cost per Mile", "money", 1.85],
      ["dso", "Days Sales Outstanding", "days", 38],
      ["fleet_util", "Fleet Utilization %", "pct", 82.0],
      ["on_time", "On-Time Delivery %", "pct", 94.0],
    ],
    drivers: [
      ["miles", "Loaded miles", "volume_x_rate", "miles"],
      ["fuel_price", "Fuel price", "manual", "money"],
      ["utilization", "Fleet utilization %", "ratio", "%"],
    ],
  },
  "real-estate": {
    name: "Real Estate",
    calendar: "12month",
    currency: "USD",
    locale: "en-US",
    coa: [
      ["4000", "Rental Income", "revenue", "Revenue"],
      ["4100", "Property Expenses", "opex", "OpEx"],
      ["4200", "Mortgage Interest", "opex", "OpEx"],
      ["1700", "Investment Properties", "asset", "Non-current Assets"],
      ["2000", "Mortgages Payable", "liability", "Non-current Liabilities"],
    ],
    kpis: [
      ["noi", "Net Operating Income", "money", 3800000],
      ["cap_rate", "Cap Rate %", "pct", 6.5],
      ["occupancy", "Occupancy %", "pct", 92.0],
      ["rent_roll", "Rent Roll", "money", 9200000],
    ],
    drivers: [
      ["occupancy", "Occupancy %", "ratio", "%"],
      ["rent_psi", "Rent per sq ft", "manual", "money"],
      ["capex", "Capex per property", "manual", "money"],
    ],
  },
};

for (const [key, p] of Object.entries(P)) {
  const dir = join("packs", key);
  mkdirSync(dir, { recursive: true });
  const coa = {
    accounts: p.coa.map(([code, name, type, section], i) => ({
      code,
      name,
      type,
      section,
      dimensions: [],
      is_control: i < 5,
    })),
  };
  const kpis = {
    kpis: p.kpis.map(([key, name, unit, target]) => ({
      key,
      name,
      unit,
      target: { value: target, direction: "gte" },
      definition: `${name} — rendered in the in-app KPI explainer (D-008) with formula and bounds.`,
    })),
  };
  const drivers = {
    drivers: p.drivers.map(([key, name, type, unit]) => ({
      key,
      name,
      type,
      unit,
      bounds: { low: "0", high: "1000000000" },
      default_method: type === "manual" ? "manual" : "seasonal",
      links: [],
    })),
  };
  const layouts = {
    layouts: [
      {
        key: `${key}_pl`,
        name: `${p.name} P&L (000s)`,
        rows: ["revenue", "cogs", "gross_profit", "opex", "ebitda"],
        columns: [{ type: "ytd" }, { type: "variance", compare: "budget" }],
        format: { "000s": true, negative: "paren", decimals: 0 },
      },
    ],
  };
  const gl = {
    columns: {
      period: "YYYY-MM",
      account_code: "code",
      amount: "signed",
      business_unit: "bu",
      currency: "ISO",
    },
    note: "Map the source dump columns here (one click per Industry Pack baseline mapping).",
  };
  const rollup = { maps: [], default_currency: p.currency };

  writeFileSync(
    join(dir, "pack.json"),
    JSON.stringify(
      {
        schema_version: "1.0.0",
        pack: {
          key,
          name: p.name,
          version: "2.1.0",
          description: `${p.name} Industry Pack — COA, KPIs, Drivers, Layouts. Data only (B15).`,
          default_calendar: p.calendar,
          default_currency_hint: p.currency,
          locale_hint: p.locale,
        },
        coa_template: "coa.json",
        kpi_definitions: "kpis.json",
        driver_templates: "drivers.json",
        report_layouts: "layouts.json",
        gl_template: "gl_template.json",
        group_rollup_maps: "rollup.json",
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(join(dir, "coa.json"), JSON.stringify(coa, null, 2) + "\n");
  writeFileSync(join(dir, "kpis.json"), JSON.stringify(kpis, null, 2) + "\n");
  writeFileSync(join(dir, "drivers.json"), JSON.stringify(drivers, null, 2) + "\n");
  writeFileSync(join(dir, "layouts.json"), JSON.stringify(layouts, null, 2) + "\n");
  writeFileSync(join(dir, "gl_template.json"), JSON.stringify(gl, null, 2) + "\n");
  writeFileSync(join(dir, "rollup.json"), JSON.stringify(rollup, null, 2) + "\n");
}
console.log(`gen-packs OK — ${Object.keys(P).length}/12 packs written`);
