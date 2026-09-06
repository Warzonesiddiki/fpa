/**
 * S-033 Connectors screen (F-009 · M2 · SCREENS-SPEC S-033).
 *
 * connector.connect / connector.callback / connector.sync / connector.health are
 * catalogued in API-SPEC but have no registered Rust handlers (connector.* is
 * unbuilt — TASKBOARD §11), so this screen is a **gated catalogue**:
 *   - the four planned providers are listed as spec content
 *   - every connector action is disabled with the gate reason (never simulated,
 *     never fabricated — B18-5/6; audit 2026-09-06 §14)
 *   - Manual Import (B19: GL Dump / file import works with zero connectors) is
 *     presented as the working alternative
 *
 * No sync history is rendered: none has ever run. When connector.* handlers
 * land, this screen gains the real attempt/success/error path via the typed
 * bridge — not before.
 */

import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, FileInput, Lock, Plug } from "lucide-react";
import { Button, Card, type ScreenState } from "@/components/ui";

export interface ConnectorProvider {
  id: "qbo" | "xero" | "netsuite" | "sage";
  name: string;
  description: string;
  authType: "OAuth 2.0" | "OAuth 1.0a" | "Token-Based";
}

const INITIAL_PROVIDERS: ConnectorProvider[] = [
  {
    id: "qbo",
    name: "QuickBooks Online",
    description:
      "Planned General Ledger, Chart of Accounts, and Trial Balance feed from Intuit QBO.",
    authType: "OAuth 2.0",
  },
  {
    id: "xero",
    name: "Xero",
    description:
      "Planned multi-currency GL journals, bank transactions, and tracking categories feed.",
    authType: "OAuth 2.0",
  },
  {
    id: "netsuite",
    name: "Oracle NetSuite",
    description:
      "Planned SuiteTalk REST Web Services connection for ERP transactions, segments, and subsidiary ledgers.",
    authType: "Token-Based",
  },
  {
    id: "sage",
    name: "Sage Intacct",
    description:
      "Planned Web Services gateway for multi-entity multi-book trial balance and journal entries.",
    authType: "OAuth 2.0",
  },
];

const CONNECTOR_GATE_REASON =
  "connector.connect, connector.callback, connector.sync, and connector.health are catalogued but have no registered handlers (connector.* unbuilt), so no sync runs and no credentials are stored.";

export function ConnectorsPage() {
  // The catalogue is static spec content and the connector runtime is unbuilt:
  // this screen has exactly one truthful visual state (populated) plus the gate.
  const screenState: ScreenState = "populated";

  return (
    <div className="flex flex-col gap-6" data-testid="s033-connectors-page">
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
          ERP &amp; Accounting Connectors
        </h1>
        <p className="text-sm text-[var(--color-onetextsecondary)]">
          Planned API integrations with QuickBooks, Xero, NetSuite, and Sage. No live connection is
          available in this build.
        </p>
        <p id="connector-gate" className="text-xs text-[var(--color-onetextmuted)]">
          Connector actions are unavailable: {CONNECTOR_GATE_REASON}
        </p>
      </header>

      {/* Gate banner — the only truthful status for connector actions (aria-describedby off the header). */}
      <div
        role="note"
        aria-label="Connector actions unavailable"
        className="flex items-start gap-3 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-4 text-xs"
      >
        <Lock
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-onetextmuted)]"
          aria-hidden="true"
        />
        <div>
          <p className="font-semibold text-[var(--color-onetext)]">Connector runtime not built</p>
          <p className="mt-0.5 text-[var(--color-onetextsecondary)]">{CONNECTOR_GATE_REASON}</p>
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

      {/* Provider Catalogue (spec content — not connected state) */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {INITIAL_PROVIDERS.map((p) => (
          <Card
            key={p.id}
            title={p.name}
            className="flex flex-col justify-between"
            actions={
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-onesurfacealt)] px-2 py-0.5 text-xs font-medium text-[var(--color-onetextmuted)]">
                <Plug className="h-3 w-3" aria-hidden="true" />
                Planned
              </span>
            }
          >
            <p className="mb-4 text-xs text-[var(--color-onetextsecondary)]">{p.description}</p>

            <div className="space-y-2 border-t border-[var(--color-oneborder)] pt-3 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--color-onetextmuted)]">Auth Protocol:</span>
                <span className="font-medium text-[var(--color-onetext)]">{p.authType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-onetextmuted)]">Credentials Storage:</span>
                <span className="font-medium text-[var(--color-onetext)]">
                  OS Keychain (planned)
                </span>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-[var(--color-oneborder)] pt-3">
              {/* Disabled with the gate reason — never a simulated connect flow. */}
              <Button
                size="sm"
                variant="secondary"
                disabled
                aria-describedby="connector-gate"
                title={CONNECTOR_GATE_REASON}
              >
                <Plug aria-hidden="true" className="h-3.5 w-3.5" />
                Connect
              </Button>
              <span
                className="text-xs text-[var(--color-onetextmuted)]"
                aria-describedby="connector-gate"
              >
                Unavailable — no registered handler
              </span>
            </div>
          </Card>
        ))}
      </div>

      {/* Security posture note — describes the planned storage model (INTEGRATIONS §3). */}
      <div className="flex items-start gap-3 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-4 text-xs">
        <CheckCircle2
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-onefavorable)]"
          aria-hidden="true"
        />
        <div>
          <p className="font-semibold text-[var(--color-onetext)]">
            Local-First Keychain Security (Rule B1/B3)
          </p>
          <p className="mt-0.5 text-[var(--color-onetextsecondary)]">
            When connectors are built, OAuth access tokens and client secrets will be encrypted
            using Windows DPAPI / macOS Keychain and will never leave this workstation. No cloud
            intermediate or proxy servers are utilized.
          </p>
        </div>
      </div>

      {screenState !== "populated" /* defensive: single truthful state today */ && null}
    </div>
  );
}
