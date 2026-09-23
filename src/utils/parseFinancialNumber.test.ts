/**
 * parseFinancialNumber — accounting-format parse tests (AUDIT-02 · M3-9).
 *
 * Evidence requirement (docs/AUDIT-VECTOR-PLAN.md, AUDIT-02): "parse test with
 * 50 accounting strings" — this table drives 59 strings through the parser
 * (35 accepted formats → exact normalized decimal string, 24 rejections →
 * `null`). The four formats named in the vector are all covered: `1,250,000.00`,
 * `(500.00)`, `$1,000`, `15%`.
 *
 * Money discipline: every expectation is an exact string — no float anywhere
 * (B3/B18-2; `money:ast` gate).
 */
import { describe, expect, it } from "vitest";
import { parseFinancialNumber } from "./parseFinancialNumber";

const VALID: ReadonlyArray<[input: string, expected: string]> = [
  // Plain decimals (unchanged house format stays unchanged — no regression).
  ["1234.56", "1234.56"],
  ["-1234.56", "-1234.56"],
  ["+12", "12"],
  ["0", "0"],
  ["0.00", "0.00"],
  ["182500.00", "182500.00"],
  ["999999999999", "999999999999"], // 12 integer digits = the documented cap
  ["999,999,999,999", "999999999999"], // grouped form of the same cap
  // Strict comma thousands grouping.
  ["1,250,000.00", "1250000.00"], // AUDIT-02 named format
  ["1,250,000", "1250000"],
  ["1,250.50", "1250.50"],
  ["1,250.5", "1250.5"], // grouping is 3-digit on the integer part; a 1-digit fraction is fine
  // Accounting-negative parentheses.
  ["(500.00)", "-500.00"], // AUDIT-02 named format
  ["(500)", "-500"],
  ["(0.001)", "-0.001"],
  ["(1,250,000.00)", "-1250000.00"],
  ["(0.00)", "0.00"], // zero is unsigned, digits verbatim
  ["-0", "0"],
  ["-0.00", "0.00"],
  // Currency symbols.
  ["$1,000", "1000"], // AUDIT-02 named format
  ["$1,250,000.00", "1250000.00"],
  ["($1,250)", "-1250"], // symbol inside the parentheses
  ["($500.00)", "-500.00"],
  ["€2,500", "2500"],
  ["£100", "100"],
  ["¥999", "999"],
  ["₹40,000,000", "40000000"],
  // Percent — exact ÷100 by decimal-point shift.
  ["15%", "0.15"], // AUDIT-02 named format
  ["0.5%", "0.005"],
  ["100%", "1.00"],
  ["100000%", "1000.00"],
  ["50.25%", "0.5025"],
  ["1,234.5%", "12.345"],
  // Normalization details.
  ["  123  ", "123"], // surrounding whitespace trims
  ["007.50", "7.50"], // leading zeros strip, fraction verbatim
];

const INVALID: ReadonlyArray<[input: string, why: string]> = [
  ["", "empty"],
  ["   ", "whitespace-only"],
  ["abc", "junk"],
  ["USD 100", "ISO currency word"],
  ["1 250", "locale-space grouping is not a separator here"],
  ["1,25", "broken grouping (group < 3 digits)"],
  ["1,000,00", "broken grouping (last group 2 digits)"],
  ["1.250,000", "ambiguous locale separators"],
  ["1e3", "scientific notation banned on money paths"],
  ["1E3", "scientific notation (uppercase)"],
  ["--5", "double sign"],
  ["-+5", "mixed sign"],
  ["(+500)", "explicit sign inside parentheses"],
  ["(-5)", "explicit sign inside parentheses"],
  ["()+", "sign without a number"],
  ["($ )", "currency symbol without digits"],
  ["$$5", "repeated currency symbol"],
  ["5.", "trailing dot is not an exact decimal here"],
  [".5", "leading dot is not an exact decimal here"],
  ["1234567890123456", "integer part over the 12-digit i64-safe cap"],
  ["1,000,000,000,000", "13 integer digits (one trillion) over the cap"],
  ["15 %", "space between number and percent"],
  ["1,23.45", "group of 2 digits after first group"],
  ["12,34,567", "non-standard (Indian-style) grouping"],
];

describe("parseFinancialNumber (AUDIT-02 · M3-9)", () => {
  it.each(VALID)("parses %p to the exact normalized decimal %p", (input, expected) => {
    expect(parseFinancialNumber(input)).toBe(expected);
  });

  it.each(INVALID)("rejects %p (%s) with null — never a silent cast", (input) => {
    expect(parseFinancialNumber(input)).toBeNull();
  });

  it("counts at least the 50 documented accounting strings", () => {
    expect(VALID.length + INVALID.length).toBeGreaterThanOrEqual(50);
  });
});
