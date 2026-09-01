import { formatMinor, formatDecimalString, type NegativeStyle } from "@/utils/money";
import type { ScreenState } from "@/components/ui/StatePanel";
import { DISPLAY_DECIMAL_VALUES, useSettingsStore } from "@/stores/settings";

export interface MoneyCellProps {
  /** Amount in minor units (i64 across IPC — B18-2). */
  minor?: number | null;
  /** Or exact decimal string (never a JS float for money). */
  decimal?: string | null;
  currency: string;
  scale?: number;
  /** Explicit values override S-075 defaults for surfaces with their own format controls. */
  showInThousands?: boolean;
  displayDecimals?: number;
  negativeStyle?: NegativeStyle;
  locale?: string;
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
  showInThousands,
  displayDecimals,
  negativeStyle,
  locale,
  state = "populated",
}: MoneyCellProps) {
  const formatting = useSettingsStore((settings) => settings.preferences);
  const options = {
    scale,
    showInThousands: showInThousands ?? formatting.displayThousands,
    displayDecimals:
      displayDecimals ??
      (showInThousands === undefined
        ? DISPLAY_DECIMAL_VALUES[formatting.displayDecimals]
        : undefined),
    negativeStyle: negativeStyle ?? formatting.negativeStyle,
    locale: locale ?? formatting.locale,
  };

  let body: string;
  if (state === "loading") body = "…";
  else if (state === "empty") body = "—";
  else if (state === "error") body = "!";
  else if (state === "success") body = "✓";
  else {
    if (minor === null || minor === undefined) {
      body = decimal ? formatDecimalString(decimal, currency, options) : "—";
    } else {
      body = formatMinor(minor, currency, options);
    }
  }
  return (
    <span aria-label={body === "…" ? "Loading" : body} className="font-mono tabular-nums">
      {body}
    </span>
  );
}
