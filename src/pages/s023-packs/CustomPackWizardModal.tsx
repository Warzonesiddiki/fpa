/* eslint-disable react-refresh/only-export-components -- money-exact helpers are co-located with the screen until the money lane extracts them into their owner module */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input, Button } from "@/components/ui";
import { X, Check, Copy, Download } from "lucide-react";

export interface StarterCoaTemplate {
  key: string;
  name: string;
  description: string;
  accountCount: number;
  accounts: Array<{
    code: string;
    name: string;
    type: "revenue" | "cogs" | "opex" | "asset" | "liability" | "equity";
    section: string;
  }>;
}

export interface DriverOption {
  key: string;
  name: string;
  type: string;
  unit: string;
  default_method: string;
  description: string;
}

const STARTER_COA_TEMPLATES: StarterCoaTemplate[] = [
  {
    key: "standard_commercial",
    name: "Standard Commercial FP&A",
    description:
      "Standard revenue, cost of goods, opex, balance sheet items for operating businesses.",
    accountCount: 8,
    accounts: [
      { code: "4000", name: "Operating Revenue", type: "revenue", section: "Revenue" },
      { code: "4100", name: "Services & Other Income", type: "revenue", section: "Revenue" },
      { code: "5000", name: "Cost of Goods Sold", type: "cogs", section: "Cost of Sales" },
      { code: "6000", name: "Personnel & Payroll", type: "opex", section: "Operating Expenses" },
      {
        code: "6100",
        name: "Marketing & Acquisition",
        type: "opex",
        section: "Operating Expenses",
      },
      {
        code: "6200",
        name: "General & Administrative",
        type: "opex",
        section: "Operating Expenses",
      },
      { code: "1000", name: "Cash & Cash Equivalents", type: "asset", section: "Current Assets" },
      { code: "2000", name: "Accounts Payable", type: "liability", section: "Current Liabilities" },
    ],
  },
  {
    key: "saas_recurring",
    name: "SaaS & Subscription",
    description: "Tailored for subscription MRR/ARR, hosting cost of sales, R&D, and CAC metrics.",
    accountCount: 7,
    accounts: [
      { code: "4000", name: "Subscription ARR / MRR", type: "revenue", section: "Revenue" },
      { code: "4100", name: "Professional Services", type: "revenue", section: "Revenue" },
      {
        code: "5000",
        name: "Hosting & Cloud Infrastructure",
        type: "cogs",
        section: "Cost of Goods Sold",
      },
      { code: "6000", name: "Research & Development", type: "opex", section: "Operating Expenses" },
      { code: "6100", name: "Sales & Marketing", type: "opex", section: "Operating Expenses" },
      {
        code: "6200",
        name: "General & Administrative",
        type: "opex",
        section: "Operating Expenses",
      },
      { code: "2300", name: "Deferred Revenue", type: "liability", section: "Current Liabilities" },
    ],
  },
  {
    key: "inventory_retail",
    name: "Retail & Multi-Channel Inventory",
    description: "Built for goods, freight, shrinkage, channels, and store contribution margins.",
    accountCount: 7,
    accounts: [
      { code: "4000", name: "Retail Gross Sales", type: "revenue", section: "Gross Margin" },
      { code: "4050", name: "Returns & Allowances", type: "revenue", section: "Gross Margin" },
      {
        code: "5000",
        name: "Merchandise Cost of Sales",
        type: "cogs",
        section: "Cost of Goods Sold",
      },
      {
        code: "5100",
        name: "Inbound Freight & Logistics",
        type: "cogs",
        section: "Cost of Goods Sold",
      },
      { code: "6000", name: "Store Operations", type: "opex", section: "Operating Expenses" },
      { code: "1300", name: "Merchandise Inventory", type: "asset", section: "Current Assets" },
      { code: "2100", name: "Trade Payables", type: "liability", section: "Current Liabilities" },
    ],
  },
];

export const VALID_DRIVER_TYPES = [
  "volume_x_rate",
  "headcount",
  "growth",
  "seasonal",
  "spread",
  "ratio",
  "manual",
] as const;

export const VALID_DEFAULT_METHODS = [
  "manual",
  "static",
  "driver",
  "growth",
  "yoy",
  "seasonal",
  "spread",
] as const;

