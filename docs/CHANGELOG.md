# CHANGELOG.md

> OneFP&A · Kept in Keep-a-Changelog format. Versions follow semver. Releases: v1.0.0+.

## [Unreleased]

- **AUDIT-05 Cash Flow (Direct + Indirect) + Non-GAAP EBITDA bridge — TS slice DONE (2026-09-22):**
  Two more of AUDIT-05's TS-verifiable statement slices, on the B18-1/B18-2 integer-money model
  (`money:ast`-clean, no float). New `src/model/cashFlow.ts` (+ `src/model/cashFlow.test.ts`,
  **15 tests**, every expected value hand-computed before the first run):
  - `computeDirectCashFlow` — the **Direct** method: operating = collections − disbursements;
    net = operating + investing + financing.
  - `computeIndirectCashFlow` — the **Indirect** method: operating = Net Income + D&A + non-cash
    add-backs − Δ working capital; net = operating + investing + financing.
  - `reconcileCashFlow` — the exact **Direct↔Indirect tie-out** (the operating and net sections must
    agree between the two methods) plus, when the cash opening/closing is supplied, the **Δ-cash
    tie-out** against the cash statement (net CF must equal closing − opening). A 1-unit drift in
    either is surfaced by name, never averaged.
  - `buildEbitdaBridge` — the **Non-GAAP reconciliation** EBIT (NI + interest + tax) → EBITDA
    (+ D&A) → Adjusted EBITDA (+ stock-based comp + one-time items), in the order the bridge is
    presented; `isBalanced` holds by construction.
  Pinned vectors: Direct (100,000 collections / 70,000 disbursements / −20,000 / +15,000) →
  operating 30,000, net 25,000; Indirect (NI 25,000 + D&A 10,000 + non-cash 5,000 − ΔWC 10,000,
  same inv/fin) → operating 30,000, net 25,000 (the two reconcile); ΔWC 20,000 → both sections
  disagree (isBalanced false); closing 99,999 → Δ-cash tie-out fails; 1-unit net drift caught.
  EBITDA (NI 25,000 + int 5,000 + tax 3,000 + D&A 10,000 + SBC 5,000 + one-time 2,000) → EBIT
  33,000 / EBITDA 43,000 / Adjusted 50,000. Money in integer minor units. **Honest scope:** TS-only
  oracle — the native per-period statement vectors and the Statement-of-Cash-Flows persistence
  (M6-2) and the S-060 UI wiring remain cargo-pending. AUDIT-05 stays PARTIAL (now with
  largest-remainder tie-out + Direct/Indirect CF + Non-GAAP bridge on the TS side). Gates:
  `npm run check` all 14 green — 113 files / **1553 tests** (15 new), coverage main
  88.46/82.78/84.69/87.86 + critical 98.35/95.41/98.08/98.28, schema 56, docs-link 190/85,
  docs:verify 74/42/103/87/21, packs 12/12, money:ast clean, tokens 16/2226, ipc:casing 88,
  command-parity 89, secret/telemetry/license PASS. Docs synced: AUDIT-VECTOR-PLAN (AUDIT-05 row +
  summary), CODE-TO-AUDIT-MAPPING (AUDIT-05 row: real `src/model/cashFlow.ts` + test). Native gates
  remain UNVERIFIED in sandbox (no Rust toolchain).
- **AUDIT-20 dual-cadence calendar — TS slice DONE (2026-09-20):** The last sandbox-verifiable slice
  of AUDIT-20 — the "Calendar test: weekly + monthly synchronized" fractional-day mapping that links
  `weekly_periods` to `monthly_periods` — is now implemented and verified as a pure, exact reference
  engine: `src/model/calendarEngine.ts` (+ `calendarEngine.test.ts`, **17 tests**), built on a new
  exact date-arithmetic primitive `addDaysToIso` added to the AUDIT-20 day-count engine
  (`src/model/dayCount.ts`, + **5 tests**, now 82). `buildDualCadenceCalendar(year, fiscalYearStart)`
  builds the 12 calendar months + the 7-day weeks over a year and the exact **week × month overlap
  matrix** (integer days each week shares with each month, via the Julian-day engine — no `Date`, no
  DST). The "synchronized" invariants are exact integer equalities: every month's column sum === its
  day count; the whole matrix sums to the year's days (365/366); interior weeks row-sum to 7, the
  spillover week to its in-year days. `allocateWeekAcrossMonths` distributes a week's value across the
  months it spans, proportional to the overlap days, via the M6-1 largest-remainder oracle so the
  pieces sum exactly to the week's total. This completes all four TS acceptance sub-parts of
  AUDIT-20 (day-count conventions, Actual/360 debt interest, 3-convention-differ, weekly↔monthly
  sync); what remains is native `core/calendar.rs`/`schedule.rs` convention wiring, the
  `weekly_periods` linked table, and store/UI wiring (cargo-pending). Pinned vectors: year 2023 → 53
  weeks, W5 [Jan 29, Feb 5) → Jan 3 / Feb 4, spillover W53 → 1 day, total 365; 2024 (leap) → 366;
  allocate 1000 on W5 → Jan 429 / Feb 571. Gates: `npm run check` all green — 112 files / **1538
  tests** (22 new), coverage main 88.41/82.75/84.66/87.79 + critical 98.35/95.41/98.08/98.28, schema
  56, docs-link 190/85, docs:verify 74/42/103/87/21, packs 12/12, money:ast, tokens 16/2226,
  ipc:casing 88, command-parity 89, secret/telemetry/license PASS. Native gates remain UNVERIFIED in
  sandbox (no Rust toolchain).
