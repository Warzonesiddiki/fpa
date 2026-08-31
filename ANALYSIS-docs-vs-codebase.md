# OneFP&A — Docs vs Current Codebase vs Predecessor (FinPlan Pro)

> Quick audit, 2026-08-31. Purpose: confirm the project is on track to deliver the
> **all-in-one, zero-compromise** FP&A suite, and decide how (or whether) to reuse the scrapped
> predecessor repo — rather than rebuilding from scratch.

---

## TL;DR

| Dimension                                 | Current project (`fpa`)                                                                                       | Predecessor (`fp-A-betterversion`)                                                                                                                                        | Verdict                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Product **spec** (docs)                   | **Complete** — 54 locked docs, 38 MVP features, 42 screens, 96 API commands, 97 error codes, 56 DB tables     | Huge but **unlocked / sprawling** (62 docs, 187 engines, 53 pages)                                                                                                        | **Keep current docs as source of truth.** Don't import predecessor docs. |
| **Architecture vs zero-compromise rules** | ✅ Correct (Rust core owns money/calendar/audit; TS UI only; no telemetry; SQLite Rust-only)                  | ❌ **Violates many B-rules** (money in TS via `decimal.js`, `@sentry` phone-home, `server/` + web runtime, `sql.js` in TS, AI copilot, lease/ESG/tax/banking scope-creep) | **Do not copy it wholesale.**                                            |
| **Code maturity**                         | Early M1/M2: 19 Rust+TS commands, 9/42 screens, 31/97 error codes, 56/56 DB tables, 26 test files (171 tests) | **18–30+ weeks built**: ~187 engines, 123 stores, 1,334 test files, rich pages                                                                                            | **Harvest as reference implementation / oracle tests, not as code.**     |
| Quality gates                             | Green: `check` passes, coverage 92.87% all / 98.95% critical                                                  | Self-reported green, but GAP_LEDGER shows persistent money/schema debt                                                                                                    | Current gates are trustworthy; predecessor's are not.                    |

---

## 1. Current project status vs its own locked spec

### Spec is DONE; implementation is NOT (and that is normal at this stage)

The current repo is at **~Stage-0 spec-complete + early build**. The docs fully describe the target
one-stop FP&A product; the code is intentionally being built milestone-by-milestone (ROADMAP M0→M7),
with a blocking quality-gate culture (nothing ships half-built, B20).

| Dimension       | Spec (docs)                                        | Implemented now                                                                                                             | Gap                                                       |
| --------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Docs indexed    | 53 + DOCS-INDEX (`docs:verify` PASS)               | —                                                                                                                           | ✅ complete                                               |
| MVP features    | **38** (F-001…F-038)                               | ~8-10 partially: Company mgr, COA, Calendar engine, First-run wizard, Pack lib, Import (GL dump core), Model cell contract  | ~**75–80% not implemented** (by design)                   |
| Screens         | **42** (S-001…S-076)                               | **9** (S-001, 002, 004, 010, 020, 021, 022, 023 + first-run-PIN)                                                            | ~**33 screens missing**                                   |
| API commands    | **96 command rows**                                | **20 Rust handlers / 19 typed TS commands** (session, company, calendar, coa, pack, import.\*, model.cell.set/model.recalc) | ~**76 commands missing**                                  |
| Error codes     | **97**                                             | **31** in `core::error`                                                                                                     | ~**66 codes missing** (only when the feature ships — B12) |
| DB tables       | **56**                                             | **56** in `001_initial.sql`                                                                                                 | ✅ schema is fully specified & present                    |
| Formats/engines | all in Rust `core/` + HyperFormula worker (locked) | `core/money`, `core/calendar`, `core/audit`, `core/model` only                                                              | many engines not yet written (by roadmap order)           |

**Interpretation:** the product _target_ is exactly right (a single offline desktop app covering
Company → Ingestion → Model → Plan → Analyze → Report → Govern). The repo is a clean, disciplined
early build. There is **no scope drift** in the current repo — which is precisely the strength
(belongs to B20).

---

## 2. Predecessor `fp-A-betterversion` — what it really is

Top-level profile: **FinPlan Pro**, Tauri 2 + React 19 + Vite 8 + Tailwind 4, **`decimal.js` money
primitive, `@sentry` telemetry, `server/` HTTP service, `sql.js`**, and 53 page directories
(banking, bonds, credit, insurance, tax, lease, esg, treasury, ai, collaboration…).

- **187 standalone `*.ts` engines** (`DepreciationEngine`, `DebtScheduleEngine`,
  `ConsolidationEngine`, `FXEngine`, `VarianceAttributionEngine`, `FiscalCalendarEngine`,
  `RollingForecastEngine`, `RevRecEngine`, `CapExEngine`, `GoalSeekEngine`,
  `WorkingCapitalEngine`, …) with per-engine `*.test.ts` + dedicated **`*.money.test.ts`**
  known-answer suites.