/** P&L section spine required in every COA export (INDUSTRY-PACK-SPEC §2). */
export const COA_PL_SECTIONS = [
  "Revenue",
  "COGS",
  "Gross Profit",
  "OpEx",
  "EBITDA",
  "Operating Income",
  "Pre-tax",
  "Net Income",
] as const;

export interface PackWizardMeta {
  packKey: string;
  packName: string;
  version: string;
  description: string;
  defaultCalendar: "12month" | "454" | "445" | "544" | "3334";
  defaultCurrency: string;
  localeHint: string;
}

export interface PackFileObjects {
  packJson: Record<string, unknown>;
  coaJson: Record<string, unknown>;
  driversJson: Record<string, unknown>;
  kpisJson: Record<string, unknown>;
  layoutsJson: Record<string, unknown>;
  glTemplateJson: Record<string, unknown>;
  rollupJson: Record<string, unknown>;
}

/**
 * Pure builder for the 7 pack files emitted by the Pack Builder (S-023).
 * Driver `type` values conform to INDUSTRY-PACK-SPEC §4 / GLOSSARY Driver
 * vocabulary; `default_method` values conform to MODELING-METHODS-SPEC §1.
 * COA exports always carry `sections`; KPI exports always carry `formula`
 * and `bands` (INDUSTRY-PACK-SPEC §§2–3).
 */
export function buildPackFileObjects(
  meta: PackWizardMeta,
  coaAccounts: Array<{
    code: string;
    name: string;
    type: string;
    section: string;
  }>,
  driverKeys: string[],
): PackFileObjects {
  const packKey = meta.packKey || "custom_pack";
  const currency = (meta.defaultCurrency || "USD").toUpperCase();
  const packJson = {
    schema_version: "1.0.0",
    pack: {
      key: packKey,
      name: meta.packName || "Custom Industry Pack",
      version: meta.version || "1.0.0",
      description:
        meta.description ||
        "Custom configured FP&A operational model pack with starter chart of accounts and driver templates.",
      default_calendar: meta.defaultCalendar,
      default_currency_hint: currency,
      locale_hint: meta.localeHint || "en-US",
    },
    coa_template: "coa.json",
    kpi_definitions: "kpis.json",
    driver_templates: "drivers.json",
    report_layouts: "layouts.json",
    gl_template: "gl_template.json",
    group_rollup_maps: "rollup.json",
  };

  const coaJson = {
    accounts: coaAccounts.map((a) => ({
      code: a.code,
      name: a.name,
      type: a.type,
      section: a.section,
      dimensions: [],
      is_control: false,
    })),
    sections: { pl: [...COA_PL_SECTIONS] },
  };

  const driversJson = {
    drivers: AVAILABLE_DRIVERS.filter((d) => driverKeys.includes(d.key)).map((d) => ({
      key: d.key,
      name: d.name,
      type: d.type,
      unit: d.unit,
      bounds: { low: "0", high: "1000000000" },
      default_method: d.default_method,
      links: [],
    })),
  };

  const kpisJson = {
    kpis: [
      {
        key: "gross_margin_pct",
        name: "Gross Margin %",
        unit: "%",
        formula: "gross_profit / revenue",
        target: { value: 38.0, direction: "gte" },
        definition: "Gross Profit / Revenue; explained in-app (D-008).",
        bands: { good: 35.0, watch: 25.0 },
      },
      {
        key: "ebitda_margin_pct",
        name: "EBITDA Margin %",
        unit: "%",
        formula: "ebitda / revenue",
        target: { value: 20.0, direction: "gte" },
        definition: "EBITDA / Revenue; explained in-app (D-008).",
        bands: { good: 20.0, watch: 10.0 },
      },
      {
        key: "revenue_growth_pct",
        name: "Revenue Growth %",
        unit: "%",
        formula: "(revenue - revenue_py) / revenue_py",
        target: { value: 10.0, direction: "gte" },
        definition: "Year-over-year revenue growth; explained in-app (D-008).",
        bands: { good: 10.0, watch: 0.0 },
      },
      {
        key: "opex_ratio_pct",
        name: "OpEx Ratio %",
        unit: "%",
        formula: "opex / revenue",
        target: { value: 30.0, direction: "lte" },
        definition: "OpEx / Revenue; explained in-app (D-008).",
        bands: { good: 30.0, watch: 40.0 },
      },
    ],
  };

  const layoutsJson = {
    layouts: [
      {
        key: `${packKey}_pl`,
        name: `${meta.packName || "Custom"} P&L (000s)`,
        rows: ["revenue", "cogs", "gross_profit", "opex", "ebitda"],
        columns: [{ type: "ytd" }, { type: "variance", compare: "budget" }],
        format: { "000s": true, negative: "paren", decimals: 0 },
      },
    ],
  };

  const glTemplateJson = {
    columns: {
      period: "YYYY-MM",
      account_code: "code",
      amount: "signed",
      business_unit: "bu",
      currency: "ISO",
    },
    note: "Map the source dump columns here (one click per Industry Pack baseline mapping).",
  };

  const rollupJson = {
    maps: [],
    default_currency: currency,
  };

  return {
    packJson,
    coaJson,
    driversJson,
    kpisJson,
    layoutsJson,
    glTemplateJson,
    rollupJson,
  };
}