- **AUDIT-12 + AUDIT-20: 13-week cash-flow + debt interest/amortization engines — TS slice DONE
  (2026-09-20):** Two exact-decimal reference engines close the remaining sandbox-verifiable slices of
  the treasury vectors, both composed on the AUDIT-20 day-count engine and `money:ast`-clean:
  - `src/model/week13Cash.ts` (+ `week13Cash.test.ts`, **10 tests**) — the institutional 13-week
    cash-flow model (the existing `capital.ts::generate13WeekCashFlow` was a naive roll-forward with no
    floor): rolls exactly 13 weeks, maintains a **target (minimum) cash balance**, computes the
    **additional borrowing** to restore the target in any breaching week, flags the breach weeks and the
    worst (pre-borrowing) week, with a hard tie-out
    `ending_cash = opening + Σreceipts − Σdisbursements + Σfin_in − Σfin_out + Σadditional_borrowing`.
  - `src/model/debtSchedule.ts` (+ `debtSchedule.test.ts`, **17 tests**) — correct debt interest &
    amortization (the existing `calculateDebtFacility` used naive `bps/10000` + `/12`, the ~1.39%
    understatement AUDIT-20 names): `allInRateBps` (floating **SOFR** + credit spread), `periodInterest`
    (exact one-period interest composed on the day-count engine — the AUDIT-20 "debt test: Actual/360
    interest exact" and "convention test: 3 methods produce different results"), `levelPaymentAmortization`
    (exact annuity, final-period residual plug, `Σ principal === principal`, `ending === 0`), and
    `pikAccrualSchedule` (**PIK** — interest compounds into principal).
  Pinned vectors: 1M @ 5.5% over leap-2024 → ACT/360 55,917 vs ACT/365 55,151 vs 30/360-US 55,000
  (3 distinct); 120k @ 12% quarterly annuity → level payment 32,283, P1 interest 3,600, totals interest
  9,133 / principal 120,000 / payment 129,133; PIK 100k @ 12% quarterly → ending 112,551; 13-week
  week-5 dip → borrow 21,000 to restore a 50,000 target, ending 58,000. Money in integer minor units.
  **Honest scope:** this is the TS math slice — SQLite persistence tables (`cash_flow_13week`,
  `capital_assets`, `debt_facilities`, `credit_covenants`), the native `rust_decimal` schedule engine,
  SOFR curve inputs, and undrawn/commitment fees remain open (native, cargo-pending); AUDIT-20's
  weekly/monthly dual-cadence calendar linkage also remains open. Gates: `npm run check` all green —
  111 files / **1516 tests** (27 new), coverage main 88.34/82.69/84.57/87.72 + critical
  98.35/95.41/98.08/98.28, schema 56, docs-link 190/85, docs:verify 74/42/103/87/21, packs 12/12,
  money:ast, tokens 16/2226, ipc:casing 88, command-parity 89, secret/telemetry/license PASS. Docs
  synced: AUDIT-VECTOR-PLAN (AUDIT-12 + AUDIT-20 rows), CODE-TO-AUDIT-MAPPING (both rows). Native gates
  remain UNVERIFIED in sandbox (no Rust toolchain).
- **AUDIT-12 depreciation + FCCR engine — TS slice DONE (2026-09-20):** The depreciation
  roll-forward spec (`docs/MODELING-METHODS-SPEC.md` §2: "SL, DDB w/ automatic optimal switch to SL
  when SL exceeds DDB, MACRS half-year convention") and the Fixed Charge Coverage Ratio the AUDIT
  calls out as missing are now implemented and verified in the TS slice as a pure, exact-decimal
  reference engine — `src/model/depreciation.ts` (+ `src/model/depreciation.test.ts`, **36 tests**).
  `straightLineSchedule` ((cost − salvage) / life); `doubleDecliningSchedule` (200% DB with the
  **optimal Straight-Line switch** — each year the LARGER of the DB charge `book × 2/life` and the
  SL charge on the remaining book `(book − salvage)/remaining`, floored at the salvage line, one-way
  DDB→SL transition — fixing the existing `capital.ts` preview, which computed DDB Year 1 only and
  never switched, "violates ASC 360/IAS 16"); `macrsSchedule` (half-year GDS, published IRS
  Publication 946 Table A-1 percentages for the 3/5/7/10/15/20-year classes — verified each column
  sums to exactly 1.0000); `computeFCCR` (EBITDA / fixed charges, fixed charges = interest +
  mandatory debt service + mandatory lease) — the missing institutional covenant. Every schedule
  **ties out exactly**: `Σ years.depreciation_minor === total_depreciated_minor === cost − salvage`
  (SL/DDB) or `=== cost` (MACRS), integer equality, via a final-year residual plug over the ROUNDED
  prior years (no float drift). Money in exact integer minor units, `money:ast`-clean. Pinned
  vectors: DDB 10000/5-yr → 4000/2400/1440/1080/1080 (switch year 4, front-loaded); MACRS 5-yr
  100000 → 20000/32000/19200/11520/11520/5760; FCCR 10000/2000 = "5", 5000/3000 = "1.67",
  1000/2000 = "0.5" (breach), no-charge + EBITDA > 0 = comfortably covered; salvage floor;
  non-even-division plug; invariants (tie-out grid across costs/lives/salvages, non-increasing book
  ≥ salvage, one-way switch, front-loading). This is the reference the native `rust_decimal`
  schedule engine must match. **Honest scope:** this is the **depreciation + FCCR** slice of
  AUDIT-12 — the SQLite persistence tables (`capital_assets`, `debt_facilities`, `credit_covenants`,
  `cash_flow_13week`), the native schedule engine, the 13-week DB, SOFR curves, PIK, and undrawn
  fees remain open (native, cargo-pending). Docs synced: AUDIT-VECTOR-PLAN (AUDIT-12 row → PARTIAL;
  summary now lists 4 PARTIAL vectors), CODE-TO-AUDIT-MAPPING (AUDIT-12 row: real
  `src/model/depreciation.ts`, phantom `scheduleEngine.ts` noted as pending). Gates: `npm run check`
  all green — 109 files / **1489 tests** (36 new), coverage main 88.20/82.53/84.52/87.56 + critical
  98.35/95.41/98.08/98.28, schema 56, docs-link 190/85, docs:verify 74/42/103/87/21, packs 12/12,
  money:ast, tokens 16/2226, ipc:casing 88, command-parity 89, secret/telemetry/license PASS. Native
  gates remain UNVERIFIED in sandbox (no Rust toolchain).
- **AUDIT-20 day-count conventions engine — TS slice DONE (2026-09-20):** The institutional debt
  day-count spec (`docs/MODELING-METHODS-SPEC.md` §2) is now implemented and verified in the TS slice as
  a pure, exact-decimal reference engine — `src/model/dayCount.ts` (+ `src/model/dayCount.test.ts`,
  **77 tests**). Conventions: `ACT_360` (Actual/360, US corporate debt), `ACT_365` (Actual/365, UK),
  `THIRTY_360_US` (30/360 Bond Basis / US-NASD), `THIRTY_360_ISDA` (30/360 Eurobond). Calendar day
  counts are **exact integers** via the Julian-day count formula (no `Date`/float/DST — verified against
  the J2000.0 epoch 2000-01-01 → 2451545); year fractions and interest (`principal × rate × days /
  denom`) are exact `decimal.js` (28-digit). Dates are ISO `YYYY-MM-DD` validated as real Gregorian
  dates (Feb 30 / month 13 / day 0·32 / malformed / unknown-convention → locked `VALUE_INVALID`).
  Pinned vectors: full leap/century rules, every 31st-day 30/360 edge case (US Bond Basis vs ISDA
  Eurobond — e.g. 2026-01-15 → 2026-03-31 = 76 days US vs 75 ISDA), multi-decade spans, the AUDIT's
  **~1.39% understatement mechanism** (naive `/12` accrues 360 days; ACT/360 accrues the true 365 → a
  365-day year accrues exactly 365/360, an excess of 5/360 over the naive 1.0), and invariants
  (antisymmetry, additivity, sign, zero, ACT/360 ≥ ACT/365). This is the reference the native
  `rust_decimal` engine in `core/calendar.rs` / `schedule.rs` must match. **Honest scope:** this is the
  **day-count** slice of AUDIT-20 — the weekly/monthly dual-cadence calendar linkage and native
  convention wiring remain open (cargo). Docs synced: AUDIT-VECTOR-PLAN (AUDIT-20 row → PARTIAL; summary
  lists 3 PARTIAL vectors), CODE-TO-AUDIT-MAPPING v12 (AUDIT-20 row, phantom `dayCountEngine.ts`
  corrected to the real `src/model/dayCount.ts`). Gates: `npm run check` all 14 green — 108 files /
  **1453 tests** (77 new), coverage main 88.10/82.39/84.48/89.86 + critical 98.34/95.41/98.07/98.70,
  schema 56, docs-link 190/85, docs:verify 74/42/103/87/21, packs 12/12, money:ast, tokens 16/2226,
  ipc:casing 88, command-parity 89, secret/telemetry/license PASS. Native gates remain UNVERIFIED in
  sandbox (no Rust toolchain).
- **TASKBOARD reconciliation — stale M4/M5/M6 detailed rows fixed (2026-09-20):** The detailed
  "M4 — Planning" / "M5 — Analysis" / "M6 — Reporting & Governance" sub-tables were a frozen
  early-planning snapshot that contradicted the maintained, evidence-backed milestone tables —
  e.g. M4-3 `model.diff`, M4-4 what-if, M4-5 cycle, M4-6 collection, M6-2 segment, M6-3…M6-9 were
  still marked `❗ TODO` / `🟨 IN PROGRESS` although each feature is built and verified (Rust
  handlers in `commands/{model,plan,cycle,consolidation,report,export,health,audit,backup,scenario,
  fva}.rs` + TS stores + S-05x/S-06x/S-07x screens + 2026-09-07 native 264/264). Reconciled all 14
  rows to their verified milestone status with code-cited notes; accurate PARTIALs (M5-1 PVM, M5-4
  alerts, M6-1 tie-out) left intact. This staleness is exactly what made the line-40 "M4-3 next"
  plan look like open work — the line-40 feature order (M4-3/4/5/6) and HANDOVER §2 "M6-2 next
  unblocked feature" are in fact **built**; the remaining M8 work is the 25 AUDIT rejection vectors
  (mostly native/`cargo`-blocked in the sandbox). Doc-only; `npm run check` gates unaffected (no
  code change).
- **M6-1 largest-remainder tie-out oracle — TS slice DONE (2026-09-20):** The statement
  tie-out rounding spec (`docs/MONEY-ROUNDING-SPEC.md` §4, F-027) is now implemented and verified in
  the TS slice as a pure, exact-decimal reference oracle — `src/model/largestRemainder.ts`
  (+ `src/model/largestRemainder.test.ts`, **15 tests**). `largestRemainderAllocate(exactLines, unit,
  exactTotal?)` floors each exact line to the display unit (toward −∞, remainder ∈ [0, unit)),
  computes the integer-unit residual `k = (roundToUnit(total) − Σ floors) / unit`, and adds one unit to
  the `k` largest-remainder lines (deterministic stable-index tie-break); the negative branch (§4 step
  4d) subtracts from the `|k|` smallest-remainder lines when an independently computed parent sits
  below Σ floors. All arithmetic is `decimal.js` (no float, no locale, `money:ast`-clean); the only
  non-Decimal conversion is a line count. Pinned vectors: the §4/§7 000s all-tie case,
  largest-remainder-first (middle line wins), stable equal-remainder tie, HALF_UP total rounding,
  negative cost lines, sub-unit 2 dp, and a 240-case property sweep — all asserting the mandated
  invariant **`sum(displayed children) === displayed parent`** (Δ = 0, exact-decimal equality). This is
  the reference the native `rust_decimal` engine in `src-tauri/src/commands/statement.rs` must match.
  **Docs corrected:** the phantom `src/model/statement.ts` ref (cited by M6-1-DESIGN §3 /
  CODE-TO-AUDIT-MAPPING AUDIT-05) does not exist — statement math is native `statement.rs` + the B18-3
  shape mirror in `src/api/mock.ts`; the TS oracle lives in `src/model/largestRemainder.ts`. AUDIT-05 is
  now 🚧 PARTIAL (oracle done; per-period vector refactor + Direct/Indirect CF + Non-GAAP remain
  native/cargo). Docs synced: M6-1-DESIGN (§8 row + §10 addendum), TASKBOARD (M6-1 row),
  AUDIT-VECTOR-PLAN (AUDIT-05 row), CODE-TO-AUDIT-MAPPING v11 (AUDIT-05 row, phantom ref corrected).
  Gates: `npm run check` all 14 green — 107 files / **1376 tests** (15 new), coverage main
  88.03/82.28/84.39/89.79 + critical 98.34/95.41/98.07/98.7, schema 56, docs-link 190/85, docs:verify
  74/42/103/87/21, packs 12/12, money:ast, tokens 16/2226, ipc:casing 88, command-parity 89,
  secret/telemetry/license PASS; `npm run build` green (2.85s). Native gates remain UNVERIFIED in
  sandbox (no Rust toolchain).
- **AUDIT-02 Excel-parity input formats — vector DONE (M3-9 Unit W-2 · 2026-09-18):** The four
  named rejection formats (`1,250,000.00`, `(500.00)`, `$1,000`, `15%`) now parse everywhere a
  number enters the grid, to the exact decimal string, before any IPC/audit boundary. New
  `src/utils/parseFinancialNumber.ts` — a string-only exact parser (no float, no locale,
  `money:ast`-clean): plain decimals, strict 3-digit thousands grouping, accounting-negative
  parentheses (incl. `($1,250)`), one leading currency symbol, trailing `%` as an exact string
  ÷100, explicit `+`/`-`; 12-digit integer cap (i64-safe at any scale); zero unsigned
  (`-0.00` → `0.00`); rejections: sci-notation, broken grouping, double/mixed signs,
  sign-in-parens, interior whitespace, `USD 100`, `5.`/`.5`. **59 string tests** (35 accepted /
  24 rejected + count guard) in `src/utils/parseFinancialNumber.test.ts`. Wired into paste
  (`parsePasteCell`, `src/stores/modelHistory.ts`), the S-041 formula bar (`applyFormulaBar`
  normalizes before `setCell`), and a typed `VALUE_INVALID` boundary guard in
  `src/workers/modelEngine.ts` `setCell` (raw non-decimal strings throw the locked code, never a
  raw Decimal error — defense in depth; cell writes already audit via `model.cell.set.v1`).
  **S-041 keyboard suite: 21 key-event tests** (13 app-owned effects — Ctrl+Z undo, Ctrl+Shift+Z
  redo, Ctrl+Y redo, F2 focus formula bar, 4× Shift+arrow selection extend/retract, formula-bar
  Enter ×2 with normalization `(500)` → `value: "-500"` audited, formula-bar Escape cancel, 2
  typing-guards where Ctrl+Z/F2 inside the input are left to the browser; 8 AG-Grid pass-through
  tests asserting no history movement and no audited write) + 1 paste-dialog accounting-format
  test (`(500)\t1,250,000.00` → cells `-500` / `1250000.00`). No new i18n strings (locked
  `VALUE_INVALID` only). Docs synced: AUDIT-VECTOR-PLAN (AUDIT-02 row ✅ DONE; AUDIT-17 false
  "364 lines / 6 tests" claim corrected to 646 lines / 12 tests; summary 1 of 25),
  CODE-TO-AUDIT-MAPPING v10 (real files — the FormulaBar/CellEditor components it named never
  existed), SCREENS-SPEC S-041 (accepted input formats + keyboard map), TASKBOARD M3-9 rows.
  Gates: `npm run check` all green — 106 files / **1361 tests**, coverage main 87.99/82.28/84.31/
  87.35 + critical 98.35/95.41/98.08/98.28, schema 56 tables, docs-link 190/85, docs:verify
  74/42/103/87/21, packs 12/12, money:ast, tokens 16/2226, ipc:casing 88, command-parity 89,
  secret/telemetry/license PASS; `npm run build` green. Native gates remain UNVERIFIED in
  sandbox (no Rust toolchain).
- **M5-1 PVM engine repaired — the tree is green again (AUDIT-17 · 2026-09-18):** The 2026-09-09
  "PVM engine" shipped as a **Rust draft saved in a `.ts` file** — it failed the TypeScript gates
  (eslint parse errors in `src/model/varianceEngine.ts` and the S-054 page header) and its "6 tests
  executed" claim was false (the engine could not be parsed; the `tests/unit/*` files cited in
  CODE-TO-AUDIT-MAPPING never existed). Repaired honestly: `src/model/varianceEngine.ts` is now real
  TypeScript — 5-factor Price-Volume-Mix decomposition (ΔV/ΔP/ΔM/ΔFX/ΔE) in exact integer minor units
  with decimal.js 6-decimal HALF_EVEN ratio arithmetic, HALF_UP minor-unit conversion, divisors guarded
  (no Infinity/NaN), and the sum-of-parts invariant holding **by construction** (efficiency = explicit
  residual). Documented degradation: missing quantity or mix data zeroes those factors exactly and the
  residual absorbs them (`isResidualDerived` reports it); a missing FX rate is an exact zero
  (single-currency), not degradation. New `src/model/varianceEngine.test.ts` — **12 tests executed**
  (the six documented names + mix degradation, negative variance with FX, the 6-decimal precision
  boundary, the degenerate zero-rate guard, the corruption message, and i64-scale exactness). The
  variance store now runs the engine's defensive `verifyPvmInvariant` over every attributable
  `variance.get` row (`pvmCheck: {rowsChecked, violations}`, +4 store tests) — a tamper guard on
  attribution data, not a calculation path. The malformed S-054 header comment is repaired; the false
  "6 tests executed" claims are corrected in TASKBOARD (M5-1 rows) and CODE-TO-AUDIT-MAPPING (AUDIT-17).
  Gates: `npm run check` all green. Native gates (cargo, desktop round-trip) remain UNVERIFIED in
  sandbox — no Rust toolchain, network to install it blocked.
- **Hardening batch (2026-09-08, ADR-032 · follows the 2026-09-07 artisan audit):**
  `company.restore_year` (103rd typed command — archive is now a fully restorable mark: one
  transaction, HMAC-chained audit event, idempotent on active labels); `ARCHIVE_IN_USE_REF`
  goes from documented-guard to **emitted** (`company.clone_sandbox` refuses while the source
  carries an archived FY); **`command:parity` gate** wired into `npm run check` — three-way
  registry agreement (Zod ↔ mock ↔ native+engine, ownership checked) closes the
  documented-but-unanswerable / shipped-but-undocumented failure classes for good;
  **migration-equality Rust test** (v1→latest path must equal a fresh install's
  `sqlite_master` — lossy down-migrations caught pre-ship); `archive_year` FY resolution
  refactored to a single COUNT query; repo hygiene: MIT `LICENSE` (+ package/Cargo fields),
  root `SECURITY.md`/`CONTRIBUTING.md`/`CHANGELOG.md` pointers, dated artifacts → `audits/`,
  `docs/CI-ADDITIONS.md` owner runbook (row 65), remediation board statuses + `WS-12` card
  (archived-period write-gating). Ground truths: 103 commands, 87 error codes.
- **Pack re-issue 2.1.1 — zero validation warnings (WS-10 · B15 · 2026-09-06):** All 12 Industry Packs now carry the
  §3/§4 pack-spec surface the validator warned about (132 legacy warnings → **0**): every KPI has an engine-line-key
  `formula` (canonical `revenue`/`cogs`/`gross_profit`/`opex`/`ebitda` + prior-year `_py` variants + the pack's own
  driver keys — same grammar the S-023 builder emits) and numeric `bands {good, watch}` aligned with each target's
  direction, so Alert thresholds no longer fall back to target-only; every driver template declares non-empty `links`
  (the planning lines consuming it), restoring Federation/attribution wiring. Pack versions bumped 2.1.0 → **2.1.1**;
  data-only, no code paths touched; `packs:validate` green with zero warnings.
- **M6-7 Model Health Check — engine + waiver + S-071 (F-032 · US-033 · SCREENS-SPEC S-071 · API-SPEC §16, 2026-09-05):**
  Shipped the Model Health Check at `/app/governance/health` (`src/pages/s071-health/`, code-split). Geometry follows
  WIREFRAMES-ANALYTICS §S-071: five category rows (tie-outs · references · rounding · driver feeds · anomalies), a finding
  table (severity · message · `→ cell`) and the footstrip "N blocking · M warnings" with the export verdict. All five
  canonical states ship — the loading state is deliberately **indeterminate**: the command answers once, so a percentage
  would be fabricated (the categories being worked through are shown instead).
  New native engine `src-tauri/src/commands/health.rs` (registered in `lib.rs`, **64** handlers) runs the five documented
  categories against **real persisted rows**, never a stub: `tie_out` asserts committed GL balances to exactly 0 per Fiscal
  Period under the debit-positive/credit-negative store (GL-TEMPLATE-SPEC §3) and flags any committed batch carrying
  `tie_out_status='fail'`; `reference` runs every authored `model_values.formula` through the same whitelist gate the grid
  uses (`core::model::validate_formula`, B14 — one owner) and resolves every `account_id`/`driver_id`; `rounding` is HARD
  when a money cell holds text instead of exact integer minor units (MONEY-ROUNDING-SPEC §1) and WARN when a money Line's
  `decimals` disagrees with the Company's Currency Scale; `driver_feed` requires every consumed Driver to be fed for every
  (scenario, period) the Model actually holds values for, reporting the exact missing count; `anomaly` reports
  declared-bounds breaches on Drivers/Assumptions and period-over-period money moves above 5× the prior magnitude.
  **Nothing is ever auto-fixed** (QA-CHECKLIST F-032 item 3): the module issues no UPDATE/DELETE against Model, Driver or GL
  data, and the screen carries no "fix" affordance (both asserted by tests). Money comparisons are integer `amount_minor`;
  bounds/swings use `rust_decimal` on the stored decimal strings — no float anywhere (B3/B18-2).
  **A failing Model is a report, not an exception.** `health.run` has no error row: findings ride the response with
  `blocking_count` = unwaived HARD findings. `HEALTH_CHECK_BLOCKED` is newly mapped in `core/error.rs` for the *export* path
  (M6-6) to raise when an export is actually attempted, bound to that count — it is never thrown by the check itself.
  **The waiver costs a reason, and it is the only escape** (D-010 / US-033). `health.waive` rejects a blank reason with the
  newly mapped `HEALTH_WAIVER_REASON_REQUIRED` (422, verbatim catalog text), persists reason + actor in `waivers` and writes
  an HMAC-chained `health.waive` audit event. The waiver panel is **never inline on the finding row** — the friction is the
  point — and its confirm button stays disabled until a non-blank reason exists and the Company is writable. Waived findings
  **stay visible** with reason and author. Waivers **survive a re-run**: a finding's cross-run identity is its fingerprint
  (`category|severity|entity_ref|message`), not its row id, and the carry-forward copies the original reason/actor/timestamp
  verbatim while minting **no new audit event** (re-stating a recorded decision, not creating one).
  `entity_ref` is a typed pointer (`cell:` · `line:` · `driver:` · `assumption:` · `period:` · `batch:`) and S-071 offers
  "→ cell" **only** for the `cell:` form — no fabricated navigation target for the rest.
  Contracts: `HealthRunArgs`/`HealthWaiveArgs`/`HealthRunData`/`HealthWaiveData`/`HealthFindingRecord`/`HealthCategoryResult`
  in `src/api/schema.ts` (`.strict()`; `reason` is `.trim().min(1)` so a blank waiver cannot even reach the wire), a dev
  mirror in `src/api/mock.ts` exercising every severity and ref shape with a session-lived waiver ledger, and
  `src/stores/health.ts` (report-vs-error rule, local D-010 gate, re-run after waive so every count comes from the engine,
  `parseEntityRef`). Docs synchronized: API-SPEC §16 (full detailed spec incl. the category table), TASKBOARD (M6-7 row,
  screen tracker, command tracker, gap table, dashboard, counts), TODO and this changelog. New tests: **54** (24 page incl.
  4 axe states, 15 store, 15 contract) plus **21** Rust unit tests covering each category in isolation, the clean baseline,
  excluded/uncommitted GL, waiver carry-forward, the single-audit-event rule, cross-Company refusal and both error bodies.
  **NATIVE-UNVERIFIED:** this sandbox has no Rust toolchain and no network to install one — `cargo test`/`clippy`/`fmt` over
  `commands/health.rs` are pending on a Rust-equipped machine, so M6-7 stays 🚧 PARTIAL, never ✅.
- **M6-8a Audit Trail — `audit.list` + S-070 (F-033 · US-034 · SCREENS-SPEC S-070 · API-SPEC §15, 2026-09-05):**
  Shipped the Audit Trail at `/app/governance/audit` (`src/pages/s070-audit/`, code-split; `/app/governance` now lands here).
  Geometry follows WIREFRAMES-ANALYTICS §S-070 exactly: toolbar (inclusive date range · actor ▾ · action ▾ · object ▾ ·
  chain chip), virtual-ready event list (ts · actor · action · object) with per-row expansion to the **verbatim**
  `before_json`/`after_json` payload plus the hash link to the previous event, and a footstrip with the chain event count.
  All five canonical states ship, including a distinct "No events match these filters" empty with a clear-filters action.
  **The chain verdict is data, not an error** (US-034): a tampered Company renders a persistent read-only banner + ✗ chip
  naming the failing `seq` while every event stays readable — `AUDIT_CHAIN_BREAK` as a thrown error remains reserved for
  mutations (AUTH-SPEC §2.5). The screen has **no edit/delete affordance of any kind** (B7, asserted by a test), and the
  Data-Room / Export-log buttons ship **disabled** with an explanatory title because `audit.export_dataroom` has no handler
  yet (B18-5/7 — never a button that fabricates a file). Money is never parsed out of event payloads: the strings returned
  are the exact hashed bytes and are printed as-is (B3/B6).
  New native handler `src-tauri/src/commands/audit.rs` (registered in `lib.rs`, 62 handlers): Company-scoped, read-only,
  one-transaction snapshot for count + page + facets; stable `seq DESC` paging at 50/page; bound (never interpolated) filter
  parameters with blank-as-absent semantics; facets computed over the **whole** chain so a zero-result filter stays reversible;
  verification delegated to the existing `company::verify_company_chain` keychain replay (ADR-011/B14 — no second
  implementation). 8 Rust unit tests accompany it (company scoping, filters vs facets, inclusive date bounds, blank filters,
  broken-chain readability, pagination stability + page-0 rejection, verbatim payloads, empty company).
  Contracts: `AuditListArgs`/`AuditListData`/`AuditEventRecord`/`AuditChainStatus`/`AuditFilters` in `src/api/schema.ts`
  (`.strict()` — an unknown filter key is rejected at the boundary), a dev mirror in `src/api/mock.ts` with a genuinely
  chain-linked fixture, and `src/stores/audit.ts` (filters reset to page 1, pagination guards, stale rows cleared on error).
  Docs synchronized: API-SPEC §15 (full detailed spec), TASKBOARD (M6-8 row, screen tracker, command tracker, dashboard),
  TODO and this changelog. New tests: 45 (19 page incl. 4 axe states, 13 store, 13 contract). Full suite **82 files /
  1002 tests**; coverage 88.11/80.20/87.07/89.95 (≥85/80/80/85); critical 98.52/97.15/100/98.96 (≥95/90/90/95);
  lint/tsc/build/prettier/docs:verify 60/42/97/99/packs 12/12/money:ast/security all green.
  **NATIVE-UNVERIFIED:** this sandbox has no Rust toolchain and no network to install one — `cargo test`/`clippy`/`fmt` over
  `commands/audit.rs` are pending on a Rust-equipped machine, so M6-8 stays 🚧 PARTIAL, never ✅.
- **M5-4 Alerts engine + Alerts Center — TS slice (F-026 · SCREENS-SPEC S-056 · API-SPEC §7 alerts.*, 2026-09-05):**
  Added the Alerts Center at `/app/analyze/alerts` (`src/pages/s056-alerts/`): alert list grouped by severity with first-class
  expandable trigger-chain rows (rule → value → threshold → period, exact decimal strings rendered verbatim), severity/dismissed
  filters, the rule manager (create threshold per KPI or line; digest ≤1/24h and 90-day retention shown as engine facts, never
  fake toggles), all five canonical states incl. the spec's "All clear" empty copy, and a typed-code error view. Store
  `src/stores/alerts.ts` (9 tests) owns load lifecycle, filter-driven reload, an inline create-error contract that never blanks
  the list, retry-as-read, and selectors. Contracts in `src/api/schema.ts`: `AlertRuleInput` mirrors the locked `alert_rules`
  DB CHECK domains (`lt|lte|gt|gte|eq`, `info|warning|critical`), enforces exactly one of `kpi_id`/`line_ref` via refine, and
  accepts only exact-decimal thresholds (`DecimalString` — no float path, B3); `alerts.list` → `{alerts[]}`, `alerts.create_rule`
  → audited `{rule_id, audit_id}`. Dev mock (`src/api/mock.ts`) mirrors the native validation detail-for-detail (9 contract tests
  pin the exact `ALERT_RULE_INVALID` user texts "Alert rule invalid: …" per ERROR-HANDLING) and the SESSION_LOCKED 401 gate.
  Native `src-tauri/src/commands/alerts.rs` authored + registered in `lib.rs` (61 handlers): list fires due rules first (draft
  scenarios only — locked history never fires, US-027; once-per-UTC-day open-alert dedupe), 90-day window, HMAC-chained audit on
  rule create; `ALERT_RULE_INVALID` mapped in `core/error.rs` (existing catalog row — no new codes). **NATIVE-UNVERIFIED:** no Rust
  toolchain in this environment (brace-balance hand gate 34/34 only); cargo/clippy/fmt + round-trip pending on a Rust-equipped
  machine → M5-4 recorded PARTIAL. Deliberately not fabricated: dismiss/mute (no `alerts.dismiss`/`alerts.mute_rule` catalog rows

### 2026-09-06 — Alerts Center, honest state (M5-4)
  machine → M5-4 recorded DONE. `alerts.dismiss` / `alerts.mute_rule` handlers (already
  shipped in Rust mono, HMAC-audited) gained their API-SPEC catalog rows (§7), the dev-preview
  mock mirrors both, the S-056 store adds the real store actions, and the alert-row Dismiss
  affordance now calls `alerts.dismiss` and reloads the list — Network Rule B1, no local-only
  fabricated state. CHANGELOG 97 → 99 typed commands is reconciled here with the matrix/CHANGELOG.
  Later the same day: 99 → **102** when `security.pin_setup` / `assumption.waive` (shipped Rust
  handlers whose catalog rows were missing — same drift class as alerts.dismiss/mute_rule) and
  `pack.validate` (§17 detailed spec + first handler of the 23-command no-handler backlog) gained
  their rows; §2B validator prefixes gained `PIN_ALREADY_SET` / `PIN_NOT_INITIALIZED`.
  — Tier-3), KPI-rule evaluation (waits for the M6-4/5 KPI engine), OS-notification opt-in (deferred). New tests: 34
  (16 page incl. axe, 9 store, 9 contract) + 3 schema; full suite 79 files / 957 tests; coverage 88.05/80.19/87.05/89.84;
  critical 98.5/97.15/100/98.95; lint/tsc/build/prettier/docs:verify green.
- **M6-1 Statement suite — TS slice & gate restoration (F-027 · SCREENS-SPEC S-060 · API-SPEC `statement.get.v1`, 2026-09-05):**
  Repaired and hardened the S-060 Statements screen (`src/pages/s060-statements/`): the page previously used a nonexistent
  `StatePanel` `variant` API and rendered a heading hierarchy that failed the installed axe ruleset; it now renders the canonical
  five states, an h2-sectioned P&L/BS table where **every money value renders through `MoneyCell`/`formatMinor` from engine
  decimal strings only** (B6 — the UI derives nothing monetary), tie-out/rounding status chips ("Tie-out: Pass/Fail",
  "Rounding: Exact/Approximate"), IFRS/US-GAAP preset + zero-decimals/thousands/LRA toggles with URL round-trip, and honest
  "pending" empty states for CF/SoCE/segment. CF preset/route-param branches now run through `MemoryRouter` fixtures.
  Added `src/stores/statements.test.ts` (13 tests: state machine, typed `BridgeError` mapping incl. `STATEMENT_TIE_OUT_FAILED`
  with `fix_list` details, stale-row clearing on failed retry, reset, selectors) and expanded `src/api/statements.test.ts` to
  11 contract tests (typed args, populated envelopes, `STATEMENT_SOURCE_MIXED`). Added the `bu_scope.kind === "single"` ⇒
  `bu_id` refine to `StatementGetArgsSchema` (VALUE_INVALID at the IPC boundary instead of an untyped serde error; +1 schema
  test). Hand-reviewed `src-tauri/src/commands/statement.rs` (no Rust toolchain in this environment — **cargo gates NOT run**)
  and fixed two contract holes: the flat command arg is now `r#type` (Tauri 2 unraw → the catalog key `type`) and `BuScope` is
  internally tagged `{ "kind": … }` to match the wire shape. Also shipped store edge suites for FVA (13) and What-if (12),
  model-history guard tests, and bridge normalization tests; fixed repo-wide prettier drift (~28 files, `pnpm-lock.yaml`
  ignored) and restored the global coverage gate: **76 files / 920 tests**, branches 80.07% (≥80), critical files
  98.46/97.15/100/98.92 (≥95/90/90/95), lint/tsc/build/prettier/docs:verify all green. Native statement round-trip, largest-
  remainder oracle fixtures vs §MONEY-ROUNDING-SPEC §3–5, and remaining S-060 elements (period selector, BU/Group scope UI,
  export, drill-down) stay open → task remains 🚧 PARTIAL.
- **M5-3 FVA Engine & S-055 Screen (F-025 · SCREENS-SPEC S-055 · API-SPEC fva.get, 2026-09-05):**
  Added Forecast Value Add (FVA) scoring via native Rust command `fva_get` (`fva.get` in `src-tauri/src/commands/fva.rs`).
  Implemented exact Decimal arithmetic for MAPE (Mean Absolute Percentage Error), Bias (Mean Directional Error), and Hit Rate
  (within $\pm 5\%$ tolerance band) with MidpointAwayFromZero rounding, version count threshold ($\ge 3$ forecast versions required
  to score a line, returning empty state when $<3$), and `FVA_RESTATEMENT_FLAG` detection when actuals batches are rolled back or
  restated. Added Zod schemas in `src/api/schema.ts` and dev mock bridges in `src/api/mock.ts`. Built `useFvaStore` (`src/stores/fva.ts`)
  supporting all 5 canonical screen states, horizon and version set selection, KPI aggregations, and BU rollup strips. Implemented
  accessible S-055 FVA screen (`src/pages/s055-fva/`) with 3-up KPI score cards, accessible formula modal, persistent restatement
  banner above MAIN, by-line table with accessible trend chips (never color alone), BU rollup strip, CSV export, lazy routing
  at `/app/analyze/fva`, and full test coverage (3 cargo tests, 32 vitest tests across schema, mock, store, and S-055 page, vitest-axe clean).
- **M5-1 Variance Engine & M5-2 Attribution & Reason Codes (F-024 · SCREENS-SPEC S-054 · API-SPEC variance.*, 2026-09-05):**
  Added variance calculation and attribution decomposition via native Rust commands (`variance_get` and `variance_set_reason_code`
  in `src-tauri/src/commands/variance.rs`). Implemented exact integer-minor arithmetic, Decimal percentages (`calculate_decimal_pct`
  with HalfUp rounding), account nature-driven Favorable/Unfavorable classification (`determine_fu`), 3-Way comparisons (Plan vs
  Commit vs Actuals), attribution breakdown (Volume, Price, Mix, FX, Efficiency) with sum-of-parts guarantee, and typed domain
  errors `VARIANCE_SOURCE_MIXED` and `VARIANCE_NO_ATTRIBUTION_DATA`. Added Zod IPC schemas and browser dev mock bridges with
  realistic 3-way fixtures. Built `useVarianceStore` (`src/stores/variance.ts`) supporting all 5 canonical screen states, 3-Way
  view toggle, period/BU/account category filters, and reason code persistence with HMAC audit event writing. Implemented
  accessible S-054 Variance page (`src/pages/s054-variance/`) with 3-Way view, distinct F/U status badges (never color alone),
  interactive commentary modal with standard taxonomy, SVG Waterfall chart toggle, CSV export, lazy routing at `/app/analyze/variance`,
  and full test coverage (7 cargo unit tests, 136 vitest unit tests across schema, mock, store, and S-054 page, vitest-axe clean).
- **M4-5 Planning Cycle Manager & M4-6 Input Collection Loop (F-021 · SCREENS-SPEC S-053 · API-SPEC cycle.* / collection.*, 2026-09-05):**
  Added full planning cycle lifecycle tracking and driver input collection loop via native Rust commands (`cycle_start`,
  `cycle_task_update`, `cycle_checklist_status`, `collection_export`, `collection_import`, `collection_resolve_conflict` in
  `src-tauri/src/commands/cycle.rs`). Implemented task dependency checking, milestone status progression, conflict detection
  on structure change or concurrent driver submissions, and typed errors `CYCLE_NAME_DUP`, `CYCLE_TASK_BLOCKED`, `COLLECTION_CONFLICT`,
  and `COLLECTION_STRUCTURE_CHANGED`. Added Zod IPC schemas and dev mock bridges with conflict simulation. Implemented
  `useCycleStore` (`src/stores/cycle.ts`) supporting all 5 canonical screen states (`empty`, `loading`, `error`, `success`,
  `populated`), milestone advancement, close checklist completion, export template generation, and interactive conflict
  resolution. Built accessible S-053 Planning Cycle page (`src/pages/s053-cycle/`) with milestone progress band, period close
  board, driver collection status, conflict queue modal with accessible form controls, lazy routing at `/app/plan/cycle`,
  and comprehensive test coverage (166 cargo unit tests, 21 vitest cycle tests, vitest-axe WCAG 2.2 AA compliant).
- **M4-4 What-If, Sensitivity & Goal Seek (F-023 · SCREENS-SPEC S-052 · API-SPEC §2 plan.*, 2026-09-05):**
  Added What-If analysis, waterfall decomposition, driver sensitivity tornado, and goal seek bisection solving via native
  Rust commands (`plan.whatif_overlay`, `plan.sensitivity`, `plan.goal_seek` in `src-tauri/src/commands/plan.rs`). Implemented exact
  Decimal arithmetic, strict iteration and tolerance bounds ($\le 100$ steps, $1\text{e-}9$ precision), and typed domain errors
  `GOAL_SEEK_NO_CONVERGE`, `SENSITIVITY_OUT_OF_BOUNDS`, and `COMPARE_INCOMPATIBLE`. Added Zod IPC schemas and mock bridges.
  Implemented `useWhatifStore` (`src/stores/whatif.ts`) supporting all 5 screen states (`empty`, `loading`, `error`, `success`,
  `populated`). Implemented accessible S-052 What-If screen (`src/pages/s052-whatif/`) with 3-pane layout, time-series overlay,
  waterfall attribution, accessible SVG charts with table toggles, Sensitivity & Goal Seek tabs, and `Apply to new Scenario`
  write-path dialog. Added lazy routing at `/app/plan/whatif` and complete test coverage (164 cargo tests, 752 vitest tests).
- **M4-3 Model Compare & S-051 Screen (F-022 · SCENARIO-VERSION-SPEC §4 · SCREENS-SPEC S-051, 2026-09-05):**
  Added two-way cell diff between Scenarios and Versions via `model.diff` IPC command. Implemented Rust native handler
  in `src-tauri/src/commands/model.rs` validating scenario model matching, returning `COMPARE_INCOMPATIBLE` (HTTP 422, non-retryable),
  calculating integer minor unit deltas, and computing exact Decimal-based Δ% (`delta_pct = delta / |A|`, null when A=0,
  never Infinity/NaN). Added `useCompareStore` (`src/stores/compare.ts`) supporting all 5 screen states (`loading`, `error`,
  `empty`, `success`, `populated`), changed-only filtering (default true), and CSV export. Implemented accessible S-051 Model Compare page
  (`src/pages/s051-compare/`), code-split lazy routing at `/app/plan/compare`, and comprehensive test coverage (162 cargo unit tests,
  724 vitest tests, axe-clean WCAG 2.2 AA).
- **Taxonomy truth pass + the review guard (2026-09-05, ADR-027):** the 17 undefined code citations surfaced by the revived
  `docs:verify` guard were classified **against the binary**, and the catalog turned out to be right — admitting them would have
  been the damage. `ERROR-HANDLING.md` gains **§2B** (the seven validator *message prefixes*, each bound to the governing §2 code
  it is sent under — `RowIssue.code` carries the real code, `message` carries `PREFIX: detail`, and the Rust tests assert the
  prefixes verbatim) and **§2C** (nine names reserved by specs for capability that is not built, with no copy until the owning
  feature lands). Catalog stays **99**; `DOCS-INDEX` row 19 corrected (it still said "~75-code") and row 35 (22 ADRs → 27).
  `API-SPEC.md` `INVALID_ARGUMENT` → **`VALUE_INVALID`** (`core/error.rs:168` maps the Rust variant to it). `docs-verify` 7b
  drops its hand-maintained baseline entirely: §2B is now its only exemption source, a prefix naming a non-existent governing
  code fails the run, and a malformed §2B row fails the count — verified with four probes (invented code → FAIL, §2B prefix →
  PASS, §2B malformed → FAIL, clean → PASS). `CODING-STANDARDS.md` §7 gains item 8, the anti-hallucination review step that
  closes checklist #61. **KI-015 closed, KI-016 closed** (diagnosis in that entry explains why "admit 7 codes" was wrong),
  **KI-018 opened**: the unknown-account branch of GL Import reuses `MAP_ACCOUNT_AMBIGUOUS`, so a code matching *nothing*
  renders "Account code maps to multiple Accounts ()." — the fix is a new `MAP_ACCOUNT_NOT_FOUND` + core + mock + test, which
  needs `cargo`/`vitest` and therefore not this sandbox.
- **Documentation gap closure, round 2 (2026-09-05):** suite 59 → **60 docs/ specs** (`DOCS-INDEX.md` row 61; the
  `docs:verify` claim, `README.md`, `../audits/HANDOVER.md`, `../audits/CONTINUE-PROMPT.md`, `ARCHITECTURE.md`, `docs/CLAUDE.md` and the
  traceability note moved with it). New `PRICING-AND-ENTITLEMENTS.md` closes checklist #90 by separating what is
  settled from what is a business call: §1 records the verified truth (the license `plan` field is signed, stored and
  displayed, and **enforced nowhere** — grep-confirmed across Rust and TS), §2 the constraints any policy inherits
  (offline Ed25519 means every entitlement change is a re-issued payload; a local gate is advisory, never a boundary;
  the governance floor — audit, exactness, export, encryption, backup — can never be tiered), §3 the one sanctioned
  seam (pure evaluator, no new command, no migration, deny path core-side), §4–§5 an axis sheet and a **proposed**
  price table, §6 the five owner decisions D1–D5, §7 the interim rule that no code may branch on `plan`.
  `DOCS-INDEX.md` row 14 also corrected: the schema summary still said 33 tables where the spec says 56.
- **Registered, not fixed:** `KNOWN-ISSUES.md` **KI-017** — `money:ast` fails on this checkout with 4 findings that all sit on *percent/ratio* formatting (`s051-compare` `toFixed`, `model.rs` `as f64` for `delta_pct`), while `TASKBOARD.md` records the gate green; whether ratios are in B3's scope is the owner's call, and separately the gate prints a character offset where it should print `line:col`, so CI output cannot be acted on. Also **KI-016** (superseded same day by ADR-027): the 17 undefined code refs were first read as "7 shipped codes missing from the catalog"; classified against the binary they are 7 validator message prefixes, 1 leaked Rust type name, and 9 unbuilt forward references — so the catalog stays 99. See the taxonomy-truth-entry above.
- `money-ast.mjs` **locator fixed** (KI-017's tooling half): every finding now carries `line:col` plus the source line. Float ops and `REAL` columns previously had no location at all, and the `toFixed` finding printed a raw character offset — `(4147)` in a 429-line file. Report-only, proven against the previous revision: same 4 findings, same RC=1, offsets 1421/4147 map exactly onto `33:44` / `133:49`. No pattern, exclusion or threshold was touched; the percent-vs-money scope call stays with the owner.
- **KI-015 guard fixed (2026-09-05):** the API error-code check in `docs-verify.mjs` could never fire (unsatisfiable
  condition) and its regex was unusable (55 all-caps hits on `API-SPEC.md` — `NULL`, `JSON`, section titles). §7b now
  reads codes from the three shapes the suite uses (Errors cell of a catalog row, backticked token, `"CODE: "` prefix in
  a JSON example), parks the 6 pre-existing undefined refs in `UNDEFINED_CODE_BASELINE` which **may only shrink** (an
  entry that becomes defined or stops being cited fails the run), and aborts the gate if a planted probe code is not
  caught — verified by three mutation probes. No spec text was changed: admitting any of the 17 suite-wide orphans is
  a `ERROR-HANDLING.md` §2 decision (OQ-11), not a script edit. Resolved the same day by ADR-027 — see the taxonomy-truth entry above for why admitting the 7 was the wrong fix.
- **Documentation gap closure (2026-09-04):** audited the suite against the 101-item pre-build checklist and closed
  the four gaps that were blocking build-session quality, taking the suite from 54 to **59 docs/ specs**
  (`DOCS-INDEX.md` rows 56–60; `docs:verify` claim updated to match). New: `COMPETITIVE-ANALYSIS.md` (checklist #4/#5 —
  9-vendor pricing + feature matrix with sourced figures, per-vendor weaknesses, wedge, positioning statement,
  anti-positioning), `WIREFRAMES-CORE.md` + `WIREFRAMES-ANALYTICS.md` (#20 — layout grammar R1–R8, region geometry for
  all 42 screens + 10 dialogs; this pair owns **geometry**, DESIGN-SYSTEM still owns look, SCREENS-SPEC still owns
  content/states), `COPY-GUIDELINES.md` (#24 — voice, string mechanics, per-slot copy formulas, locked verb/noun
  lexicon, 33-key i18n seed registry; error `userMessage` stays owned by `ERROR-HANDLING.md`), and
  `DOCUMENTATION-GAP-ANALYSIS.md` (#101 audit + remaining-gap register + parking lot OQ-01…OQ-11, which also closes the
  missing Open-Questions doc). Root `CLAUDE.md` + `AGENTS.md` added as pointer-only agent entry files (no duplicated
  rules, B9) — `.codex/AGENTS.md` referenced a root `AGENTS.md` that did not exist. Docs-only change: no product
  behavior, schema, command or UI string in code was touched.

### Fixed
- **M3-6 S-045 Headcount Plan TS slice (2026-09-04):** added the strict headcount specialization of
  `model.schedule.upsert` with `schedule_id`, `recalc`, and positive `audit_id`; exact Decimal-string
  compensation, inclusive fiscal-period day-count proration, additive bonus/benefits/employer-load,
  linear ramp, deterministic row ids, org tree, driver-data hand-off, schedule/rollup UI, all five
  states, ARIA/axe coverage, and typed `HC_DATE_INVALID`/`HC_OVERLAP` validation. ADR-026 admits those
  two domain codes to the canonical 99-code catalog. This is **PARTIAL/NATIVE-UNVERIFIED**: the browser
  mock and session cache remain in the product path, while native schedule persistence/calculation,
  HMAC audit implementation, and cargo/desktop gates remain required for DONE.
- **S-050 five-state correctness + doc canonicalisation (M4-2 PR B, 2026-09-04):** `stores/scenarios.ts` now recomputes `status` after every mutation refresh, so the first create moves the page empty→populated and deleting the last Scenario returns populated→empty (the page renders its five states off `status`). Narrative specs that named the locked-edit error `SCENARIO_LOCKED` (AUTH-SPEC, SCREENS-SPEC S-041, USER-FLOWS, USER-STORIES) now use the catalog code `MODEL_CELL_LOCKED` (ERROR-HANDLING; emitted table-driven by the mock since PR A). The S-050 table intentionally omits the spec's Created column until `scenarios.created_at` exists in the DB schema — recorded in DECISIONS ADR-023, never faked.
- **KI-013 auth copy + lockout countdown (F-001/S-001, 2026-09-04):** S-001 renders the `AUTH_LOCKED` lockout as a live **seconds** countdown driven by `retryAfterMs` (1 s interval cleared on unmount/at 0; submit disabled until expiry; AUTH-SPEC §2.2 30 s fallback), replacing the misleading whole-minute floor. The three ERROR-HANDLING §A user texts are aligned verbatim in `src/api/mock.ts` and `src-tauri/src/core/error.rs` (string literals only, NATIVE-UNVERIFIED — no cargo in sandbox) and in the i18n/e2e/App fixtures: "Incorrect PIN." / "Too many attempts. Try again in {countdown}s." / "Session locked. Unlock to continue." New S-001 page tests (countdown, 30 s fallback, unmount cleanup, axe) + i18n key test → **52 files / 574 tests**.
- Retry flags for `AUTH_PIN_INVALID`/`AUTH_LOCKED`/`SESSION_LOCKED` now match ERROR-HANDLING §A exactly (401/false, 423/true+`retryAfterMs`, 401/false) across core, mock, and schema fixtures.

### Added
- **M4-1 Hybrid Period Labeling & Actuals/Forecast Boundaries (F-021 · GLOSSARY §11b · MODELING-METHODS-SPEC §5, 2026-09-04):**
  Added canonical `generatePeriodLabel` formatting (`ACTUAL`, `FORECAST`, `PLAN_ONLY`, and en-dash range `HYBRID (Actual P01–Pxx, Forecast Pyy–Pzz)`),
  reactive store tracking in `src/stores/model.ts`, accessible WCAG 2.2 AA toolbar badge (`PeriodStateBadge`), and AG Grid styling
  with distinct actual/forecast tints and right-boundary separator in S-041 (`src/pages/s041-model-grid/index.tsx`). Unit tests added
  in `periodLabel.test.ts` (14 tests) and `model.test.ts` (+6 tests).
- **M4-2 S-050 Scenario Manager + S-041 Scenario picker (F-022, PR B, 2026-09-04):** the Scenario Manager page (`/app/plan/scenarios`, with `/app/plan` redirecting there) renders off `stores/scenarios.ts` with all 5 screen states — loading / error(+typed code, Retry) / empty (no-Company vs Create-Base) / success / populated. The lifecycle table shows name, type, state (coloured chip **with text**, B11), base scenario, version chips (title = label + created date), the Baseline badge, and the state-appropriate actions (canonical order submit → approve → lock → baseline → duplicate → reopen → delete): Lock and Delete use the D-004 two-step "type the Scenario name to confirm"; Reopen and Baseline-replacement demand a written reason (`BASELINE_REPLACE_REASON_REQUIRED`), enforced client-side and surfaced from the core; typed failures (`SCENARIO_NAME_DUP`, `SCENARIO_LOCK_CONFLICT`) appear inline in the open dialog or as a page alert for one-click actions. The **ScenarioPicker** (dropdown of the shared `scenario.list`-shaped store, state badge, Manage-scenarios link) now heads the S-041 toolbar and calls the grid store's `setScenario()` (worker rebuild, STATE-MANAGEMENT §2). New tests: actions 6, page 17 (incl. two axe suites), picker 8, store-status transitions 2, plus grid-page picker assertions → **56 files / 628 tests**; coverage 90.22/82.22/90.86/92.58 (gate PASS). See DECISIONS ADR-023…025 for the `created_at`, shared-read-side and `MODEL_CELL_LOCKED` canonicalisation decisions.
- **M4-2 Scenario lifecycle contract + mock + stores (F-022, PR A, 2026-09-04):** 9 commands typed and registered (`model.list`, `scenario.create|duplicate|submit|approve|lock|reopen|delete`, `baseline.set`; registry 37→46) with `Scenario`/`ScenarioVersionRow`/`ModelSummary` Zod contracts. The dev mock now runs the real SCENARIO-VERSION-SPEC §1 state machine on in-memory `scenarios`/`scenario_versions` tables (one seeded `Base` budget draft per Model, working id unchanged): lock auto-writes immutable Version vN, reopen needs a written reason (Locked-Baseline is non-reopenable), delete only Drafts without Versions, `baseline.set` is Locked-only and demands `BASELINE_REPLACE_REASON_REQUIRED` before replacing; `SCENARIO_NAME_DUP`/`SCENARIO_LOCK_CONFLICT` carry the documented S-050 copy; every transition writes a lifecycle audit event; the `MODEL_CELL_LOCKED` gate reads the table state (string trigger kept as dev fallback) and now also gates `driver.set_value`. **Model shape decision (spec unpinned):** `Model = {id, company_id, name, horizon, pack_id, scenarios: Scenario[]}` — recorded in TASKBOARD §11. **Parked Tier-3:** scenario `kind` is not in the catalogued create args (mock: inherit from `base_id` else `budget`) — forecast/what-if creation needs a human decision before M4-1; Review→Draft "return" is served by `scenario.reopen` (no dedicated command). Store wiring (`stores/scenarios.ts`, `setScenario`, `activeScenarioId()`) follows in PR A2; the S-050 page + S-041 picker in PR B.
- **M4-2 scenario store wiring (F-022, PR A2, 2026-09-04):** new `stores/scenarios.ts` — load/create/duplicate/submit/approve/lock/reopen/remove/setBaseline over `model.list` with errors surfaced as `BridgeError`; the model grid store gained `setScenario` (rebuilds the HyperFormula worker and invalidates cell caches/history per STATE-MANAGEMENT §2) and `activeScenarioId()` now feeds the driver/assumption stores, so scenario-scoped writes follow the selected Scenario instead of a pinned constant.
- **M3-5 Period Spreading (F-015 · US-016, 2026-09-03):** exact `spreadTotal` engine (equal / seasonal / custom / lump, W53/P13 exclusion, HARD `SPREAD_WEIGHTS_INVALID` with an explicit Normalize/Fix choice — never silent), worker/client op, store `spreadLine` (audited per-period writes, one undo entry) and the S-041 **Spread** dialog. `Σ periods == total` at Currency Scale by construction (Largest-Remainder Allocation, residual to the last period).
- Specification suite (54 docs/ specs) — see `docs/DOCS-INDEX.md` for the complete map.
- S-044 Assumption Register vertical slice: typed persisted list/upsert/usage IPC, exact decimal-string form and validation, Company-scoped Rust/SQLite writes, HMAC audit events, usage lookup, and accessible five-state UI coverage. New Companies now bootstrap a real Model/Scenario and return the active `model_id`, so native S-044 persistence has an owned model rather than relying on the preview UUID.
- **Docs revision Stage-0 v9 (2026-08-31):** absorbed the scrapped **FinPlan Pro** backlog as
  documented **V2/FUTURE** entries — V-021 lease accounting, V-022 tax provision, V-023 ESG
  reporting, V-024 treasury/banking, V-025 insurance/financial-instruments, V-026 advanced
  period-close, V-027 data-governance suite, V-028 report scheduling/distribution, V-029 plugin
  marketplace — and renumbered FUTURE to 6 entries. The **38-MVP v1.0.0 lock is unchanged**; the
  predecessor's extra domains are *deferred by design*, never half-shipped (B20).

### Changed
- `API-SPEC.md` §2: `model.cell.set.v1` success row now reads `{recalc: {dirty_cells, cycles, changed_cells[], duration_ms}}` (was `dirty`) to match §3 and the implemented contract.
- `FORMULA-ENGINE-SPEC.md` §2: added the explicit **103-function** whitelist count + the requirement that `src/api/schema.ts` and `src-tauri/src/core/model.rs` mirrors stay identical (B14).
- `ZERO-COMPROMISE-RULES.md` B20: count note corrected from V2 (20)+FUT (8) → **V2 (29)+FUT (6)** for the v9 backlog.
- `TODO.md`: V2 backlog now lists V-021…V-029 with the v9 promotion note.
- `PRD.md`: header bumped to Stage-0 v9 with the revision note; §3 V2 and §4 FUTURE tables updated.
- First-run Wizard, Industry Pack library (12 packs), GL-Dump-first ingestion pipeline, Excel-compatible formula grid, driver-based modeling, scenarios/versions, consolidation engine, statement suite, audit trail, offline licensing — all specified. Implementation status is tracked per unit in the root `TASKBOARD.md` (snapshot 2026-09-04: 20/42 screens routed, 35 Rust IPC handlers, 39/99 error codes emitted, 653 tests; Rust side hand-reviewed only — native compile pending CI, see TASKBOARD §14). (Earlier text here said "none yet implemented" — stale since the M1 work of 2026-09-01; corrected, not rewritten, per `docs/ROADMAP.md`).
- **Zero-Compromise revision (2026-08-30):** 16 supplemental docs closing audit gaps — Industry Pack schema, Formula Engine function set, Money/Rounding algorithm, Modeling Methods, Scenario/Version semantics, Canonical GL Template, Connector Data Dictionary, Export Formats, Test Fixtures + oracles, Localization, Compliance/Data Sovereignty, Security Incident Response, DR Recovery Runbook, Onboarding User Guide, Release Checklist, **ZERO-COMPROMISE-RULES.md** (B1–B20 were referenced everywhere but never codified; QA base checklist renamed B1–B8 → Q1–Q8 to end the namespace collision).
- **Gap fixes in existing specs:** 72 → 96 typed IPC commands (added pack/cycle/collection/scenario-lifecycle/plan-analysis/board-pack/schedule/reconcile plus existing-groups expanded); 49 → 56 DB tables (planning_cycles, cycle_tasks, collection_uploads, reason_codes, annotations, currency_scales, license_requests); 82 → 97 error codes (added 15: FORMULA_UNSUPPORTED_FUNCTION, PACK_VERSION_EXISTS, PACK_IN_USE_LOCKED, CYCLE_NAME_DUP, CYCLE_TASK_BLOCKED, COLLECTION_CONFLICT, COLLECTION_STRUCTURE_CHANGED, CAPEX_IN_SERVICE_INVALID, PRODUCTION_CAPACITY, REVREC_COST_ESTIMATE_INVALID, COMPANY_IN_USE_RECENT, BASELINE_REPLACE_REASON_REQUIRED, MODEL_YEAR_EXISTS, SOURCE_BOOTSTRAP_EMPTY, PACK_NO_COMMENTARY); 42 screens (corrected from 47 — phantom refs for wizard/Pack Builder removed, S-023 Pack Studio added); glossary + 13 engineering terms; orphan refs fixed.

### Fixed
- `core/money.rs::largest_remainder_allocate` handed the rounding residual to the *smallest* fractional remainders (ascending sort); MONEY-ROUNDING-SPEC §4b requires largest-first. Totals always tied, but the unit landed on the wrong line (`12.4/3.7/7.9 → 13/4/7`, now `12/4/8`). Spec vectors asserted exactly (KI-014, 2026-09-03).
- `core/error.rs` retry flags for `AUTH_PIN_INVALID` (now false), `AUTH_LOCKED` (now true, with `retryAfterMs`) and `SESSION_LOCKED` (now false) match ERROR-HANDLING §A verbatim; dev mock mirrored; Rust unit test pins the tuples (2026-09-03).
- S-043/S-041 stores sent the API-SPEC example model id (`WORKING_MODEL_ID`) to `driver.upsert` and `model.recalc`; the native core mints a per-Company model id and enforces `model_belongs_to_company`, so every shell write would have failed `VALUE_INVALID`/403. Stores now resolve the session's active model (`activeModelId()`), and the dev mock mirrors the ownership gate so the preview cannot mask it again (2026-09-03).
- `TASKBOARD.md` counters reconciled against the filesystem (2026-09-03): 35 registered Rust handlers (was 33/35 in two places), 39 emitted error codes (was 35), S-044/S-073 screen status, `coa.import`/`coa.merge_accounts` no longer listed as remaining. This changelog's duplicate `### Changed` placeholder removed.

## [0.1.0] — 2026-08-30
### Added
- `docs/` specification suite initialized:
  - Stage 0: Deep analysis + research baseline (market, industries, scenarios, conglomerate support, zero-compromise rules B1–B20) — summarized in `docs/DECISIONS.md`
  - Stage 1: `GLOSSARY.md` — terminology lock (12 sections, ~150 terms, 10 invariants, BANNED-synonym list)
  - Stage 2 Phase 1: `PROJECT-BRIEF.md`, `PRD.md`, `USER-PERSONAS.md`, `USER-STORIES.md`
  - Stage 2 Phase 2: `DESIGN-SYSTEM.md`, `SCREENS-SPEC.md`, `USER-FLOWS.md`, `COMPONENT-LIBRARY.md`, `RESPONSIVE-DESIGN.md`, `ACCESSIBILITY.md`
  - Stage 2 Phase 3: `TECH-STACK.md`, `ARCHITECTURE.md`, `DATABASE-SCHEMA.md`, `API-SPEC.md`, `AUTH-SPEC.md`, `STATE-MANAGEMENT.md`, `INTEGRATIONS.md`, `ERROR-HANDLING.md`
  - Stage 2 Phase 4: `CLAUDE.md`, `CODING-STANDARDS.md`, `GIT-STANDARDS.md`
  - Stage 2 Phase 5: `TESTING-STRATEGY.md`, `QA-CHECKLIST.md`, `PERFORMANCE-REQUIREMENTS.md`, `SECURITY-CHECKLIST.md`
  - Stage 2 Phase 6: `ENV-VARIABLES.md`, `DEPLOYMENT.md`, `CI-CD.md`, `MONITORING.md`
  - Stage 2 Phase 7: `README.md` (root), `CHANGELOG.md`, `TODO.md`, `KNOWN-ISSUES.md`, `DECISIONS.md`
  - `README.md` quickstart (root)

### Security
- Zero telemetry by design (B18-9); secrets policy defined; threat model documented (`SECURITY-CHECKLIST.md`).

<!-- Template: ## [x.y.z] — date | Added / Changed / Fixed / Removed / Security -->
