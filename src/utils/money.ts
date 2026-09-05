import Decimal from "decimal.js";

/**
 * Money formatting — DISPLAY ONLY (I1, MONEY-ROUNDING-SPEC §1/§8).
 * The UI never performs money arithmetic; the Rust core is the single money owner (B14).
 * Values cross IPC as i64 minor units or decimal strings (B18-2) — never JS numbers.
 */

/** Default decimal.js precision — display only, never used to compute stored money. */
Decimal.set({ precision: 28, toExpNeg: -20, toExpPos: 20 });

export type NegativeStyle = "paren" | "minus";

export interface MoneyFormatOptions {
  /** ISO 4217 currency code, e.g. "USD", "INR", "KWD". */
  currency?: string;
  /** Currency Scale from `currency_scales` seed (2 = USD/INR/EUR, 0 = JPY, 3 = KWD). */
  scale: number;
  /** Display thousands separator. */
  grouping?: boolean;
  /** Negative style — parenthesis default (MONEY-ROUNDING-SPEC §5). */
  negativeStyle?: NegativeStyle;
  /** Display-in-thousands (000s) — value is unchanged (MONEY-ROUNDING-SPEC §3). */
  showInThousands?: boolean;
  /** Display decimals; defaults to `scale`. */
  displayDecimals?: number;
  /** Locale for grouping/separators, e.g. "en-US", "en-IN", "de-DE". Default en-US (OS-derived at runtime; S-075). */
  locale?: string;
  /** Symbol to prepend/append; defaults to currency code. */
  symbol?: string;
}

const SCALE_FROM_ISO: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  INR: 2,
  AUD: 2,
  CAD: 2,
  SGD: 2,
  CHF: 2,
  AED: 2,
  SAR: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  PLN: 2,
  TRY: 2,
  ZAR: 2,
  BRL: 2,
  MXN: 2,
  NZD: 2,
  HKD: 2,
  JPY: 0,
  KRW: 0,
  VND: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
  IQD: 3,
  TND: 3,
};

/** Exact Currency Scale for an ISO 4217 code (mirror of `currency_scales` seed; Rust is authoritative). */
export function currencyScale(iso: string): number {
  const scale = SCALE_FROM_ISO[iso.toUpperCase()];
  if (scale === undefined) throw new RangeError(`CURRENCY_UNKNOWN: ${iso}`);
  return scale;
}

/**
 * Format an amount given as minor units (i64 crossing IPC) for display.
 * Example: formatMinor(182500, "INR") → "₹1,825.00".
 */
export function formatMinor(
  minor: number,
  iso: string,
  opts: Partial<MoneyFormatOptions> = {},
): string {
  const scale = opts.scale ?? currencyScale(iso);
  const value = new Decimal(minor).div(new Decimal(10).pow(scale));
  return formatDecimal(value, iso, { ...opts, scale });
}

/**
 * Format an exact decimal string ("182500.0000") — the only other money shape across IPC.
 * Throws on anything non-numeric: the UI never silently formats garbage.
 */
export function formatDecimalString(
  decimalStr: string,
  iso: string,
  opts: Partial<MoneyFormatOptions> = {},
): string {
  let value: Decimal;
  try {
    value = new Decimal(decimalStr);
  } catch {
    throw new RangeError(`MONEY_FORMAT_INVALID: ${decimalStr}`);
  }
  if (!value.isFinite()) throw new RangeError("MONEY_FORMAT_INVALID: non-finite amount");
  return formatDecimal(value, iso, { ...opts, scale: opts.scale ?? currencyScale(iso) });
}

interface LocalePattern {
  group: string;
  decimal: string;
  indian: boolean;
}

const DEFAULT_LOCALE_PATTERN: LocalePattern = { group: ",", decimal: ".", indian: false };
const LOCALE_PATTERNS: Record<string, LocalePattern> = {
  "en-US": DEFAULT_LOCALE_PATTERN,
  "en-IN": { group: ",", decimal: ".", indian: true },
  "de-DE": { group: ".", decimal: ",", indian: false },
  "fr-FR": { group: "\u202f", decimal: ",", indian: false },
  "es-ES": { group: ".", decimal: ",", indian: false },
  "pt-BR": { group: ".", decimal: ",", indian: false },
  "nl-NL": { group: ".", decimal: ",", indian: false },
  "it-IT": { group: ".", decimal: ",", indian: false },
  "sv-SE": { group: ".", decimal: ",", indian: false },
  "ja-JP": DEFAULT_LOCALE_PATTERN,
  "zh-CN": DEFAULT_LOCALE_PATTERN,
  "ar-SA": { group: "٬", decimal: "٫", indian: false },
};

function localePattern(locale: string): LocalePattern {
  return LOCALE_PATTERNS[locale] ?? DEFAULT_LOCALE_PATTERN;
}

function formatDecimal(value: Decimal, iso: string, opts: MoneyFormatOptions): string {
  const displayDecimals = opts.displayDecimals ?? (opts.showInThousands ? 0 : opts.scale);
  const negative = value.isNegative();
  const abs = value.abs();

  let display = abs;
  if (opts.showInThousands) display = display.div(1000);

  const locale = localePattern(opts.locale ?? "en-US");
  const [intPart, decPart] = display.toFixed(displayDecimals).split(".");
  const intGrouped = opts.grouping === false ? intPart : groupDigits(intPart, locale);
  const numberText = decPart ? `${intGrouped}${locale.decimal}${decPart}` : intGrouped;

  const negStyle = opts.negativeStyle ?? "paren";
  const body = `${opts.symbol ?? iso} ${numberText}`;
  const negativeBody = negative ? `-${body}` : body;
  return negStyle === "paren" && negative ? `(${body})` : negativeBody;
}

/** Exact string grouping; money never enters `Intl.NumberFormat` as a JS number. */
function groupDigits(raw: string, locale: LocalePattern): string {
  const digits = raw.replace(/^0+(?=\d{1,3}$)/, "");
  if (locale.indian) {
    if (digits.length <= 3) return digits;
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3);
    return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, locale.group)}${locale.group}${last3}`;
  }
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, locale.group);
}

/**
 * Format a percentage value (display only) without floating-point arithmetic in UI components.
 * e.g. formatPercent(0.125, 1) -> "+12.5%" or formatPercent(-0.05, 1) -> "-5.0%"
 * Returns "\u2014" (dash) when null/undefined.
 */
export function formatPercent(
  value: number | null | undefined,
  decimals = 1,
  showPlus = true,
): string {
  if (value == null || !Number.isFinite(value)) return "\u2014";
  const dec = new Decimal(value).mul(100);
  const formatted = dec.toFixed(decimals);
  const prefix = showPlus && dec.greaterThan(0) ? "+" : "";
  return `${prefix}${formatted}%`;
}