const AVAILABLE_DRIVERS: DriverOption[] = [
  {
    key: "volume_x_rate",
    name: "Units × Average Price (Volume × Rate)",
    type: "volume_x_rate",
    unit: "units",
    default_method: "seasonal",
    description: "Projects gross revenue based on sold volume units multiplied by price per unit.",
  },
  {
    key: "headcount_cost",
    name: "Headcount × Average Loaded Salary",
    type: "headcount",
    unit: "currency",
    default_method: "growth",
    description:
      "Computes personnel expense using department FTE counts and fully-burdened compensation.",
  },
  {
    key: "retention_rate",
    name: "Net Revenue Retention / Churn Rate",
    type: "ratio",
    unit: "%",
    default_method: "seasonal",
    description:
      "Models cohort decay, recurring retention, and expansion revenue over the fiscal periods.",
  },
  {
    key: "marketing_cac",
    name: "Customer Acquisition Cost (CAC)",
    type: "ratio",
    unit: "currency",
    default_method: "manual",
    description: "Relates paid marketing spend to new logos acquired per monthly/quarterly cycle.",
  },
  {
    key: "working_capital_dso",
    name: "Days Sales Outstanding (DSO)",
    type: "ratio",
    unit: "days",
    default_method: "seasonal",
    description:
      "Determines accounts receivable balances and collection cash inflows from revenue.",
  },
];

