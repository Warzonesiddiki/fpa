# OneFP&A — AUDIT VECTOR REMEDIATION PLAN (v9, 2026-09-09)

> **Purpose:** Every reason an analyst, controller, CFO, or auditor would reject this tool — documented, owned, and tracked. There are 25 vectors. Each has a concrete fix, an owner milestone, and an evidence requirement. Nothing is deferred as "nice to have." Nothing is fabricated.

---

## METHODOLOGY

Each vector was derived by asking: "If I were a senior FP&A analyst at a 200-person manufacturing group, what would make me say 'I still need Excel' or 'I can't defend this to my auditor'?"

The 25 answers are classified by domain (Grid & UX, Modeling, Ingestion, Collaboration, Reporting, Platform, Treasury, Workforce, Commercial, Consolidation, Cash Flow, Variance, OLAP, Predictive, Calendar, Governance, Office Integration, Security) — matching the audit analysis already present in `TASKBOARD.md` §15.

---

## VECTOR DETAILS — COMPLETE REMEDIATION MAP

### GRID & UX (4 vectors — the analyst's first contact)

| ID | Vector | Rejection scenario | Concrete architectural fix | Evidence required | Milestone |
|---|---|---|---|---|---|
| **AUDIT-01** | Client-only undo/reload loses clears; boot load omits `model_values` | Analyst deletes a cell, reloads, the value returns; or grid loads blank | `model.cell.set.batch.v1` (null deletes from SQLite); `model.values.get` on boot; persistent undo stack (≥250 levels) backed by SQLite snapshot, not memory | `cargo test` showing batch null → DB delete; vitest showing reload preserves empty; undo test showing 250th undo restores exact formula | M3-1 |
| **AUDIT-02** | Excel keyboard/memory gaps; paste rejects accounting formats | Analyst hits F2 and nothing happens; pastes `(500)` and it fails | Full Excel keyboard map (arrow/Tab/Enter/F2/Esc/Shift-arrow range select); `parseFinancialNumber` supporting `1,250,000.00`, `(500.00)`, `$1,000`, `15%`; drag-fill with relative ref adjustment | Key-event test covering 20+ shortcuts; parse test with 50 accounting strings; fill test with relative reference shift | M3-9 |
| **AUDIT-03** | No insert/delete rows; formula bar typing lag | Can't add a new sub-account without leaving the model; typing in formula bar wipes previous input | `model.line.create` with insert-above/below context menu; FormulaBar isolated with local state, auto-width, working Point-reference mode; no full-page re-render on keystroke | Page test: insert line updates COA + grid; formula bar test: type, click cell, text preserved; axe 0 | M3-1 / M3-9 |
| **AUDIT-23** | No cell validation rules; invalid input corrupts store | Types `abc` into a currency cell; division by zero crashes silently | `model_lines` validation schema (`data_type`, `min/max`, `allowed_values`); AG Grid styling conventions (blue=inputs, black=formulas, gray=rollups); instant tooltip errors (`CELL_VALIDATION_ERROR`) | Schema test: invalid type rejected; store test: invalid input never writes; visual test: 3 cell types distinguishable | M3-3 / S-041 |

---

### MODELING (5 vectors — the engine's credibility)