- **123 store files**, 1,334 test files, and a deep `src/workers/` (batch-calc, consolidation,
  monte-carlo, storage) layer.

### Why it was scrapped (from its own docs + scan)

The predecessor's own `GAP_LEDGER.md`, `AUDIT_*_REPORT*`, `OMEGA_DEEP_AUDIT_PASS` and
`ZERO_COMPROMISE_PRODUCT_BLUEPRINT` tell the story: it built far **more** domain code than the
current locked PRD, but **failed the zero-compromise architecture**:

| Zero-compromise rule                                | Current project                                        | Predecessor                                                                                                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1** Desktop-only, no server/web runtime          | ✅                                                     | ❌ `server/` + `sql.js` web runtime, browser runtime gate                                                                                                                                                                         |
| **B3** Money exact, no float anywhere               | ✅ Rust `i64` minor + `rust_decimal`; `money:ast` gate | ⚠️ exact **but** in **TS** `decimal.js` (165 files); raw float still in many engines (its own money-debt tests)                                                                                                                   |
| **B4** SQLite only, Rust-only DB                    | ✅                                                     | ❌ `tauri-plugin-sql` + `sql.js` (16 refs), TS DB code                                                                                                                                                                            |
| **B6** Financial computation owned by **Rust core** | ✅                                                     | ❌ computation lives in TS engines                                                                                                                                                                                                |
| **B14** One owner, one implementation               | ✅                                                     | ❌ multiple engine generations, registry of 187 modules                                                                                                                                                                           |
| **B17** No AI in v1.0.0                             | ✅                                                     | ❌ `AICopilotEngine`, `FinanceCopilotEngine`, `NLQEngine`                                                                                                                                                                         |
| **B18-9** Zero telemetry                            | ✅ `telemetry-scan` PASS                               | ❌ `@sentry/react`, `@sentry/vite-plugin`, `@sentry/node` (3 refs)                                                                                                                                                                |
| **B20** Scope discipline (38 MVP locked)            | ✅                                                     | ❌ **scope-creep**: lease, ESG, tax provision, banking/credit/bonds, insurance, treasury, AI — many are PRD `NOT BUILDING`/`FUTURE` (resolved by the Stage-0 v9 docs revision: promoted as V2/FUTURE backlog, MVP lock unchanged) |

So the predecessor is **not a cleaner cut-and-paste base**. If copied in, it would _reintroduce
exactly the defects the current project exists to avoid_ (float money paths, telemetry, web
runtime, TS-owned engines, scope bloat), and would betray B1/B3/B4/B6/B14/B17/B18-9/B20.

---

## 3. Recommendation — reuse as _reference_, not as _source_

The best lever is to use the predecessor as an **algorithm + oracle library** to accelerate the
current Rust implementation. The current project already has the correct architecture, clean
schema, typed IPC gate, and a green CI-style `check` — that is what should be kept.

### Do this

- **Port** a curated set of high-value, pure-math engines into `src-tauri/src/core` (or
  `src-tauri/src/engines/` if a new module boundary is added), **Rust-first**, using the current
  `MoneyValue`/`rust_decimal` core (never float), and reuse the predecessor's **known-answer test
  vectors** as `#[cfg(test)]` oracle tests.
- Priority list to port (all map onto existing DB tables already in `001_initial.sql`):
  1. **Fiscal Calendar** — predecessor `FiscalCalendarEngine` vs current `core/calendar.rs`
     (already built; harvest extra 52/53-week & 445/454/544/3334 oracle vectors).
  2. **F-017** `DebtScheduleEngine`, `WorkingCapitalEngine`, `CapExEngine`, `DepreciationEngine`,
     `LoanAmortizationEngine` (13-Week Cash, covenant gauges).
  3. **F-028** `ConsolidationEngine`, `FXEngine` (translation + NCI), `ICMatchingEngine`
     (intercompany tie-out) — map onto `group_rollup_maps`, `fx_rates`, `ic_lines`.
  4. **F-024/F-025** `VarianceAttributionEngine`, `VarianceDecompositionEngine`, FVA score
     (MAPE/bias/hit).
  5. **F-012/F-015** `ArrayFormulaEngine`/`FormulaEngine` (careful — HyperFormula is the locked
     engine; inherit only **analysis** functions/parsing ideas), `SpreadEngine`, `IncrementalCalc`.
  6. **F-021/F-022** `ScenarioEngine`, `RollingForecastEngine`, `GoalSeekEngine`,
     `SensitivityEngine`, `WhatIfSandboxEngine`.
