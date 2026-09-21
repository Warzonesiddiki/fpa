/**
 * Exhaustive AUDIT-12 tests for the exact-decimal 13-week cash-flow engine.
 *
 * **Hand-verified reference** (the "week-5 dip" scenario): opening 100,000, target 50,000.
 * Weeks 1-4, 6-13: receipts 10,000 / disbursements 9,000 (op net +1,000). Week 5: receipts 5,000 /
 * disbursements 80,000 (op net −75,000) → pre-borrowing cash 29,000 < target 50,000, so the model
 * borrows 21,000 to restore the target (closing 50,000). Totals: receipts 125,000, disbursements
 * 188,000, additional borrowing 21,000 → ending 58,000. Tie-out:
 *   100,000 + 125,000 − 188,000 + 21,000 = 58,000.
 *
 * **Invariants:** ending cash === opening + Σreceipts − Σdisbursements + Σfinancing_in −
 * Σfinancing_out + Σadditional_borrowing (integer equality); exactly 13 weeks; weeks below target
 * borrow exactly the shortfall and close exactly at the target.
 */
import { describe, it, expect } from "vitest";
import { generateWeek13CashFlow, type Week13Week } from "./week13Cash";

const flat: Week13Week = {
  receiptsMinor: 10000,
  disbursementsMinor: 9000,
  financingInMinor: 0,
  financingOutMinor: 0,
};
const dip: Week13Week = {
  receiptsMinor: 5000,
  disbursementsMinor: 80000,
  financingInMinor: 0,
  financingOutMinor: 0,
};

/** 13 weeks with the week-5 dip. */
function dipWeeks(): Week13Week[] {
  const weeks: Week13Week[] = [];
  for (let i = 0; i < 13; i += 1) weeks.push(i === 4 ? dip : flat);
  return weeks;
}

describe("generateWeek13CashFlow (week-5 dip scenario)", () => {
  const s = generateWeek13CashFlow({
    openingCashMinor: 100000,
    weeks: dipWeeks(),
    targetCashMinor: 50000,
  });

  it("rolls forward exactly 13 weeks with the right labels", () => {
    expect(s.weeks.length).toBe(13);
    expect(s.weeks[0].weekLabel).toBe("W01");
    expect(s.weeks[12].weekLabel).toBe("W13");
  });
  it("borrowed in week 5 to restore the target: subtotal 29000 → +21000 → close 50000", () => {
    const w5 = s.weeks[4];
    expect(w5.openingCashMinor).toBe(104000);
    expect(w5.operatingNetMinor).toBe(-75000);
    expect(w5.subtotalCashMinor).toBe(29000);
    expect(w5.isBelowTarget).toBe(true);
    expect(w5.additionalBorrowingMinor).toBe(21000);
    expect(w5.shortfallMinor).toBe(21000);
    expect(w5.closingCashMinor).toBe(50000);
  });
  it("no other week is below target and borrows nothing", () => {
    for (const w of s.weeks) {
      if (w.weekNum !== 5) {
        expect(w.isBelowTarget).toBe(false);
        expect(w.additionalBorrowingMinor).toBe(0);
      }
    }
  });
  it("flags the breach and reports the worst (pre-borrowing) week as week 5", () => {
    expect(s.isBreach).toBe(true);
    expect(s.minimumSubtotalCashMinor).toBe(29000);
    expect(s.minimumSubtotalWeek).toBe(5);
  });
  it("reports the totals and ending cash", () => {
    expect(s.totalReceiptsMinor).toBe(125000);
    expect(s.totalDisbursementsMinor).toBe(188000);
    expect(s.totalOperatingNetMinor).toBe(-63000);
    expect(s.totalAdditionalBorrowingMinor).toBe(21000);
    expect(s.endingCashMinor).toBe(58000);
  });
  it("tie-out: ending = opening + receipts − disbursements + finIn − finOut + borrowing", () => {
    const expected =
      s.openingCashMinor +
      s.totalReceiptsMinor -
      s.totalDisbursementsMinor +
      s.totalFinancingInMinor -
      s.totalFinancingOutMinor +
      s.totalAdditionalBorrowingMinor;
    expect(s.endingCashMinor).toBe(expected);
    // And each week's closing is exactly that week's opening + its flows + borrowing.
    for (const w of s.weeks) {
      expect(w.closingCashMinor).toBe(
        w.openingCashMinor +
          w.receiptsMinor -
          w.disbursementsMinor +
          w.financingInMinor -
          w.financingOutMinor +
          w.additionalBorrowingMinor,
      );
    }
  });
});

