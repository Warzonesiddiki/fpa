/* eslint-disable react-refresh/only-export-components -- money-exact helpers are co-located with the screen until the money lane extracts them into their owner module */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Factory, Package, TrendingUp, Boxes } from "lucide-react";
import { Button, Card, StatePanel, MoneyCell } from "@/components/ui";
import Decimal from "decimal.js";

/**
 * S-047 Production & Backlog (/model/production)
 * F-018 production/inventory plan + backlog/pipeline.
 *
 * Elements:
 * - Production plan table (product, units, scrap %, material cost, BOM lines)
 * - Inventory build (units, value -> BS)
 * - Backlog/pipeline table (contract/customer, value, % complete, expected timing, POC method)
 * - Recognition preview
 *
 * Canonical 5 states: loading, empty, error, success, populated.
 */

export interface ProductionItem {
  id: string;
  product: string;
  units: number;
  scrapPct: number;
  materialCostMinor: number;
  bomLines: number;
}

export interface BacklogItem {
  id: string;
  contract: string;
  customer: string;
  valueMinor: number;
  pctComplete: number;
  timing: string;
  pocMethod: "input" | "output";
}

type ScreenPhase = "loading" | "empty" | "populated" | "error" | "success";

/**
 * Earned (POC) revenue in integer minor units.
 * Exact decimal per MONEY-ROUNDING-SPEC §3: compute in decimal.js (28-digit),
 * round to Currency Scale (minor units) with HALF_UP only at the commit boundary.
 * String construction avoids binary-float drift (0.1+0.2 edge); never Math.floor.
 */
