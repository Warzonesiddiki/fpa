import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Coins, CalendarCheck, TrendingUp } from "lucide-react";
import { Button, Card, StatePanel, MoneyCell } from "@/components/ui";

/**
 * S-048 Revenue Recognition (/model/revrec)
 * F-019 bookings -> revenue bridge (ASC 606 / IFRS 15).
 *
 * Elements:
 * - Bookings table (contract, customer, booking value, term months, start period, policy)
 * - Policy select (over-time straight line / point-in-time on delivery)
 * - Recognition schedule by period (recognized vs deferred revenue)
 * - Deferred revenue waterfall & Balance Sheet tie-out check
 *
 * Canonical 5 states: loading, empty, error, success, populated.
 */

export interface BookingContract {
  id: string;
  contract: string;
  customer: string;
  bookingValueMinor: number;
  termMonths: number;
  startPeriod: string;
  policy: "over-time" | "point-in-time";
  recognizedMinor: number;
  deferredMinor: number;
}

const INITIAL_BOOKINGS: BookingContract[] = [
  {
    id: "bk-01",
    contract: "SAAS-2026-001",
    customer: "Apex Financial Systems",
    bookingValueMinor: 120000000,
    termMonths: 12,
    startPeriod: "2026-01",
    policy: "over-time",
    recognizedMinor: 60000000,
    deferredMinor: 60000000,
  },
  {
    id: "bk-02",
    contract: "HW-2026-042",
    customer: "Nordic Telecom AS",
    bookingValueMinor: 45000000,
    termMonths: 1,
    startPeriod: "2026-03",
    policy: "point-in-time",
    recognizedMinor: 45000000,
    deferredMinor: 0,
  },
  {
    id: "bk-03",
    contract: "CONS-2026-118",
    customer: "Meridian Health",
    bookingValueMinor: 75000000,
    termMonths: 6,
    startPeriod: "2026-04",
    policy: "over-time",
    recognizedMinor: 25000000,
    deferredMinor: 50000000,
  },
];

type ScreenPhase = "loading" | "empty" | "populated" | "error" | "success";

export function RevRecPage() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<ScreenPhase>("populated");
  const [bookings, setBookings] = useState<BookingContract[]>(INITIAL_BOOKINGS);
  const [errorStatus, setErrorStatus] = useState<"REVREC_COST_ESTIMATE_INVALID" | null>(null);

  const totalBookingsMinor = bookings.reduce((acc, b) => acc + b.bookingValueMinor, 0);
  const totalRecognizedMinor = bookings.reduce((acc, b) => acc + b.recognizedMinor, 0);
  const totalDeferredMinor = bookings.reduce((acc, b) => acc + b.deferredMinor, 0);

  return (
    <div className="space-y-6 p-6" data-testid="s048-revrec-page">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-oneborder)] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-onetext)]">
            {t("revrec.title", "Revenue Recognition")}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-onetextmuted)]">
            {t(
              "revrec.subtitle",
              "ASC 606 / IFRS 15 bookings-to-revenue bridge, deferred revenue waterfall, and balance sheet tie-out (F-019).",
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
                setBookings(INITIAL_BOOKINGS);
                setPhase("populated");
              } else {
                setBookings([]);
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

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[var(--color-oneprimary)]/10 p-2 text-[var(--color-oneprimary)]">
              <Coins className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-onetextmuted)]">
                {t("revrec.totalBookings", "Total Bookings")}
              </p>
              <div className="text-base font-semibold text-[var(--color-onetext)]">
                <MoneyCell minor={totalBookingsMinor} currency="USD" />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[var(--color-onefavorable)]/10 p-2 text-[var(--color-onefavorable)]">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-onetextmuted)]">
                {t("revrec.recognized", "Recognized Revenue (P&L)")}
              </p>
              <div className="text-base font-semibold text-[var(--color-onetext)]">
                <MoneyCell minor={totalRecognizedMinor} currency="USD" />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[var(--color-oneprimary)]/10 p-2 text-[var(--color-oneprimary)]">
              <CalendarCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-onetextmuted)]">
                {t("revrec.deferred", "Deferred Revenue (Balance Sheet)")}
              </p>
              <div className="text-base font-semibold text-[var(--color-onetext)]">
                <MoneyCell minor={totalDeferredMinor} currency="USD" />
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Canonical States */}
      {phase === "loading" && (
        <StatePanel
          state="loading"
          message={t("revrec.loading", "Calculating revenue recognition schedules...")}
        />
      )}

      {phase === "error" && (
        <StatePanel
          state="error"
          errorCode="REVREC_COST_ESTIMATE_INVALID"
          message={t(
            "errors.REVREC_COST_ESTIMATE_INVALID",
            "Cost-to-cost input estimate is invalid or exceeds total contract transaction value.",
          )}
          onRetry={() => {
            setErrorStatus(null);
            setPhase("populated");
          }}
        />
      )}

      {phase === "empty" && (
        <StatePanel
          state="empty"
          message={t("revrec.empty", "No bookings")}
          actionLabel={t("revrec.addBooking", "Add Contract Booking")}
          onAction={() => {
            setBookings(INITIAL_BOOKINGS);
            setPhase("populated");
          }}
        />
      )}

      {phase === "populated" && (
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--color-oneborder)] px-6 py-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-onetextmuted)]">
              {t("revrec.tableTitle", "Contract Bookings & Revenue Schedules")}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)]/50 text-xs font-semibold text-[var(--color-onetextmuted)]">
                <tr>
                  <th scope="col" className="px-6 py-3">
                    {t("revrec.contractId", "Contract")}
                  </th>
                  <th scope="col" className="px-6 py-3">
                    {t("revrec.customer", "Customer")}
                  </th>
                  <th scope="col" className="px-6 py-3">
                    {t("revrec.bookingValue", "Total Booking")}
                  </th>
                  <th scope="col" className="px-6 py-3">
                    {t("revrec.term", "Term (Mo)")}
                  </th>
                  <th scope="col" className="px-6 py-3">
                    {t("revrec.startPeriod", "Start")}
                  </th>
                  <th scope="col" className="px-6 py-3">
                    {t("revrec.policy", "ASC 606 Policy")}
                  </th>
                  <th scope="col" className="px-6 py-3">
                    {t("revrec.recCol", "Recognized")}
                  </th>
                  <th scope="col" className="px-6 py-3">
                    {t("revrec.defCol", "Deferred")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-oneborder)]">
                {bookings.map((b) => (
                  <tr key={b.id} className="hover:bg-[var(--color-onesurfacealt)]/30">
                    <td className="px-6 py-4 font-mono font-medium text-[var(--color-onetext)]">
                      {b.contract}
                    </td>
                    <td className="px-6 py-4 text-[var(--color-onetext)]">{b.customer}</td>
                    <td className="px-6 py-4 font-medium text-[var(--color-onetext)]">
                      <MoneyCell minor={b.bookingValueMinor} currency="USD" />
                    </td>
                    <td className="px-6 py-4 text-[var(--color-onetext)]">{b.termMonths}</td>
                    <td className="px-6 py-4 text-[var(--color-onetext)]">{b.startPeriod}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex rounded-full bg-[var(--color-oneprimary)]/10 px-2.5 py-0.5 text-xs font-medium text-[var(--color-oneprimary)]">
                        {b.policy}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-semibold text-[var(--color-onefavorable)]">
                      <MoneyCell minor={b.recognizedMinor} currency="USD" />
                    </td>
                    <td className="px-6 py-4 font-semibold text-[var(--color-onetext)]">
                      <MoneyCell minor={b.deferredMinor} currency="USD" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