| ID | Vector | Rejection scenario | Fix | Evidence | Milestone |
|---|---|---|---|---|---|
| **AUDIT-04** | Hard `FORMULA_CYCLE`; HyperFormula has no iterative mode | 3-statement model with debt-revolver → interest → debt creates mathematical loop; HyperFormula crashes with `#CYCLE!` | SCC (Strongly Connected Component) relaxation: detect cyclic subgraphs via Tarjan SCC over the **logical** (pre-pointer) formula graph; damped Gauss–Seidel (α=0.5), ≤100 iterations, converge at max\|Δ\| ≤ 0.0001 minor units (FORMULA-ENGINE-SPEC §5); **dual-probe validation** (zero-seed and unit-seed runs must both converge to the same committed-precision value); safe reference rewriting (in-SCC members → scratch-sheet inputs, solved cross-SCC members → committed scratch inputs, driver values → constants); any rewrite shape that cannot be guaranteed safe is **refused honestly** — the SCC keeps `FORMULA_CYCLE`, never a guessed value; opt-in via additive `loadGrid({iterativeCalculation: true})` (default OFF, no new IPC) | Engine test: intentional cycle resolves to stable value; property test: 100 random cyclic graphs converge; `FORMULA_CYCLE` error emitted for non-convergent loops | M3-2 / M3-5 |
| **AUDIT-05** | Scalar-only rollup; missing Cash Flow/SoCE/Non-GAAP; only 4 fixed lines | Monthly P&L shows annual scalar sum; Cash Flow tab empty; no EBITDA/Contribution Margin line | Refactor `compute_totals` to `BTreeMap<String, i64>` per-period vectors; implement Direct & Indirect Cash Flow (`statement.rs`); Non-GAAP reconciliation bridge (EBITDA, SBC add-backs) | Statement test: per-period sums exact; CF test: Direct derives from collections/disbursements; Indirect ties to Net Income + non-cash adjustments; SoCE produced | M6-1 / M6-2 |
| **AUDIT-06** | Cost allocations & ABC missing | Shared costs (IT, HR, Facilities) must be allocated by headcount/revenue/sqft | Multi-step allocation engine (`allocation.run`, `allocation.rule_upsert`); driver-proportional distribution with weight validation; audit event per allocation | Engine test: allocation sums to 100%; store test: rule saved with HMAC audit; page test: S-041 shows allocation result | M3-3 / M3-5 |
| **AUDIT-13** | Workforce: horizon divisor bug; `HC_OVERLAP`; no persistence | Monthly salary changes when horizon expands; rejects employees before Period 1; bans same-title staff | Replace `base / periods.len()` with exact calendar-frequency annualization; identify by unique Employee ID; decouple quota from base; `workforce_roster` SQLite table; FICA caps + fixed health tiers | Engine test: salary stable across horizons; store test: roster persisted with audit; overlap test: same title in different depts allowed; overlap in same dept rejected | M3-6 |
| **AUDIT-14** | RevRec / Commercial: S-047/048 mockups; invalid SaaS math | Revenue recognized as flat numbers without ASC 606 steps; POC ignores EAC; SaaS ARR/Burn/CAC formulas mathematically wrong | ASC 606 5-step engine (`contracts`, `contract_pobs`, `revrec_schedules`); SSP allocation; cost-to-cost POC with EAC; fix SaaS KPI math (standard Bessemer definitions); commercial capacity model | Statement test: deferred revenue bridge accurate; POC test: EAC loss triggers additional cost; KPI test: ARR formula matches industry standard | M3-8 / M5-3 |

---

### INGESTION (3 vectors — the trust entry point)

| ID | Vector | Rejection scenario | Fix | Evidence | Milestone |
|---|---|---|---|---|---|
| **AUDIT-07** | Strict unmapped COA halts close; no single-account create; Calamine date wipeout; currency mix | New ERP account blocks import; no inline create; Excel dates erased; multi-currency fails | `account_mappings` table with Jaro-Winkler suggestions; `coa.create` in Rust; `Data::DateTime` Calamine support (not erased); remove `CURRENCY_MIXED` hard gate; auto-seed `9999 - Suspense Clearing` fallback | Import test: new account mapped automatically; fixture test: date cell preserved; currency test: multi-currency file commits | M2-2 / M2-3 / M2-1 |
| **AUDIT-08** | GL black hole; O(N) CSV tokenizer; SQLite loop stalls at 100k rows | Once committed, GL lines unqueryable; 100k-row import freezes | `gl.lines.query` IPC with cursor pagination (`LIMIT/OFFSET` with composite index); `DrillDownDrawer` across S-060 and S-054; `prepare_cached` for batch inserts; `csv::ByteRecord` streaming | Perf test: 100k rows inserted in <3s; query test: pagination returns 25 rows in <50ms; drill test: GL line → audit chain → statement verified | M2-4 / M2-1 |
| **AUDIT-21** | Cell governance missing; audit disconnected from grid | No cell-level comments; no revision history in grid; no review flags | Cell-level annotation (`annotations` table expanded); revision history drawer (`model.cell.history` IPC); review flags (`Flagged for CFO Review`, `Variance Approved`); `audit_events` linked to cell coordinates `(line_id, period_id)` | Page test: right-click cell shows comment + history; audit test: cell edit creates audit event with coordinate; review flag visible in grid overlay | M3-9 / M6-8 |

