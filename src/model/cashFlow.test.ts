/**
 * Exhaustive AUDIT-05 tests for the Cash Flow (Direct + Indirect) reconciliation and the Non-GAAP
 * EBITDA bridge.
 *
 * **Hand-verified reference** (the canonical consistent set):
 * - Direct:  collections 100,000 − disbursements 70,000 = operating 30,000; investing −20,000;
 *   financing +15,000 → net 25,000.
 * - Indirect: NI 25,000 + D&A 10,000 + non-cash 5,000 − ΔWC 10,000 = operating 30,000; same
 *   investing/financing → net 25,000.
 * - Reconcile (opening 100,000, closing 125,000): direct op === indirect op (30,000), direct net ===
 *   indirect net (25,000), net === Δ cash (25,000) → balanced.
 * - Non-GAAP: NI 25,000 + interest 5,000 + taxes 3,000 = EBIT 33,000; + D&A 10,000 = EBITDA 43,000;
 *   + SBC 5,000 + one-time 2,000 = Adjusted EBITDA 50,000.
 */
import { describe, expect, it } from "vitest";
import {
  computeDirectCashFlow,
  computeIndirectCashFlow,
  reconcileCashFlow,
  buildEbitdaBridge,
} from "./cashFlow";

describe("computeDirectCashFlow", () => {
  it("operating = collections − disbursements; net = op + inv + fin (100k/70k/−20k/15k)", () => {
    const cf = computeDirectCashFlow({
      operatingCollectionsMinor: 100000,
      operatingDisbursementsMinor: 70000,
      investingMinor: -20000,
      financingMinor: 15000,
    });
    expect(cf.operatingMinor).toBe(30000);
    expect(cf.investingMinor).toBe(-20000);
    expect(cf.financingMinor).toBe(15000);
    expect(cf.netCashChangeMinor).toBe(25000);
  });
  it("all-zero inputs give an all-zero statement", () => {
    const cf = computeDirectCashFlow({
      operatingCollectionsMinor: 0,
      operatingDisbursementsMinor: 0,
      investingMinor: 0,
      financingMinor: 0,
    });
    expect(cf).toEqual({
      operatingMinor: 0,
      investingMinor: 0,
      financingMinor: 0,
      netCashChangeMinor: 0,
    });
  });
  it("supports negative flows (a net cash outflow)", () => {
    const cf = computeDirectCashFlow({
      operatingCollectionsMinor: 1000,
      operatingDisbursementsMinor: 5000,
      investingMinor: -3000,
      financingMinor: 0,
    });
    expect(cf.operatingMinor).toBe(-4000);
    expect(cf.netCashChangeMinor).toBe(-7000);
  });
});

describe("computeIndirectCashFlow", () => {
  it("operating = NI + D&A + non-cash − ΔWC (25k+10k+5k−10k = 30k); net 25k", () => {
    const cf = computeIndirectCashFlow({
      netIncomeMinor: 25000,
      depreciationMinor: 10000,
      amortizationMinor: 0,
      nonCashAddBacksMinor: 5000,
      deltaWorkingCapitalMinor: 10000,
      investingMinor: -20000,
      financingMinor: 15000,
    });
    expect(cf.operatingMinor).toBe(30000);
    expect(cf.netCashChangeMinor).toBe(25000);
  });
  it("a positive ΔWC is a cash outflow; a negative ΔWC is a cash inflow", () => {
    const base = {
      netIncomeMinor: 1000,
      depreciationMinor: 0,
      amortizationMinor: 0,
      nonCashAddBacksMinor: 0,
      investingMinor: 0,
      financingMinor: 0,
    };
    expect(computeIndirectCashFlow({ ...base, deltaWorkingCapitalMinor: 500 }).operatingMinor).toBe(
      500,
    );
    expect(
      computeIndirectCashFlow({ ...base, deltaWorkingCapitalMinor: -500 }).operatingMinor,
    ).toBe(1500);
  });
});

describe("reconcileCashFlow — the exact statement tie-out", () => {
  const direct = computeDirectCashFlow({
    operatingCollectionsMinor: 100000,
    operatingDisbursementsMinor: 70000,
    investingMinor: -20000,
    financingMinor: 15000,
  });
  const indirect = computeIndirectCashFlow({
    netIncomeMinor: 25000,
    depreciationMinor: 10000,
    amortizationMinor: 0,
    nonCashAddBacksMinor: 5000,
    deltaWorkingCapitalMinor: 10000,
    investingMinor: -20000,
    financingMinor: 15000,
  });

  it("a consistent pair reconciles: operating and net both tie out", () => {
    const r = reconcileCashFlow(direct, indirect);
    expect(r.operatingTiesOut).toBe(true);
    expect(r.netTiesOut).toBe(true);
    expect(r.isBalanced).toBe(true);
    expect(r.directOperatingMinor).toBe(30000);
    expect(r.indirectNetMinor).toBe(25000);
  });
  it("with opening/closing cash, net change also ties to Δ cash", () => {
    const r = reconcileCashFlow(direct, indirect, {
      openingCashMinor: 100000,
      closingCashMinor: 125000,
    });
    expect(r.deltaCashMinor).toBe(25000);
    expect(r.cashChangeTiesOut).toBe(true);
    expect(r.isBalanced).toBe(true);
  });
  it("flags an inconsistent operating section (ΔWC moved the indirect operating)", () => {
    const badIndirect = computeIndirectCashFlow({
      netIncomeMinor: 25000,
      depreciationMinor: 10000,
      amortizationMinor: 0,
      nonCashAddBacksMinor: 5000,
      deltaWorkingCapitalMinor: 20000, // now operating = 20,000 ≠ 30,000
      investingMinor: -20000,
      financingMinor: 15000,
    });
    const r = reconcileCashFlow(direct, badIndirect);
    expect(r.operatingTiesOut).toBe(false);
    expect(r.netTiesOut).toBe(false);
    expect(r.isBalanced).toBe(false);
  });
  it("flags when net change ≠ Δ cash (cash balances disagree with the flow)", () => {
    const r = reconcileCashFlow(direct, indirect, {
      openingCashMinor: 100000,
      closingCashMinor: 99999,
    });
    expect(r.cashChangeTiesOut).toBe(false);
    expect(r.isBalanced).toBe(false);
  });
  it("is a pure integer equality (no tolerance): a 1-unit drift is caught", () => {
    const drift = { ...indirect, netCashChangeMinor: indirect.netCashChangeMinor + 1 };
    expect(reconcileCashFlow(direct, drift).netTiesOut).toBe(false);
  });
});

