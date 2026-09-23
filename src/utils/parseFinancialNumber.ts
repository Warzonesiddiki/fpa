/**
 * parseFinancialNumber — exact-decimal parser for Excel-style financial text
 * (AUDIT-02 · M3-9 · S-041 cell input & paste).
 *
 * Single owner for financial number-text parsing: the S-041 formula bar and the
 * TSV/CSV paste path both route through this function, so the accepted grammar
 * has exactly one definition (B14).
 *
 * ACCEPTED (normalized to a plain exact decimal string):
 * - plain decimal: `1234.56`, `-1234.56`, `+12`, `0`, `0.00`
 * - strict comma thousands grouping: `1,250,000.00` (groups of exactly 3)
 * - accounting-negative parentheses: `(500.00)` → `-500.00`
 * - leading currency symbol: `$1,000` (also € £ ¥ ₹)
 * - percent (exact ÷100 by decimal-point shift — never float): `15%` → `0.15`
 * - zero is always unsigned: `-0`, `-0.00`, `(0.00)` drop the sign, digits
 *   stay verbatim (`-0.00` → `0.00`)
 *
 * REJECTED (returns `null` — the caller surfaces `VALUE_INVALID`, never a
 * silent cast):
 * - empty / whitespace-only, and any interior whitespace
 * - non-numeric junk (`abc`, `USD 100`, `1 250` locale-space grouping)
 * - scientific notation (`1e3`) — banned on money paths (MONEY-ROUNDING-SPEC)
 * - ambiguous locale separators (`1.250,000`)
 * - broken grouping (`1,25`, `1,000,00`)
 * - double or mixed signs (`--5`, `-+5`, `(−5)` with an explicit sign)
 * - a sign inside the parentheses (`(-5)`)
 * - more than 12 integer digits (i64-safe at any currency scale; larger input
 *   is a data-entry error, not a financial value)
 *
 * Money discipline: string manipulation + regex only — no numeric-conversion
 * calls (`Number` / `parseFloat` are banned), no float anywhere (B3/B18-2;
 * `money:ast` gate). The result is the exact decimal string that becomes the
 * cell's `amount_text`.
 */

const CURRENCY_SYMBOLS = new Set(["$", "€", "£", "¥", "₹"]);

/** i64-safe cap on the integer part (major units) for any currency scale. */
const MAX_INTEGER_DIGITS = 12;

/**
 * Parse Excel-style financial text into a plain exact decimal string.
 * Returns `null` when the text is not a valid financial number.
 */
export function parseFinancialNumber(raw: string): string | null {
  let s = raw.trim();
  if (s === "") return null;
  if (/\s/.test(s)) return null; // interior whitespace is never a separator here

  // Percent attaches directly to the digits: `15%`, never `15 %`.
  const isPercent = s.endsWith("%");
  if (isPercent) s = s.slice(0, -1);

  // Accounting parentheses come first: `($1,250)` keeps the symbol inside.
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    if (s.length < 3) return null; // `()` / `(x)` without digits handled below
    s = s.slice(1, -1);
    negative = true;
  }

  // Leading currency symbol (single; a repeated symbol is junk).
  if (CURRENCY_SYMBOLS.has(s[0] ?? "")) {
    s = s.slice(1);
    if (CURRENCY_SYMBOLS.has(s[0] ?? "")) return null;
  }

  // Sign: an explicit `+` is normalized away; a sign alongside the parentheses
  // or a second sign is rejected (`(-5)`, `(+500)`, `--5`, `-+5`).
  if (s.startsWith("+")) {
    if (negative) return null;
    s = s.slice(1);
  } else if (s.startsWith("-")) {
    if (negative) return null;
    negative = true;
    s = s.slice(1);
  }
  if (s === "") return null;

  // Integer part: either strict comma grouping (`1,250,000`) or plain digits,
  // with an optional fraction. Dots never group thousands here.
  const m = s.match(/^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/);
  if (m === null) return null;
  const intDigits = m[1].replace(/,/g, "");
  if (intDigits.length > MAX_INTEGER_DIGITS) return null;
  const fraction = m[2] ?? "";

  let intPart = intDigits.replace(/^0+(?=\d)/, ""); // strip leading zeros, keep a single 0
  if (intPart === "") intPart = "0";

  let value = intPart + (fraction !== "" ? `.${fraction}` : "");
  if (isPercent) value = divideBy100(value);

  // Zero is always unsigned: `-0`, `-0.00`, `(0.00)` drop the sign; the digits
  // the user entered stay verbatim (`-0.00` → `0.00`, not `0`).
  if (negative && /^0+(\.0+)?$/.test(value)) return value;

  return (negative ? "-" : "") + value;
}

/**
 * Exact ÷100 by shifting the decimal point two places left (string operation —
 * no float): `15` → `0.15`, `0.5` → `0.005`, `1234.5` → `12.345`,
 * `100000` → `1000.00`.
 */
function divideBy100(value: string): string {
  const [intPart, fraction = ""] = value.split(".");
  const digits = intPart + fraction;
  const fracLen = fraction.length + 2;
  if (fracLen >= digits.length) {
    // Result is under 1: pad leading zeros.
    return `0.${digits.padStart(fracLen, "0")}`;
  }
  const head = digits.slice(0, digits.length - fracLen).replace(/^0+(?=\d)/, "") || "0";
  const tail = digits.slice(digits.length - fracLen);
  return `${head}.${tail}`;
}