export function earnedRevenueMinor(valueMinor: number, pctComplete: number): number {
  return new Decimal(String(valueMinor))
    .mul(new Decimal(String(pctComplete)))
    .div(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

const INITIAL_PRODUCTION: ProductionItem[] = [
  {
    id: "prod-1",
    product: "Enterprise Core Unit",
    units: 1200,
    scrapPct: 2,
    materialCostMinor: 450000,
    bomLines: 24,
  },
  {
    id: "prod-2",
    product: "Sensor Array Module",
    units: 3500,
    scrapPct: 1,
    materialCostMinor: 125000,
    bomLines: 12,
  },
];

const INITIAL_BACKLOG: BacklogItem[] = [
  {
    id: "back-1",
    contract: "CT-2026-081",
    customer: "Global Logistics Corp",
    valueMinor: 150000000,
    pctComplete: 65,
    timing: "2026-Q3",
    pocMethod: "input",
  },
  {
    id: "back-2",
    contract: "CT-2026-094",
    customer: "AeroTech Dynamics",
    valueMinor: 85000000,
    pctComplete: 30,
    timing: "2026-Q4",
    pocMethod: "output",
  },
];

export function ProductionPage() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<ScreenPhase>("populated");
  const [activeTab, setActiveTab] = useState<"production" | "backlog">("production");
  const [productionList, setProductionList] = useState<ProductionItem[]>(INITIAL_PRODUCTION);
  const [backlogList, setBacklogList] = useState<BacklogItem[]>(INITIAL_BACKLOG);
  const [errorStatus, setErrorStatus] = useState<
    "PRODUCTION_CAPACITY" | "POC_ESTIMATE_INVALID" | null
  >(null);

  const totalProductionCostMinor = productionList.reduce(
    (acc, p) => acc + p.units * p.materialCostMinor,
    0,
  );
  const totalBacklogValueMinor = backlogList.reduce((acc, b) => acc + b.valueMinor, 0);

  return (
    <div className="space-y-6 p-6" data-testid="s047-production-page">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-oneborder)] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-onetext)]">
            {t("production.title", "Production & Backlog")}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-onetextmuted)]">
            {t(
              "production.subtitle",
              "Production/inventory plan, BOM costing, and contract backlog percentage-of-completion (F-018).",
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {errorStatus && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setErrorStatus(null);
                setPhase("populated");
              }}
            >
              {t("common.clearError", "Clear Error")}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (phase === "empty") {
                setProductionList(INITIAL_PRODUCTION);
                setBacklogList(INITIAL_BACKLOG);
                setPhase("populated");
              } else {
                setProductionList([]);
                setBacklogList([]);
                setPhase("empty");
              }
            }}
          >
            {phase === "empty"
              ? t("common.loadSample", "Load Sample")
              : t("common.clear", "Clear Data")}
          </Button>
        </div>
      </div>

      {/* Metric Cards Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[var(--color-oneprimary)]/10 p-2 text-[var(--color-oneprimary)]">
              <Factory className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-onetextmuted)]">
                {t("production.totalCost", "Total Planned Cost")}
              </p>
              <div className="text-base font-semibold text-[var(--color-onetext)]">
                <MoneyCell minor={totalProductionCostMinor} currency="USD" />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[var(--color-onefavorable)]/10 p-2 text-[var(--color-onefavorable)]">
              <Boxes className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-onetextmuted)]">
                {t("production.totalUnits", "Total Units")}
              </p>
              <p className="text-base font-semibold text-[var(--color-onetext)]">
                {productionList.reduce((acc, p) => acc + p.units, 0).toLocaleString()}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[var(--color-oneprimary)]/10 p-2 text-[var(--color-oneprimary)]">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-onetextmuted)]">
                {t("production.backlogValue", "Contract Backlog Value")}
              </p>
              <div className="text-base font-semibold text-[var(--color-onetext)]">
                <MoneyCell minor={totalBacklogValueMinor} currency="USD" />
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--color-oneborder)]" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "production"}
          aria-controls="production-tab-panel"
          onClick={() => setActiveTab("production")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "production"
              ? "border-[var(--color-oneprimary)] text-[var(--color-oneprimary)]"
              : "border-transparent text-[var(--color-onetextmuted)] hover:text-[var(--color-onetext)]"
          }`}
        >
          <Factory className="h-4 w-4" />
          {t("production.tabs.production", "Production Plan & Inventory")}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "backlog"}
          aria-controls="backlog-tab-panel"
          onClick={() => setActiveTab("backlog")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "backlog"
              ? "border-[var(--color-oneprimary)] text-[var(--color-oneprimary)]"
              : "border-transparent text-[var(--color-onetextmuted)] hover:text-[var(--color-onetext)]"
          }`}
        >
          <Package className="h-4 w-4" />
          {t("production.tabs.backlog", "Backlog & POC Recognition")}
        </button>
      </div>

      {/* Canonical States Handling */}
      {phase === "loading" && (
        <StatePanel
          state="loading"
          message={t("production.loading", "Calculating production schedule...")}
        />
      )}

      {phase === "error" && (
        <StatePanel
          state="error"
          errorCode={errorStatus ?? "PRODUCTION_CAPACITY"}
          message={
            errorStatus === "POC_ESTIMATE_INVALID"
              ? t(
                  "errors.POC_ESTIMATE_INVALID",
                  "Percentage of completion estimate cannot exceed 100%.",
                )
              : t("errors.PRODUCTION_CAPACITY", "Planned production exceeds plant capacity limits.")
          }
          onRetry={() => {
            setErrorStatus(null);
            setPhase("populated");
          }}
        />
      )}

      {phase === "empty" && (
        <StatePanel
          state="empty"
          message={t("production.empty", "No production plan")}
          actionLabel={t("production.createPlan", "Add Product Line")}
          onAction={() => {
            setProductionList(INITIAL_PRODUCTION);
            setBacklogList(INITIAL_BACKLOG);
            setPhase("populated");
          }}
        />
      )}

      {phase === "populated" && (
        <>
          {activeTab === "production" && (
            <div id="production-tab-panel" role="tabpanel" tabIndex={0} className="space-y-4">
              <Card className="overflow-hidden">
                <div className="border-b border-[var(--color-oneborder)] px-6 py-4">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-onetextmuted)]">
                    {t("production.tableHeading", "Production Schedules & BOM")}
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)]/50 text-xs font-semibold text-[var(--color-onetextmuted)]">
                      <tr>
                        <th scope="col" className="px-6 py-3">
                          {t("production.product", "Product")}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {t("production.units", "Planned Units")}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {t("production.scrap", "Scrap %")}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {t("production.materialCost", "Unit Material Cost")}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {t("production.bomLines", "BOM Lines")}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {t("production.extendedCost", "Total Extended Cost")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-oneborder)]">
                      {productionList.map((item) => (
                        <tr key={item.id} className="hover:bg-[var(--color-onesurfacealt)]/30">
                          <td className="px-6 py-4 font-medium text-[var(--color-onetext)]">
                            {item.product}
                          </td>
                          <td className="px-6 py-4 text-[var(--color-onetext)]">
                            {item.units.toLocaleString()}
                          </td>
                          <td className="px-6 py-4 text-[var(--color-onetext)]">
                            {item.scrapPct}%
                          </td>
                          <td className="px-6 py-4 text-[var(--color-onetext)]">
                            <MoneyCell minor={item.materialCostMinor} currency="USD" />
                          </td>
                          <td className="px-6 py-4 text-[var(--color-onetext)]">{item.bomLines}</td>
                          <td className="px-6 py-4 font-semibold text-[var(--color-onetext)]">
                            <MoneyCell minor={item.units * item.materialCostMinor} currency="USD" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {activeTab === "backlog" && (
            <div id="backlog-tab-panel" role="tabpanel" tabIndex={0} className="space-y-4">
              <Card className="overflow-hidden">
                <div className="border-b border-[var(--color-oneborder)] px-6 py-4">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-onetextmuted)]">
                    {t("production.backlogHeading", "Contract Pipeline & Over-Time Recognition")}
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)]/50 text-xs font-semibold text-[var(--color-onetextmuted)]">
                      <tr>
                        <th scope="col" className="px-6 py-3">
                          {t("production.contract", "Contract ID")}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {t("production.customer", "Customer")}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {t("production.contractValue", "Contract Value")}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {t("production.pctComplete", "% Complete")}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {t("production.pocMethod", "Method")}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {t("production.timing", "Delivery Window")}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {t("production.recognized", "Earned Revenue")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-oneborder)]">
                      {backlogList.map((item) => (
                        <tr key={item.id} className="hover:bg-[var(--color-onesurfacealt)]/30">
                          <td className="px-6 py-4 font-mono font-medium text-[var(--color-onetext)]">
                            {item.contract}
                          </td>
                          <td className="px-6 py-4 text-[var(--color-onetext)]">{item.customer}</td>
                          <td className="px-6 py-4 text-[var(--color-onetext)]">
                            <MoneyCell minor={item.valueMinor} currency="USD" />
                          </td>
                          <td className="px-6 py-4 text-[var(--color-onetext)]">
                            <span className="inline-flex rounded-full bg-[var(--color-oneprimary)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--color-oneprimary)]">
                              {item.pctComplete}%
                            </span>
                          </td>
                          <td className="px-6 py-4 uppercase text-xs font-mono text-[var(--color-onetextmuted)]">
                            {item.pocMethod}
                          </td>
                          <td className="px-6 py-4 text-[var(--color-onetext)]">{item.timing}</td>
                          <td className="px-6 py-4 font-semibold text-[var(--color-onetext)]">
                            <MoneyCell
                              minor={earnedRevenueMinor(item.valueMinor, item.pctComplete)}
                              currency="USD"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
