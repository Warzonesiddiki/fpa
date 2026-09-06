/**
 * S-034 Source Reconciliation screen (F-010 · M2 · SCREENS-SPEC S-034).
 *
 * `reconcile.run` and `reconcile.mark_authoritative` are catalogued in API-SPEC §3
 * (Errors: SRC_MISMATCH_UNRESOLVED, HEALTH_WAIVER_REASON_REQUIRED) but have **no
 * typed contract, no registered Rust handler, and no mock** (TASKBOARD §11), so
 * this screen is a **gated specification view**:
 *   - the planned comparison workflow is listed as spec content
 *   - no diff table, no authoritative-choice flow, and no export is rendered —
 *     all of those require real reconcile.* handlers (never simulated, never
 *     fabricated — B18-5/6)
 *   - `SRC_MISMATCH_UNRESOLVED` is core-owned; the browser never fabricates it
 *
 * No reconciliation has ever run in this build. When reconcile.* handlers land,
 * this screen gains the real attempt/loading/success/error path via the typed
 * bridge — not before.
 */

import { Link } from "react-router-dom";
import { ArrowLeft, FileInput, GitCompareArrows, Lock } from "lucide-react";
import { Button } from "@/components/ui";

const RECONCILE_GATE_REASON =
  "reconcile.run and reconcile.mark_authoritative are catalogued but have no registered handlers and no typed contract, so no comparison can run and no authoritative source can be chosen.";

/** Planned workflow elements — SCREENS-SPEC §S-034 (spec content, not built state). */
const PLANNED_ELEMENTS: { title: string; detail: string }[] = [
  {
    title: "Source selector",
    detail:
      "Choose batch A vs batch B (or a connector feed once connector.* lands) as the two sides of the tie report.",
  },
  {
    title: "Account-level diff table",
    detail:
      "Per-account balance comparison with match/mismatch status chips and attributed difference rows.",
  },
  {
    title: "Mark authoritative (audited)",
    detail:
      "Resolve a mismatch by choosing the authoritative source; every decision requires a reason and is written to the HMAC audit chain.",
  },
  {
    title: "Reconciliation report export",
    detail: "Export the resolved comparison for review (data-room eligible).",
  },
];

export function ReconciliationPage() {
  return (
    <div className="flex flex-col gap-6" data-testid="s034-reconcile-page">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Link
            to="/app/import"
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-onetextsecondary)] hover:text-[var(--color-onetext)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to Import Hub
          </Link>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-onetext)]">
          Source Reconciliation &amp; Cross-Tie
        </h1>
        <p className="text-sm text-[var(--color-onetextsecondary)]">
          Planned cross-source balance comparison and discrepancy resolution between external feeds
          and the OneFP&amp;A ledger trial balance. No comparison can run in this build.
        </p>
        <p id="reconcile-gate" className="text-xs text-[var(--color-onetextmuted)]">
          Reconciliation actions are unavailable: {RECONCILE_GATE_REASON}
        </p>
      </header>

      {/* Gate banner — the only truthful status for reconciliation actions. */}
      <div
        role="note"
        aria-label="Reconciliation actions unavailable"
        className="flex items-start gap-3 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-4 text-xs"
      >
        <Lock
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-onetextmuted)]"
          aria-hidden="true"
        />
        <div>
          <p className="font-semibold text-[var(--color-onetext)]">
            Reconciliation runtime not built
          </p>
          <p className="mt-0.5 text-[var(--color-onetextsecondary)]">{RECONCILE_GATE_REASON}</p>
          <div className="mt-3">
            <Link to="/app/import">
              <Button size="sm" variant="primary">
                <FileInput className="h-4 w-4" aria-hidden="true" />
                Use Manual Import Instead
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Planned workflow (spec content — SCREENS-SPEC §S-034, not rendered state). */}
      <section aria-labelledby="s034-planned-heading">
        <h2
          id="s034-planned-heading"
          className="text-base font-semibold text-[var(--color-onetext)]"
        >
          Planned workflow
        </h2>
        <p className="mt-1 text-xs text-[var(--color-onetextsecondary)]">
          The elements below are specified for this screen and ship together with the real{" "}
          <code className="rounded bg-[var(--color-onesurfacealt)] px-1">reconcile.*</code> handlers
          — including the persistent unresolved-variance error banner (Error state) and the
          reconciliation report (Success state).
        </p>
        <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {PLANNED_ELEMENTS.map((el) => (
            <li
              key={el.title}
              className="flex items-start gap-3 rounded-md border border-[var(--color-oneborder)] p-3"
            >
              <GitCompareArrows
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-onetextmuted)]"
                aria-hidden="true"
              />
              <div>
                <p className="text-xs font-semibold text-[var(--color-onetext)]">{el.title}</p>
                <p className="mt-0.5 text-xs text-[var(--color-onetextsecondary)]">{el.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
