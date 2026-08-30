import { formatMinor, formatDecimalString } from "@/utils/money";
import type { ScreenState } from "@/components/ui/StatePanel";

export interface MoneyCellProps {
  /** Amount in minor units (i64 across IPC — B18-2). */
  minor?: number | null;
  /** Or exact decimal string (never a JS float for money). */
  decimal?: string | null;
  currency: string;
  scale?: number;
  showInThousands?: boolean;
  state?: ScreenState;
}

/**
 * Displays a Money Value. Never computes anything (I1) — formats only.
 * Shows one of the 5 states so grid cells are testable per Q1.
 */
export function MoneyCell({
  minor,
  decimal,
  currency,
  scale,
  showInThousands = false,
  state = "populated",
}: MoneyCellProps) {
  let body: string;
  if (state === "loading") body = "…";
  else if (state === "empty") body = "—";
  else if (state === "error") body = "!";
  else if (state === "success") body = "✓";
  else {
    if (minor === null || minor === undefined) {
      body = decimal ? formatDecimalString(decimal, currency, { scale, showInThousands }) : "—";
    } else {
      body = formatMinor(minor, currency, { scale, showInThousands });
    }
  }
  return (
    <span aria-label={body === "…" ? "Loading" : body} className="font-mono tabular-nums">
      {body}
    </span>
  );
}
