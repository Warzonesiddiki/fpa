import { describe, expect, it } from "vitest";
import { currencyScale, formatDecimalString, formatMinor } from "./money";

describe("currencyScale (MONEY-ROUNDING-SPEC §7)", () => {
  it("maps known currencies exactly", () => {
    expect(currencyScale("USD")).toBe(2);
    expect(currencyScale("INR")).toBe(2);
    expect(currencyScale("JPY")).toBe(0);
    expect(currencyScale("KWD")).toBe(3);
  });
  it("rejects unknown currency codes", () => {
    expect(() => currencyScale("XYZ")).toThrow(RangeError);
  });
});

describe("formatMinor — display only, exact (I1)", () => {
  it("formats INR minor units with Indian grouping", () => {
    expect(formatMinor(182500, "INR", { locale: "en-IN" })).toBe("INR 1,825.00");
    expect(formatMinor(123456789, "INR", { locale: "en-IN" })).toBe("INR 12,34,567.89");
  });
  it("formats JPY with zero decimals", () => {
    expect(formatMinor(1235, "JPY")).toBe("JPY 1,235");
  });
  it("wraps negatives in parentheses by default", () => {
    expect(formatMinor(-182500, "USD")).toBe("(USD 1,825.00)");
  });
  it("supports minus style", () => {
    expect(formatMinor(-182500, "USD", { negativeStyle: "minus" })).toBe("-USD 1,825.00");
  });
  it("supports 000s display without changing the value", () => {
    expect(formatMinor(182500000, "USD", { showInThousands: true })).toBe("USD 1,825");
  });
});

describe("formatDecimalString — exact decimal strings across IPC (B18-2)", () => {
  it("formats decimal strings", () => {
    expect(formatDecimalString("182500.00", "USD")).toBe("USD 182,500.00");
  });
  it("rejects NaN/Infinity silently-guardedly", () => {
    expect(() => formatDecimalString("not-a-number", "USD")).toThrow(RangeError);
  });
});

describe("formatDecimalString — edge paths (95% critical gate)", () => {
  it("throws MONEY_FORMAT_INVALID for unparseable input", () => {
    expect(() => formatDecimalString("12,34", "USD")).toThrow("MONEY_FORMAT_INVALID");
  });

  it("supports grouping:false and custom displayDecimals", () => {
    expect(formatDecimalString("12345.678", "USD", { grouping: false, displayDecimals: 2 })).toBe(
      "USD 12345.68",
    );
  });

  it("supports thousands + paren negative together", () => {
    expect(formatDecimalString("-1234567.89", "USD", { showInThousands: true })).toBe(
      "(USD 1,235)",
    );
  });
});

describe("formatDecimalString — remaining critical paths", () => {
  it("throws for non-finite decimal strings", () => {
    expect(() => formatDecimalString("Infinity", "USD")).toThrow("MONEY_FORMAT_INVALID");
  });

  it("groups Indian-style for six-digit amounts", () => {
    expect(formatDecimalString("123456.78", "INR", { locale: "en-IN" })).toBe("INR 1,23,456.78");
  });

  it("shows minus style over paren style when requested", () => {
    expect(formatDecimalString("-0.5", "USD", { negativeStyle: "minus" })).toBe("-USD 0.50");
  });
});
