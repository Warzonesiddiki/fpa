import { useTranslation } from "react-i18next";
import { Card, StatePanel, MoneyCell } from "@/components/ui";

const KPIS = [
  { key: "kpi.revenue", label: "kpi.revenue", minor: 635000000, currency: "USD" },
  {
    key: "kpi.grossMargin",
    label: "kpi.grossMargin",
    minor: 238000000,
    currency: "USD",
    thousands: true,
  },
  { key: "kpi.ebitda", label: "kpi.ebitda", minor: 114000000, currency: "USD", thousands: true },
  { key: "kpi.cash", label: "kpi.cash", minor: 132000000, currency: "USD", thousands: true },
] as const;

/** S-010 Dashboard (F-030) — Plan-Only default state; KPI cards with explainers (D-008). */
export function DashboardPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("dashboard.title")}</h1>
        <span className="rounded-full bg-[var(--color-onesurfacealt)] px-3 py-1 text-xs text-[var(--color-onetextsecondary)]">
          FY2026 · P08
        </span>
      </header>

      <StatePanel
        state="empty"
        message={t("dashboard.empty.planOnly")}
        actionLabel={t("dashboard.actions.import")}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((kpi) => (
          <Card key={kpi.key}>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-onetextmuted)]">
              {t(kpi.label)}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              <MoneyCell
                minor={kpi.minor}
                currency={kpi.currency}
                showInThousands={"thousands" in kpi ? Boolean(kpi.thousands) : false}
              />
            </p>
            <button type="button" className="mt-2 text-xs text-[var(--color-oneprimary)] underline">
              {t("dashboard.kpi.explainer")}
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
}