---

### COLLABORATION & MULTI-USER (1 vector — the team reality)

| ID | Vector | Rejection scenario | Fix | Evidence | Milestone |
|---|---|---|---|---|---|
| **AUDIT-09** | Ghost container (.fpa empty); machine-locked keychain; collection no-op; no scenario merge | Shared `.fpa` is empty; audit key locked to OS; collection import writes nothing; branches never merge | Checkpoint SQLite into `.fpa` on commit/close; wrap audit key inside container envelope; `collection.import` writes directly to `model_values`; `scenario_version_values` snapshot table on lock; native 3-way semantic merge (`scenario.merge`) with conflict resolution UI | File test: `.fpa` contains live DB after save; audit test: key accessible from container; collection test: driver values persisted; merge test: 3-way merge produces consolidated scenario with audit chain | M1-5 / M4-2 / M4-6 |

---

### REPORTING & GOVERNANCE (7 vectors — the board and auditor)

| ID | Vector | Rejection scenario | Fix | Evidence | Milestone |
|---|---|---|---|---|---|
| **AUDIT-10** | Corrupt `.xlsx` (plain text); mock PDF/zip; no PPTX | Excel crashes on `.xlsx`; board pack uses `alert()`; zero PowerPoint | Integrate `rust_xlsxwriter` (live formulas, accounting formats); `typst` PDF engine; `.pptx` compiler for board deck (S-064 sections 1–9 + commentary); model dump (`.fpa` re-importable) | Export test: `.xlsx` opens in Excel with `=SUM()` preserved; PDF test: deterministic bytes; board test: PPTX generated with fixed layout; injection guard: formula prefix `'` applied | M6-6 / M6-5 / M6-1 |
| **AUDIT-15** | Hardcoded 2-BU consolidation; no CTA equity plug (ASC 830/IAS 21 violation) | Group scope returns error; FX missing; balance sheet doesn't balance due to missing CTA | Refactor `statement.rs` to `bu_scope="group"`; multi-tier rollup trees with partial ownership/NCI (`bu_ownership`); ASC 830 translation engine (BS @ closing spot, P&L @ weighted average, Equity @ historical, Income Statement @ average); exact CTA plug (`3900 - CTA Reserve`); automated fuzzy counterparty IC reconciliation (`ic_elimination_entries`) | Consolidation test: 50 BU group balances; CTA test: equity balances after FX rate movement; IC test: unmatched transactions flagged (`IC_UNMATCHED`); NCI test: minority share calculated exactly | M6-3 |
| **AUDIT-16** | Cash Flow empty stub; no tie-out; disconnected 13-week cash | `type="cf"` returns empty; BS cash ≠ CF ending; 13-week scalar array disconnected | Direct & Indirect Cash Flow (`statement.rs`); Indirect: Net Income + non-cash adjustments + working capital delta; Direct: collections/disbursements; `cash_flow_reconciliation` linking BS to ending cash; automated AR/AP aging waterfall + working capital drivers (`DSO`, `DPO`, `DIO`); auto-revolver sweep in `schedule.rs` | Statement test: direct/indirect CF produces exact ending cash; reconciliation test: delta = 0; aging test: 30/60/90-day buckets exact | M6-1 / M3-7 |
| **AUDIT-17** | Variance mix/FX/efficiency = 0; no driver-tree | Volume/Price computed but mix/FX/efficiency hardcoded 0; no root-cause drilldown | Mathematical 5-factor PVM (`ΔVol`, `ΔPrice`, `ΔMix`, `ΔFX`, `ΔEfficiency`) with exact sum-of-parts equality; interactive Driver Tree in S-054 (recursive dependency from EBITDA → unit price/volume); constant-currency / FX-neutral comparison mode | Variance test: 5 factors sum exactly to total variance; mix/FX/efficiency non-zero when drivers change; tree test: click EBITDA shows unit-level drivers; attribution test: reason codes linked to specific factor | M5-1 / M5-2 / M3-3 |
| **AUDIT-18** | Hardcoded 2D flat grid; zero dimensional pivoting; no top-down allocation | Can't pivot Account × Department; total adjustments don't cascade; 9M-cell sparse queries stall | `cube_dimensions` + `cube_intersections` schema; interactive Pivot Matrix engine (S-040/S-041) with dynamic drag-and-drop; multi-tier top-down allocation (`plan.spread_hierarchical`) by historical weights/headcount/4-4-5 days; sparse composite keys in SQLite (`dimension_1_id + dimension_2_id + ...`) | Pivot test: dimensions swapped in rows/columns; allocation test: 5% total increase distributes proportionally; perf test: 9M-cell query <2s | M3-3 / M3-5 / M4-5 |
| **AUDIT-19** | Zero predictive forecasting; manual copy-paste for baseline | No statistical extrapolation; no seasonal decomposition; analyst manually types trends | Native Rust forecasting (`core/forecast.rs`): Triple Exponential Smoothing (additive/multiplicative), Linear Regression with Seasonal Indexing, Prior Year Run-Rate; confidence intervals (80%/95%); MAPE/RMSE backtesting against actuals; `plan.forecast_baseline` IPC | Forecast test: backtest MAPE <10% on historical data; seasonal test: retail cycle detected; baseline test: future periods seeded from historical trend | M4-5 / M7-3 |
| **AUDIT-24** | Manual rolling forecast; no automated cutoff; historical editable | Rolling 3+9 requires manual recreation; historical cells editable; no snapshot freeze | `forecast.roll_period` IPC: seals closed period, locks historical grid, extends horizon, reseeds baseline; stage-gate scenario approval (`Working` → `Submitted` → `Approved` → `Locked`); cryptographic snapshot (`scenario_version_values`) frozen at lock; read-only historical columns with 2px boundary line | Roll test: period rolls automatically; history test: locked cells uneditable; snapshot test: locked version unchanged by subsequent edits | M4-1 / M4-2 |