describe("generateWeek13CashFlow (no-breach case)", () => {
  it("keeps cash above target the whole horizon → no borrowing, no breach", () => {
    const weeks = dipWeeks(); // week 5 dips, but with a low target it never breaks
    const s = generateWeek13CashFlow({ openingCashMinor: 200000, weeks, targetCashMinor: 10000 });
    expect(s.isBreach).toBe(false);
    expect(s.totalAdditionalBorrowingMinor).toBe(0);
    expect(s.weeks.every((w) => w.additionalBorrowingMinor === 0)).toBe(true);
    expect(s.endingCashMinor).toBe(s.openingCashMinor + s.totalOperatingNetMinor);
  });
});

describe("generateWeek13CashFlow (financing in / out)", () => {
  it("accounts for loan draws and repayments in the roll-forward and tie-out", () => {
    const weeks: Week13Week[] = Array.from({ length: 13 }, () => ({
      receiptsMinor: 0,
      disbursementsMinor: 0,
      financingInMinor: 0,
      financingOutMinor: 0,
    }));
    weeks[0] = {
      receiptsMinor: 0,
      disbursementsMinor: 40000,
      financingInMinor: 50000,
      financingOutMinor: 0,
    };
    weeks[1] = {
      receiptsMinor: 0,
      disbursementsMinor: 0,
      financingInMinor: 0,
      financingOutMinor: 20000,
    };
    const s = generateWeek13CashFlow({ openingCashMinor: 50000, weeks, targetCashMinor: 30000 });
    expect(s.weeks[0].closingCashMinor).toBe(60000); // 50000 − 40000 + 50000
    expect(s.weeks[1].closingCashMinor).toBe(40000); // 60000 − 20000
    expect(s.totalFinancingInMinor).toBe(50000);
    expect(s.totalFinancingOutMinor).toBe(20000);
    expect(s.isBreach).toBe(false);
    expect(s.endingCashMinor).toBe(
      s.openingCashMinor -
        s.totalDisbursementsMinor +
        s.totalFinancingInMinor -
        s.totalFinancingOutMinor,
    );
  });
});

describe("input validation (locked error codes)", () => {
  it("rejects anything other than exactly 13 weeks", () => {
    const twelve = dipWeeks().slice(0, 12);
    expect(() =>
      generateWeek13CashFlow({ openingCashMinor: 0, weeks: twelve, targetCashMinor: 0 }),
    ).toThrow(/VALUE_INVALID/);
    expect(() =>
      generateWeek13CashFlow({ openingCashMinor: 0, weeks: [], targetCashMinor: 0 }),
    ).toThrow(/VALUE_INVALID/);
  });
  it("rejects negative cash amounts", () => {
    const bad = dipWeeks();
    bad[0] = {
      receiptsMinor: -1,
      disbursementsMinor: 0,
      financingInMinor: 0,
      financingOutMinor: 0,
    };
    expect(() =>
      generateWeek13CashFlow({ openingCashMinor: 0, weeks: bad, targetCashMinor: 0 }),
    ).toThrow(/VALUE_INVALID/);
    expect(() =>
      generateWeek13CashFlow({ openingCashMinor: -1, weeks: dipWeeks(), targetCashMinor: 0 }),
    ).toThrow(/VALUE_INVALID/);
  });
});