interface CustomPackWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CustomPackWizardModal({ isOpen, onClose }: CustomPackWizardModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1: Metadata
  const [packName, setPackName] = useState("");
  const [packKey, setPackKey] = useState("");
  const [industry, setIndustry] = useState("Technology");
  const [version, setVersion] = useState("1.0.0");
  const [description, setDescription] = useState("");
  const [defaultCalendar, setDefaultCalendar] = useState<
    "12month" | "454" | "445" | "544" | "3334"
  >("12month");
  const [defaultCurrency, setDefaultCurrency] = useState("USD");
  const [localeHint, setLocaleHint] = useState("en-US");

  // Step 2: Starter COA
  const [selectedCoaKey, setSelectedCoaKey] = useState<string>("standard_commercial");

  // Step 3: Default Drivers
  const [selectedDrivers, setSelectedDrivers] = useState<string[]>([
    "volume_x_rate",
    "headcount_cost",
  ]);

  // Step 4: Export state
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const toggleDriver = (driverKey: string) => {
    setSelectedDrivers((prev) =>
      prev.includes(driverKey) ? prev.filter((k) => k !== driverKey) : [...prev, driverKey],
    );
  };

  const sanitizeKey = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^[0-9]/, "pack_$&");
  };

  const selectedTemplate =
    STARTER_COA_TEMPLATES.find((c) => c.key === selectedCoaKey) ?? STARTER_COA_TEMPLATES[0];

  const packJsonObject = {
    schema_version: "1.0.0",
    pack: {
      key: packKey || sanitizeKey(packName) || "custom_pack",
      name: packName || "Custom Industry Pack",
      version: version || "1.0.0",
      description:
        description ||
        "Custom configured FP&A operational model pack with starter chart of accounts and driver templates.",
      default_calendar: defaultCalendar,
      default_currency_hint: defaultCurrency.toUpperCase(),
      locale_hint: localeHint,
    },
    coa_template: "coa.json",
    kpi_definitions: "kpis.json",
    driver_templates: "drivers.json",
    report_layouts: "layouts.json",
    gl_template: "gl_template.json",
    group_rollup_maps: "rollup.json",
  };

  const driversJsonObject = {
    drivers: AVAILABLE_DRIVERS.filter((d) => selectedDrivers.includes(d.key)).map((d) => ({
      key: d.key,
      name: d.name,
      type: d.type,
      unit: d.unit,
      bounds: { low: "0", high: "1000000000" },
      default_method: d.default_method,
      links: [],
    })),
  };

  const coaJsonObject = {
    accounts: selectedTemplate.accounts.map((a) => ({
      code: a.code,
      name: a.name,
      type: a.type,
      section: a.section,
      dimensions: [],
      is_control: false,
    })),
  };

  const jsonString = JSON.stringify(packJsonObject, null, 2);

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      setCopied(false);
    }
  };

  const handleDownloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const canProceedFromStep1 =
    packName.trim().length >= 2 &&
    description.trim().length >= 10 &&
    /^\d+\.\d+\.\d+$/.test(version.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t("common.close")}
        tabIndex={-1}
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pack-builder-title"
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-oneborder)] px-6 py-4">
          <div>
            <h2
              id="pack-builder-title"
              className="text-lg font-semibold text-[var(--color-onetext)]"
            >
              {t("packs.builder.title")}
            </h2>
            <p className="text-xs text-[var(--color-onetextsecondary)]">{t("packs.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-md p-1 text-[var(--color-onetextmuted)] hover:bg-[var(--color-onesurfacealt)] hover:text-[var(--color-onetext)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Wizard Step Indicator */}
        <div className="flex border-b border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] px-6 py-2 text-xs font-medium">
          <button
            type="button"
            onClick={() => setStep(1)}
            className={`flex-1 py-1 text-center border-b-2 transition-colors ${
              step === 1
                ? "border-[var(--color-oneprimary)] text-[var(--color-oneprimary)] font-semibold"
                : "border-transparent text-[var(--color-onetextsecondary)]"
            }`}
          >
            {t("packs.builder.step1")}
          </button>
          <button
            type="button"
            onClick={() => {
              if (canProceedFromStep1) setStep(2);
            }}
            disabled={!canProceedFromStep1}
            className={`flex-1 py-1 text-center border-b-2 transition-colors disabled:opacity-40 ${
              step === 2
                ? "border-[var(--color-oneprimary)] text-[var(--color-oneprimary)] font-semibold"
                : "border-transparent text-[var(--color-onetextsecondary)]"
            }`}
          >
            {t("packs.builder.step2")}
          </button>
          <button
            type="button"
            onClick={() => {
              if (canProceedFromStep1) setStep(3);
            }}
            disabled={!canProceedFromStep1}
            className={`flex-1 py-1 text-center border-b-2 transition-colors disabled:opacity-40 ${
              step === 3
                ? "border-[var(--color-oneprimary)] text-[var(--color-oneprimary)] font-semibold"
                : "border-transparent text-[var(--color-onetextsecondary)]"
            }`}
          >
            {t("packs.builder.step3")}
          </button>
          <button
            type="button"
            onClick={() => {
              if (canProceedFromStep1) setStep(4);
            }}
            disabled={!canProceedFromStep1}
            className={`flex-1 py-1 text-center border-b-2 transition-colors disabled:opacity-40 ${
              step === 4
                ? "border-[var(--color-oneprimary)] text-[var(--color-oneprimary)] font-semibold"
                : "border-transparent text-[var(--color-onetextsecondary)]"
            }`}
          >
            {t("packs.builder.step4")}
          </button>
        </div>

        {/* Wizard Content Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label={t("packs.builder.name")}
                  value={packName}
                  onChange={(e) => {
                    setPackName(e.target.value);
                    if (!packKey) {
                      setPackKey(sanitizeKey(e.target.value));
                    }
                  }}
                  placeholder={t("packs.builder.namePlaceholder")}
                  required
                />
                <Input
                  label={t("packs.builder.key")}
                  value={packKey}
                  onChange={(e) => setPackKey(sanitizeKey(e.target.value))}
                  placeholder={t("packs.builder.keyPlaceholder")}
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-onetextsecondary)]">
                  {t("packs.builder.industry")}
                  <select
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="h-10 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 text-sm text-[var(--color-onetext)]"
                  >
                    <option value="Technology">Technology & SaaS</option>
                    <option value="Manufacturing">Manufacturing</option>
                    <option value="Retail">Retail & E-Commerce</option>
                    <option value="Healthcare">Healthcare & Bio</option>
                    <option value="Financial">Financial Services</option>
                    <option value="Other">Custom / General</option>
                  </select>
                </label>
                <Input
                  label={t("packs.builder.version")}
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="1.0.0"
                  required
                />
                <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-onetextsecondary)]">
                  {t("packs.builder.defaultCalendar")}
                  <select
                    value={defaultCalendar}
                    onChange={(e) =>
                      setDefaultCalendar(
                        e.target.value as "12month" | "454" | "445" | "544" | "3334",
                      )
                    }
                    className="h-10 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 text-sm text-[var(--color-onetext)]"
                  >
                    <option value="12month">12 Months (Standard)</option>
                    <option value="454">Retail 4-5-4 (NRF)</option>
                    <option value="445">Fiscal 4-4-5</option>
                    <option value="544">Fiscal 5-4-4</option>
                    <option value="3334">13 Periods (3-3-3-4)</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label={t("packs.builder.defaultCurrency")}
                  value={defaultCurrency}
                  onChange={(e) => setDefaultCurrency(e.target.value.toUpperCase())}
                  placeholder="USD"
                  maxLength={3}
                  required
                />
                <Input
                  label={t("packs.builder.localeHint")}
                  value={localeHint}
                  onChange={(e) => setLocaleHint(e.target.value)}
                  placeholder="en-US"
                  required
                />
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--color-onetextsecondary)]">
                  {t("packs.builder.description")}
                </span>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("packs.builder.descriptionPlaceholder")}
                  className="w-full rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-2 text-sm text-[var(--color-onetext)] outline-none focus:border-[var(--color-oneprimary)]"
                />
                {description.trim().length > 0 && description.trim().length < 10 && (
                  <span className="text-[11px] text-[var(--color-onerror)]">
                    Description must be at least 10 characters ({description.trim().length}/10).
                  </span>
                )}
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-onetext)]">
                  {t("packs.builder.coaSelect")}
                </h3>
                <p className="text-xs text-[var(--color-onetextsecondary)]">
                  {t("packs.builder.coaDescription")}
                </p>
              </div>

              <div className="space-y-3">
                {STARTER_COA_TEMPLATES.map((tmpl) => {
                  const isSelected = selectedCoaKey === tmpl.key;
                  return (
                    <button
                      key={tmpl.key}
                      type="button"
                      onClick={() => setSelectedCoaKey(tmpl.key)}
                      aria-pressed={isSelected}
                      className={`w-full rounded-lg border p-4 text-left transition-colors ${
                        isSelected
                          ? "border-[var(--color-oneprimary)] bg-[var(--color-oneprimary)]/5"
                          : "border-[var(--color-oneborder)] bg-[var(--color-onesurface)] hover:border-[var(--color-oneprimary)]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-[var(--color-onetext)]">
                          {tmpl.name}
                        </span>
                        <span className="rounded-full bg-[var(--color-onesurfacealt)] px-2 py-0.5 text-xs text-[var(--color-onetextsecondary)]">
                          {tmpl.accountCount} starter accounts
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--color-onetextsecondary)]">
                        {tmpl.description}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {tmpl.accounts.slice(0, 4).map((a) => (
                          <span
                            key={a.code}
                            className="rounded bg-[var(--color-onesurfacealt)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--color-onetextmuted)]"
                          >
                            {a.code} {a.name}
                          </span>
                        ))}
                        {tmpl.accounts.length > 4 && (
                          <span className="text-[10px] text-[var(--color-onetextmuted)] self-center">
                            +{tmpl.accounts.length - 4} more
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-onetext)]">
                  {t("packs.builder.driversTitle")}
                </h3>
                <p className="text-xs text-[var(--color-onetextsecondary)]">
                  {t("packs.builder.driversDescription")}
                </p>
              </div>

              <div className="space-y-2">
                {AVAILABLE_DRIVERS.map((driver) => {
                  const checked = selectedDrivers.includes(driver.key);
                  return (
                    <label
                      key={driver.key}
                      htmlFor={`driver-toggle-${driver.key}`}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                        checked
                          ? "border-[var(--color-oneprimary)] bg-[var(--color-oneprimary)]/5"
                          : "border-[var(--color-oneborder)] bg-[var(--color-onesurface)] hover:border-[var(--color-oneborder)]"
                      }`}
                    >
                      <input
                        id={`driver-toggle-${driver.key}`}
                        type="checkbox"
                        aria-label={driver.name}
                        checked={checked}
                        onChange={() => toggleDriver(driver.key)}
                        className="mt-1 h-4 w-4 rounded border-[var(--color-oneborder)] text-[var(--color-oneprimary)] focus:ring-[var(--color-oneprimary)]"
                      />
                      <div className="flex-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm text-[var(--color-onetext)]">
                            {driver.name}
                          </span>
                          <span className="rounded bg-[var(--color-onesurfacealt)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-onetextmuted)]">
                            {driver.unit} · {driver.default_method}
                          </span>
                        </div>
                        <p className="mt-1 text-[var(--color-onetextsecondary)]">
                          {driver.description}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-onetext)]">
                  {t("packs.builder.reviewTitle")}
                </h3>
                <p className="text-xs text-[var(--color-onetextsecondary)]">
                  Schema-validated v1.0.0 pack manifest ready to bundle or import.
                </p>
              </div>

              <div className="rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-3 text-xs space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="font-medium text-[var(--color-onetextmuted)]">Name:</span>{" "}
                    <span className="font-semibold text-[var(--color-onetext)]">
                      {packJsonObject.pack.name}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-[var(--color-onetextmuted)]">Key:</span>{" "}
                    <span className="font-mono text-[var(--color-onetext)]">
                      {packJsonObject.pack.key}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-[var(--color-onetextmuted)]">Industry:</span>{" "}
                    <span className="text-[var(--color-onetext)]">{industry}</span>
                  </div>
                  <div>
                    <span className="font-medium text-[var(--color-onetextmuted)]">Version:</span>{" "}
                    <span className="font-mono text-[var(--color-onetext)]">
                      v{packJsonObject.pack.version}
                    </span>
                  </div>
                </div>
                <div className="border-t border-[var(--color-oneborder)] pt-2 text-[var(--color-onetextsecondary)]">
                  <span className="font-medium text-[var(--color-onetextmuted)]">
                    COA Template:
                  </span>{" "}
                  {selectedTemplate.name} ({selectedTemplate.accountCount} accounts)
                </div>
                <div>
                  <span className="font-medium text-[var(--color-onetextmuted)]">Drivers:</span>{" "}
                  {selectedDrivers.length} driver template(s) enabled
                </div>
              </div>

              <div className="relative">
                <pre className="max-h-48 overflow-x-auto rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-3 font-mono text-xs text-[var(--color-onetext)]">
                  {jsonString}
                </pre>
                <button
                  type="button"
                  onClick={() => void handleCopyJson()}
                  className="absolute right-2 top-2 flex items-center gap-1 rounded bg-[var(--color-onesurfacealt)] px-2 py-1 text-xs text-[var(--color-onetextsecondary)] hover:text-[var(--color-onetext)]"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-[var(--color-onefavorable)]" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? t("packs.builder.copied") : t("packs.builder.exportJson")}
                </button>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleDownloadFile("pack.json", jsonString)}
                >
                  <Download className="mr-1 h-4 w-4" />
                  {t("packs.builder.download")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    handleDownloadFile("coa.json", JSON.stringify(coaJsonObject, null, 2))
                  }
                >
                  <Download className="mr-1 h-4 w-4" />
                  {t("packs.builder.downloadCoa")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    handleDownloadFile("drivers.json", JSON.stringify(driversJsonObject, null, 2))
                  }
                >
                  <Download className="mr-1 h-4 w-4" />
                  {t("packs.builder.downloadDrivers")}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="flex items-center justify-between border-t border-[var(--color-oneborder)] px-6 py-4">
          {step > 1 ? (
            <Button variant="secondary" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3 | 4)}>
              {t("common.back")}
            </Button>
          ) : (
            <div />
          )}

          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>

            {step < 4 ? (
              <Button
                variant="primary"
                disabled={step === 1 && !canProceedFromStep1}
                onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3 | 4)}
              >
                {t("common.next")}
              </Button>
            ) : (
              <Button variant="primary" onClick={onClose}>
                {t("common.success")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