---

### PLATFORM & SECURITY (3 vectors — the foundation of trust)

| ID | Vector | Rejection scenario | Fix | Evidence | Milestone |
|---|---|---|---|---|---|
| **AUDIT-11** | No OS file association; no desktop ergonomics | Can't double-click `.fpa`; no recent files; no single-instance lock | Tauri OS file association (`.fpa` → app); single-instance mutex (`FILE_IN_USE` → read-only second instance); native recent-files menu; folder picker for `.fpa` location | Desktop test: `.fpa` opens from OS; lock test: second instance opens read-only; picker test: folder selected; recent test: last 5 companies listed | M1-2 / M7-2 |
| **AUDIT-22** | No Excel/PowerPoint bridge | Analysts must copy-paste from screen; board decks rebuilt manually | Embedded localhost server (`127.0.0.1:<random-port>`, ephemeral Bearer token, CORS pinned); Office.js Excel Add-in (`=ONEFPA.GET("REVENUE", "2026-M03")`); PowerPoint deck refresh (update tables from live model) | Integration test: Excel cell updates from model; PowerPoint test: slide table refreshed; security test: token rotated per session; CORS test: only preview host allowed | M6-6 / M7-5 |
| **AUDIT-25** | Single PIN vulnerability; no biometrics; no corporate escrow | IT rejects tool with single PIN; no recovery if finance director leaves; no SOX-compliant escrow | Tauri native biometrics plugin (Windows Hello / Touch ID); dual-control recovery escrow (Shamir's Secret Sharing or dual-key RSA corporate envelope); recovery phrase + corporate escrow certificate; `security.recovery_reveal` / `security.recovery_reset` handlers | Security test: biometric unlock success; escrow test: split keys reconstruct; recovery test: phrase restores company; compliance test: SOX dual-control verified | M1-3 / M7-2 |

---

### CALENDAR & PREDICTIVE (2 vectors — the time dimension)

| ID | Vector | Rejection scenario | Fix | Evidence | Milestone |
|---|---|---|---|---|---|
| **AUDIT-20** | Strict monthly blocks weekly treasury; no Actual/360; rigid 12M | 13-week cash can't coexist with monthly P&L; debt interest distorted by 1.39% | Dual-cadence architecture (`weekly_periods` linked to `monthly_periods` via fractional-day mapping); `DayCountConvention` enum (Actual360, Actual365, Thirty360); `schedule.rs` applies convention to debt amortization | Calendar test: weekly + monthly synchronized; debt test: Actual/360 interest exact to 6 decimal places; convention test: 3 methods produce different results | M1-7 / M3-7 |

---

## EVIDENCE STANDARDS — WHAT "FIXED" MEANS

No vector moves to `✅ DONE` without:

1. **Code executed locally** (`npm run check` or `cargo test` or both) showing the fix.
2. **Test added** in the relevant test file (unit, integration, property, or E2E) asserting the exact behavior.
3. **Docs synchronized** — the spec file (`docs/SCREENS-SPEC.md`, `docs/API-SPEC.md`, or `docs/INDUSTRY-PACK-SPEC.md`) reflects the fix; `TASKBOARD.md` updated.
4. **Audit event verified** — if the fix involves mutation, the HMAC audit event exists and the chain verifies.
5. **No mock-only path** — the fix uses the real SQLite DB or real Rust handler; development mock is mirrored but not relied upon.

---

## CURRENT STATUS — ALL 25 VECTORS (2026-09-18)

| Vector | Domain | Status | Milestone | Blocker / Evidence gap |
|---|---|---|---|---|
| AUDIT-01 | Grid persistence | ❗ TODO | M3-1 | `model.cell.set.batch.v1` not authored; `model.values.get` not authored |
| AUDIT-02 | Excel parity | ✅ DONE (2026-09-18) | M3-9 | `src/utils/parseFinancialNumber.ts` — exact-string parser, 59 string tests (35 accepted / 24 rejected, all four named formats: `1,250,000.00`, `(500.00)`, `$1,000`, `15%`); wired into paste (`src/stores/modelHistory.ts`), the S-041 formula bar, and the engine boundary guard (`src/workers/modelEngine.ts` `VALUE_INVALID`); S-041 keyboard suite: 21 key-event tests (13 app-owned: Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y, F2, 4× Shift+arrow, formula-bar Enter ×2, formula-bar Escape, 2 typing-guard; 8 AG-Grid pass-through non-mutations) + 1 paste-dialog accounting-format test — `src/pages/s041-model-grid/index.test.tsx` |
| AUDIT-03 | Row insert / formula bar | ❗ TODO | M3-1 / M3-9 | `model.line.create` not authored; formula bar isolation partial |
| AUDIT-04 | Formula cycles | ✅ DONE (2026-09-23, engine scope) | M3-2 / M3-5 | `src/model/cycleSolver.ts` — pure solver (34 tests: Tarjan + damped Gauss–Seidel α=0.5 + dual-probe + 100 random cyclic graph property test) — and `src/workers/modelEngine.ts` wiring (20 engine tests in `src/workers/modelEngine.cycles.test.ts`): additive opt-in `loadGrid({ iterativeCalculation: true })`, default OFF; unsolved loops keep `FORMULA_CYCLE` and surface in `model.recalc.cycles` + `inspectCell.is_cycle`; scratch-sheet pointer design keeps solved cells exact through derived columns; honest refusal (never a guessed value). Native Rust parity + store/UI toggle = documented follow-up (no new IPC → no Tier-3 RFC) |
| AUDIT-05 | Multi-period / CF / Non-GAAP | 🚧 PARTIAL | M6-1 / M6-2 | **Largest-remainder TS tie-out oracle DONE 2026-09-20** (`src/model/largestRemainder.ts`, 15 exact-decimal tests) **+ Direct & Indirect Cash Flow + Non-GAAP EBITDA bridge TS engine DONE 2026-09-22** (`src/model/cashFlow.ts`, 15 exact-integer tests: Direct from collections/disbursements, Indirect = NI + D&A + non-cash − ΔWC, Direct↔Indirect tie-out + Δ-cash vs cash-statement tie-out, EBIT→EBITDA→Adjusted-EBITDA bridge, `npm run check` green); per-period vector refactor not started (native, cargo-pending); SoCE not authored |
| AUDIT-06 | Cost allocations / ABC | ❗ TODO | M3-3 / M3-5 | Allocation engine not authored |
| AUDIT-07 | Ingestion gaps | 🚧 PARTIAL (TS slice 2026-09-26) | M2-1 / M2-2 | **Jaro-Winkler mapping suggestions SHIPPED (TS):** `src/model/jaroWinkler.ts` (pure, 14 tests vs independent reference) + S-031 `ValidationPanel` advisory closest-COA-matches under each `ACCOUNT_MISSING` hard finding (client-side from catalogued `coa.list`; top 3 @ 0.85; never auto-applied; hard gate unchanged — GL-TEMPLATE-SPEC §6 + API-SPEC `import.validate` updated). **Follow-ups:** `account_mappings` table + native candidate `list`, `coa.create`, `Data::DateTime` (Calamine), `CURRENCY_MIXED` removal, `9999 - Suspense Clearing` auto-seed (Tier-3/native) |
| AUDIT-08 | GL drilldown + perf | ❗ TODO | M2-4 / M6-1 | `gl.lines.query` not authored; `prepare_cached` partial; stream CSV partial |
| AUDIT-09 | Multi-user / collaboration | ❗ TODO | M1-5 / M4-3 | Checkpoint into `.fpa` not authored; `scenario_version_values` partial |
| AUDIT-15 | Consolidation / FX / CTA | ❗ TODO | M6-3 | Multi-tier rollup partial; CTA plug (`3900`) not implemented; automated IC reconciliation not authored |
| AUDIT-16 | Cash flow / liquidity | 🚧 PARTIAL (TS engines 2026-09-22/26) | M6-1 / M3-7 | **TS engines DONE:** Direct + Indirect CF + exact statement tie-out + Non-GAAP EBITDA bridge (`src/model/cashFlow.ts`, 15 tests); **working capital drivers DSO/DPO/DIO/CCC + closed-form auto-revolver sweep** (`src/model/workingCapital.ts`, 13 tests — interest-adjusted exact minor-unit draws, floor/limit with an explicit `minimumCashMet` flag, excess-cash sweep); 13-week cash schedule (`src/model/week13Cash.ts`). **Follow-ups:** `cash_flow_reconciliation` command + persistence tables (Tier-3), S-060 `type="cf"` + S-046 13-week UI wiring, native `statement.rs`/`schedule.rs` parity |
| AUDIT-17 | Variance / PVM | PARTIAL (engine + S-054 tree built 2026-09-11; red tree repaired 2026-09-18) | M5-1 / M5-2 / M3-3 | `src/model/varianceEngine.ts` (646 lines, exact Decimal, 5-factor PVM, `verifyPvmInvariant` sum-of-parts invariant, 12 tests incl. pinned fixture `complex_mixed` = 870,000); store `pvmCheck` tamper guard (20 tests); S-054 page wired (M5-2). The "364 lines / 6 tests executed" claim in the 2026-09-09 status was incorrect (the file was 646 lines / 12 pure-TS tests); the red tree it caused was repaired in commit `317c9a1` (2026-09-18). Constant-currency / FX-neutral mode + reason-code attribution remain unverified. |
| AUDIT-18 | OLAP / dimensionality | ❗ TODO | M3-3 / M3-5 | Cube dimensions schema partial; pivot matrix engine not authored |
| AUDIT-19 | Predictive baseline | ❗ TODO | M4-5 / V2 | `core/forecast.rs` not authored; statistical library selection pending |
| AUDIT-20 | Dual-cadence calendar | 🚧 PARTIAL (TS-complete) | M1-7 / M3-7 | **All four TS acceptance sub-parts DONE 2026-09-20:** day-count conventions (`src/model/dayCount.ts`, 82 tests incl. `addDaysToIso`), Actual/360 debt interest + 3-conventions-differ (`src/model/debtSchedule.ts` `periodInterest`), and the weekly↔monthly fractional-day overlap matrix / "weekly + monthly synchronized" calendar test (`src/model/calendarEngine.ts`, 17 tests — month column sums === day counts, year total 365/366, largest-remainder allocation). Remaining (native, cargo-pending): `core/calendar.rs`/`schedule.rs` convention wiring, the `weekly_periods` linked table, store/UI wiring |
| AUDIT-21 | Cell governance | ❗ TODO | M3-9 / M6-8 | Annotation popovers not authored; `model.cell.history` partial |
| AUDIT-22 | Office bridge | ❗ TODO | M6-6 / M7-5 | Localhost server not authored; Office.js add-in not authored |
| AUDIT-23 | Cell validation | ❗ TODO | M3-3 / S-041 | Validation schema partial; visual conventions partial |
| AUDIT-24 | Rolling forecast automation | ❗ TODO | M4-1 / M4-5 | `forecast.roll_period` not authored; stage-gate approval workflow partial |
| AUDIT-25 | Biometrics / escrow | ❗ TODO | M1-3 / M7-2 | Biometric plugin partial; escrow mechanism partial |
| **AUDIT-10** | Reporting export / corruption | ❗ TODO | M6-6 / M6-5 / M6-1 | `rust_xlsxwriter` integration partial; `.pptx` compiler not authored; injection guard authored |
| **AUDIT-11** | Platform / file association | ❗ TODO | M1-2 / M7-2 | OS association partial; single-instance lock defined; recent files partial |
| **AUDIT-12** | Treasury / capex persistence | 🚧 PARTIAL | M3-7 / M6-1 | **TS math slices DONE 2026-09-20:** `src/model/depreciation.ts` (36 tests: SL, DDB w/ optimal SL switch, MACRS half-year [IRS Pub 946 A-1], FCCR) + `src/model/week13Cash.ts` (10 tests: target-cash 13-week, borrowing, exact tie-out) + `src/model/debtSchedule.ts` (17 tests: SOFR all-in rate, day-count period interest, annuity amortization, PIK — exact tie-outs). Remaining: SQLite persistence tables (`capital_assets`, `debt_facilities`, `credit_covenants`, `cash_flow_13week`), native `rust_decimal` schedule engine, SOFR curve inputs, undrawn/commitment fees (native, cargo-pending) |
| **AUDIT-13** | Workforce persistence | ❗ TODO | M3-6 | `workforce_roster` table not fully authored (partial in schedule); annualization fix partial |
| **AUDIT-14** | RevRec / commercial persistence | ❗ TODO | M3-8 / M5-3 | ASC 606 engine partial; POC/EAC partial; SaaS KPI math fix partial |

> **Summary:** 1 of 25 vectors claim `✅ DONE` (AUDIT-02, 2026-09-18, with pasted gate evidence in CHANGELOG/HANDOVER). Four are PARTIAL: AUDIT-05 (M6-1 largest-remainder TS tie-out oracle, 2026-09-20, plus Direct/Indirect Cash Flow + Non-GAAP EBITDA bridge TS engine, 2026-09-22), AUDIT-12 (depreciation + FCCR TS engine, 2026-09-20), AUDIT-17 (PVM engine + S-054 tree, red tree repaired 2026-09-18), and AUDIT-20 (day-count conventions TS engine, 2026-09-20). The rest remain `❗ TODO` — this is the honest state. No vector is hidden, no gap is fabricated. The strategic vision demands that these become the highest-priority work stream for the remaining session.