describe("buildEbitdaBridge — Non-GAAP reconciliation", () => {
  it("chains NI → EBIT → EBITDA → Adjusted EBITDA (25k → 33k → 43k → 50k)", () => {
    const b = buildEbitdaBridge({
      netIncomeMinor: 25000,
      interestExpenseMinor: 5000,
      taxExpenseMinor: 3000,
      depreciationMinor: 10000,
      amortizationMinor: 0,
      sbcMinor: 5000,
      oneTimeAdjustmentsMinor: 2000,
    });
    expect(b.ebitMinor).toBe(33000);
    expect(b.ebitdaMinor).toBe(43000);
    expect(b.adjustedEbitdaMinor).toBe(50000);
    expect(b.isBalanced).toBe(true);
  });
  it("EBIT adds back interest and taxes; EBITDA adds D&A", () => {
    const b = buildEbitdaBridge({
      netIncomeMinor: 100,
      interestExpenseMinor: 20,
      taxExpenseMinor: 30,
      depreciationMinor: 40,
      amortizationMinor: 50,
      sbcMinor: 0,
      oneTimeAdjustmentsMinor: 0,
    });
    expect(b.ebitMinor).toBe(150); // 100 + 20 + 30
    expect(b.ebitdaMinor).toBe(240); // 150 + 40 + 50
    expect(b.adjustedEbitdaMinor).toBe(240); // no add-backs
  });
  it("handles a net loss (negative net income)", () => {
    const b = buildEbitdaBridge({
      netIncomeMinor: -1000,
      interestExpenseMinor: 200,
      taxExpenseMinor: 0,
      depreciationMinor: 300,
      amortizationMinor: 0,
      sbcMinor: 100,
      oneTimeAdjustmentsMinor: 0,
    });
    expect(b.ebitMinor).toBe(-800);
    expect(b.ebitdaMinor).toBe(-500);
    expect(b.adjustedEbitdaMinor).toBe(-400);
    expect(b.isBalanced).toBe(true);
  });
  it("all-zero inputs give an all-zero bridge", () => {
    const b = buildEbitdaBridge({
      netIncomeMinor: 0,
      interestExpenseMinor: 0,
      taxExpenseMinor: 0,
      depreciationMinor: 0,
      amortizationMinor: 0,
      sbcMinor: 0,
      oneTimeAdjustmentsMinor: 0,
    });
    expect(b.ebitMinor).toBe(0);
    expect(b.ebitdaMinor).toBe(0);
    expect(b.adjustedEbitdaMinor).toBe(0);
    expect(b.isBalanced).toBe(true);
  });
});

describe("input validation (locked error codes)", () => {
  it("rejects non-integer minor-unit values across all entry points", () => {
    expect(() =>
      computeDirectCashFlow({
        operatingCollectionsMinor: 1.5,
        operatingDisbursementsMinor: 0,
        investingMinor: 0,
        financingMinor: 0,
      }),
    ).toThrow(/VALUE_INVALID/);
    expect(() =>
      computeIndirectCashFlow({
        netIncomeMinor: 0,
        depreciationMinor: 0,
        amortizationMinor: 0,
        nonCashAddBacksMinor: 0,
        deltaWorkingCapitalMinor: 1.5,
        investingMinor: 0,
        financingMinor: 0,
      }),
    ).toThrow(/VALUE_INVALID/);
    expect(() =>
      buildEbitdaBridge({
        netIncomeMinor: 1.5,
        interestExpenseMinor: 0,
        taxExpenseMinor: 0,
        depreciationMinor: 0,
        amortizationMinor: 0,
        sbcMinor: 0,
        oneTimeAdjustmentsMinor: 0,
      }),
    ).toThrow(/VALUE_INVALID/);
    expect(() =>
      reconcileCashFlow(
        { operatingMinor: 0, investingMinor: 0, financingMinor: 0, netCashChangeMinor: 0 },
        { operatingMinor: 0, investingMinor: 0, financingMinor: 0, netCashChangeMinor: 0 },
        { openingCashMinor: 1.5, closingCashMinor: 0 },
      ),
    ).toThrow(/VALUE_INVALID/);
  });
});