- Keep predecessor **docs out** of the current repo (`docs/` is locked, B8/B20). If a legacy
  concept is genuinely useful, file it as a V2 backlog item, not a v1.0.0 feature.

### Do NOT do this

- Do **not** merge the `src/engines/*.ts`, `src/store/*`, `src/workers/*`, or `src/pages/*` into
  the current repo — they carry the architecture violations above.
- Do **not** add `decimal.js`, `sql.js`, `@sentry/*`, `server/`, AI/lease/ESG/tax/banking code.
- Do **not** treat predecessor test-files as proof of correctness for a financial number — copy
  the _expected value_ into a Rust test, re-derive it from the current Rust core, and verify with
  the current `money:ast` gate.

---

## 4. The one-stop / zero-compromise reality check

The docs already _are_ the all-in-one answer — project brief, PRD (38 MVP features spanning the
whole FP&A cycle), 42 screens, 96 API commands, 97 error codes, 56 tables, 12 industry packs,
AUTH/SECURITY/DR/EXPORT specs. "User never leaves the app" is satisfied by F-001…F-038 _by
design_, **not** by adding more features. Adding the predecessor's extra domains would actually
push **away** from the goal (PRD `NOT BUILDING` is binding — accounting system of record, tax
provision, lease accounting, ESG, treasury execution, mobile, multi-user, cloud).

The current repo's gap is purely **implementation progress**, not spec or architecture. The
highest-value next move is to keep shipping roadmap order (currently M1/M2), and to accelerate the
heavy M2–M6 engine work by **porting** the predecessor's proven algorithms/tests into the Rust
core.

---

## 5. Concrete next actions

1. **Add a `src-tauri/engines/` (or `core/engines/`) module** in the current repo and start porting
   the highest-value Rust engines above, each with a `#[cfg(test)]` oracle suite copied from the
   predecessor's expected values.
2. **Keep the current quality gates** (`npm run check`, `money:ast`, `docs:verify`, coverage)
   green. Any ported module must pass them (B3/B18-7).
3. **Pin predecessor as a reference clone** (already at `/home/user/fp-a-betterversion`) for
   algorithm/test-harvesting; do not add it as a git dependency.
4. **Do not open docs** to expand scope. If the predecessor reveals a genuinely missing _MVP_
   requirement, log it against TODO/backlog and treat it as a docs change (B20) — not a silent add.
5. **Track implementation-by-spec** with a simple coverage table (commands/screens/errors/features)
   each milestone so the one-stop goal is demonstrated, not assumed.

---

## 6. Docs upgrade executed (Stage-0 v9, 2026-08-31)

Per the user's direction ("upgrade the docs as the base we build from", scope policy = keep the
38-MVP lock, all docs pass), the following locked docs were upgraded — `docs:verify` still PASS,
all `npm run check` gates green:

- **`PRD.md`** — header → Stage-0 **v9** with a revision note; §3 V2 grew 20→**29**
  (V-021 lease accounting, V-022 tax provision, V-023 ESG, V-024 treasury/banking,
  V-025 insurance/financial-instruments, V-026 advanced period-close, V-027 data governance,
  V-028 report scheduling/distribution, V-029 plugin marketplace); §4 FUTURE renumbered to **6**.
  The `NOT BUILDING` list and the 38-MVP set are unchanged.
- **`TODO.md`** — V2 backlog now lists V-021…V-029 with the v9 promotion note.
- **`ZERO-COMPROMISE-RULES.md`** — B20 + enforcement row counts corrected to **38/29/6** with the
  v9 rationale (MVP unchanged).
- **`DECISIONS.md`** — ADR-013 count note corrected.
- **`DOCS-INDEX.md`** — PRD row summary updated to 38 MVP + 29 V2 + 6 FUT.
- **`API-SPEC.md`** — `model.cell.set.v1` success row field aligned to `dirty_cells` (was `dirty`).
- **`FORMULA-ENGINE-SPEC.md`** — explicit **103-function** whitelist count + B14 mirror requirement.
- **`CHANGELOG.md`** — Unreleased Added/Changed entries documenting the v9 docs revision.

### What is still not a "build base" yet (next passes, by direction)

This pass upgraded scope/consistency/build-readiness of the _existing_ specs. It did **not** yet:

- Turn every one of the 42 screens into its own build-ready implementation contract (the
  SCREENS-SPEC has the 5 states; the command/schema bindings per screen are not yet enumerated).
- Port the predecessor engine algorithms into Rust with oracle tests (that is code, not docs).
- Add an explicit "implementation status" column to FEATURE-TRACEABILITY-MATRIX (a build tracking
  aid, currently left as a planning matrix).

---

_Prepared for the user's "reuse instead of scratch + all-in-one zero-compromise" directive.
Recommendation is directional; I left the current repo's working-tree model-grid changes intact._
