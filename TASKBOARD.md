# OneFP&A — MASTER TASKBOARD

> **Live build tracker.** One row per PR-sized unit. Statuses: `❗ TODO` · `🟨 IN PROGRESS` ·
> `✅ DONE` · `⏸️ BLOCKED` · `🚧 PARTIAL`. **Rule: `DONE` means the DEFINITION-OF-DONE gate is
> green** (spec complete · 5 screen states · all error codes · money:ast · audit · coverage ·
> a11y · perf) — not "code merged".
>
> Quality bar = **real working app for real-world MNC decisions, zero compromises.** No mock-only
> implementation, no placeholder, no float money, no skipped gate, no silent fix. Every feature
> persists to the real DB and computes in the Rust core (B1/B3/B4/B6/B14).
>
> Update this file **in the same commit** as the work it tracks (B8-style traceability). Snapshot
> date: **2026-08-31**.

---

## 0. COMPLETION DASHBOARD (headline numbers)

| Scope item    | Spec target                        | Done now                                        | Progress |
| ------------- | ---------------------------------- | ----------------------------------------------- | -------- |
| MVP features  | 38 (F-001…F-038)                   | ~6 core + contract work                         | ~15%     |
| Screens       | 42 (S-001…S-076)                   | 9                                               | 21%      |
| API commands  | 96 catalog rows / 97 unique tokens | 19 typed TS + 20 Rust handlers                  | ~20%     |
| Error codes   | 97                                 | 31                                              | 32%      |
| DB tables     | 56                                 | 56 (schema complete)                            | 100%     |
| Quality gates | blocking                           | all green (lint/tsc/vitest/docs/money/security) | ✅       |
| Tests         | 26 files / 171 tests               | same                                            | ✅       |

**Current milestone: M1 Foundation (F-001…F-006).** M2 import core partially built. M3 model
**contract** (not engine) built. Nothing is half-shipped to production; `PARTIAL` rows are
explicitly tracked here.

---

## 1. STATUSES & DONE GATE

| Status           | Meaning                                                                   |
| ---------------- | ------------------------------------------------------------------------- |
| `❗ TODO`        | Not started; safe to pick up per dependency order                         |
| `🟨 IN PROGRESS` | Being worked on THIS branch right now                                     |
| `🚧 PARTIAL`     | Piece built (e.g. contract / mock / one command) but not the full feature |
| `✅ DONE`        | Full feature + **all** DoD gates green                                    |
| `⏸️ BLOCKED`     | Blocked by dependency/gate/toolchain (name the blocker)                   |

**DONE requires:** (a) all 5 screen states; (b) every error path uses a locked ERROR-HANDLING
code + userMessage + retry flag; (c) money is Rust `i64`/`rust_decimal` (no `money:ast`
violation); (d) every mutation appends an HMAC audit event; (e) unit + integration + oracle
tests; (f) a11y/axe 0; (g) perf budget; (h) docs synced; (i) **real DB/persistence** — no mock in
the product path (B18-3).

---

## 2. M0 — SPEC & FIXTURES (f-005-f-004-f-010)

| ID   | Unit                                    | Status     | Notes / next action                                                                    |
| ---- | --------------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| M0-1 | Stage-3 cross-doc audit                 | 🚧 PARTIAL | docs:verify PASS (53 docs / 42 screens / 96 rows / 97 codes); Stage-4 gates still open |
| M0-2 | Stage-4 build-readiness (5 gates → YES) | ❗ TODO    | Run 5-gate self-check after M1 sweep                                                   |
| M0-3 | Sample GL dump + Demo Company fixtures  | 🚧 PARTIAL | Pack keys exist; `docs/examples/sample_gl_dump.xlsx` not generated                     |
| M0-4 | Pack schema v1 + 12 packs               | ✅ DONE    | 12/12 packs validate (packs:validate PASS)                                             |

## 3. M1 — FOUNDATION (F-001…F-006) · CURRENT

| ID    | Feature                                              | Status     | Notes / next action                                                                                     |
| ----- | ---------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| M1-1  | Rust scaffold: AppError, Money, Calendar, migrations | ✅ DONE    | `core/error`, `core/money`, `core/calendar`, `001_initial.sql` (56 tables) ship                         |
| M1-2  | Tauri shell + S-004 + typed IPC gate                 | 🚧 PARTIAL | Shell + typed `CommandArgs` + bridge + 19 commands built; tauri-specta bindings not yet                 |
| M1-3  | Security: Argon2 PIN + recovery + AES-GCM + keychain | 🚧 PARTIAL | `security.pin_setup`, `session.unlock`, key-vault container built; recovery phrase + license still open |
| M1-4  | License (Ed25519 + grace + S-073)                    | ❗ TODO    | `license.*` commands documented, no handler                                                             |
| M1-5  | Company manager (S-020)                              | 🚧 PARTIAL | create/list/open/delete done; sandbox/archive/file-association not                                      |
| M1-6  | COA + dimensions (S-021)                             | 🚧 PARTIAL | `coa.list` + schema; import/merge/versioning not                                                        |
| M1-7  | Calendar engine (S-022)                              | ✅ DONE    | previews + `calendar.apply`; oracle fixtures present                                                    |
| M1-8  | First-Run Wizard (S-002)                             | ✅ DONE    | 5-step wizard + plan-only + demo toggle built                                                           |
| M1-9  | Pack loader + Pack Builder (S-023)                   | 🚧 PARTIAL | 12 packs load; Builder save/apply not                                                                   |
| M1-10 | Settings/theme/search skeleton (S-003/S-075)         | 🚧 PARTIAL | SearchPalette + theme tokens; settings persist not                                                      |

## 4. M2 — INGESTION (F-007…F-011)

| ID      | Feature                                   | Status     | Notes / next action                                                 |
| ------- | ----------------------------------------- | ---------- | ------------------------------------------------------------------- |
| M2-1    | Import hub + parser (calamine, encodings) | 🚧 PARTIAL | `import.parse` mock+command shape; real parser + 500k-row bench not |
| M2-2    | Mapping wizard + template versioning      | 🚧 PARTIAL | mapping_id contract; template save/version not                      |
| M2-3    | Validation + preview + HARD/WARNING       | ✅ DONE    | `import.validate` with rows/issues/preview                          |
| M2-4    | Tie-Out + commit + rollback + vault       | 🚧 PARTIAL | tie-out gate, commit, rollback built; Source Vault persist not      |
| M2-5    | Driver/dimension/opening-balance imports  | ❗ TODO    | same pipeline, kind enum ready                                      |
| M2-6..9 | Connectors QBO/Xero/NetSuite/Sage         | ❗ TODO    | no connector handler; B19 manual-import-first is green path         |
| M2-10   | Source reconciliation (S-034)             | ❗ TODO    | reconcile.\* commands documented, not built                         |

## 5. M3 — MODELING (F-012…F-020)

| ID    | Feature                                           | Status     | Notes / next action                                                                                                             |
| ----- | ------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| M3-1  | Multi-sheet + HyperFormula worker + cell.set      | 🚧 PARTIAL | **`model.cell.set.v1` + `model.recalc` contract, whitelist, exact money, audit built**; HyperFormula worker + S-041 grid UI not |
| M3-2  | Formula inspection + cycle/ref detection          | ❗ TODO    | error codes defined; engine not                                                                                                 |
| M3-3  | Driver tables + federation + bounds               | ❗ TODO    | schema present; `driver.*` not built                                                                                            |
| M3-4  | Assumption Register + hardcode detection          | ❗ TODO    | schema present; `assumption.*` not built                                                                                        |
| M3-5  | Methods + spread + bootstrap/copy                 | ❗ TODO    | error codes defined                                                                                                             |
| M3-6  | Headcount (S-045)                                 | ❗ TODO    | model.schedule path                                                                                                             |
| M3-7  | Capital/debt/WC/13-week + covenants (S-046)       | ❗ TODO    | `model.schedule.upsert` documented                                                                                              |
| M3-8  | Production/inventory/backlog + revrec (S-047/048) | ❗ TODO    | `REVREC_COST_ESTIMATE_INVALID` etc. defined                                                                                     |
| M3-9  | Excel-parity grid UX (keys/fill/undo/redo)        | ❗ TODO    | S-041                                                                                                                           |
| M3-10 | Analysis functions + named ranges                 | 🚧 PARTIAL | whitelist has CAGR/MOVINGAVG/TREND/SEASONALITY; engine not                                                                      |

## 6. M4 — PLANNING (F-021…F-023)

| ID   | Feature                            | Status  | Notes               |
| ---- | ---------------------------------- | ------- | ------------------- |
| M4-1 | Budget/Forecast/Rolling            | ❗ TODO | —                   |
| M4-2 | Scenario states/versions/baseline  | ❗ TODO | error codes defined |
| M4-3 | Model compare                      | ❗ TODO | `model.diff`        |
| M4-4 | What-if/sensitivity/goal seek      | ❗ TODO | commands documented |
| M4-5 | Planning cycle manager + checklist | ❗ TODO | `cycle.*`           |
| M4-6 | Input collection loop              | ❗ TODO | `collection.*`      |

## 7. M5 — ANALYSIS (F-024…F-026)

| ID   | Feature                    | Status  | Notes                      |
| ---- | -------------------------- | ------- | -------------------------- |
| M5-1 | Variance $/%/F/U + 3-way   | ❗ TODO | `variance.get`             |
| M5-2 | Attribution + reason codes | ❗ TODO | `variance.set_reason_code` |
| M5-3 | FVA (MAPE/bias/hit)        | ❗ TODO | `fva.get`                  |
| M5-4 | Alerts engine + center     | ❗ TODO | `alerts.*`                 |

## 8. M6 — REPORTING & GOVERNANCE (F-027…F-033)

| ID   | Feature                                                  | Status     | Notes                                                                                 |
| ---- | -------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| M6-1 | Statement engine + tie-out + rounding                    | ❗ TODO    | `statement.get.v1`                                                                    |
| M6-2 | GAAP/IFRS presets + segment                              | ❗ TODO    | —                                                                                     |
| M6-3 | Consolidation: rollup/IC/FX/NCI                          | ❗ TODO    | `consolidation.*`                                                                     |
| M6-4 | Report/KPI Builder                                       | ❗ TODO    | `report.layout.*` / `kpi.define`                                                      |
| M6-5 | Dashboard + Board Pack                                   | ❗ TODO    | S-010 dashboard skeletal                                                              |
| M6-6 | Export suite (xlsx/PDF/dump/data room) + injection guard | ❗ TODO    | `export.*`                                                                            |
| M6-7 | Health Check + waiver                                    | ❗ TODO    | `health.*`                                                                            |
| M6-8 | Audit trail engine + data room                           | 🚧 PARTIAL | HMAC chain + `audit_events` + `model/import` events built; S-070/data-room export not |
| M6-9 | Backup/restore/retention + updater                       | 🚧 PARTIAL | A02 encrypted container + snapshots schema; backup/restore command not                |

## 9. M7 — RELEASE

| ID   | Unit                                 | Status     | Notes                                                                                                |
| ---- | ------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------- |
| M7-1 | CI 12-stage 3-OS + branch protection | ❌ TODO    | `.github/workflows` intentionally not pushed (token lacks Workflows permission); keep `infra/ci.yml` |
| M7-2 | Signing/notarization/manifest/SBOM   | ❗ TODO    | —                                                                                                    |
| M7-3 | Perf bench + baseline                | ❗ TODO    | —                                                                                                    |
| M7-4 | A11y full sweep + keyboard E2E       | 🚧 PARTIAL | per-screen tests; full sweep not                                                                     |
| M7-5 | E2E 14 flows × 3 OS                  | ❗ TODO    | 1 e2e file (`unlock.spec.ts`)                                                                        |
| M7-6 | Demo + packs QA; docs:verify final   | 🚧 PARTIAL | packs QA green                                                                                       |
| M7-7 | rc1 → v1.0.0 release                 | ❗ TODO    | —                                                                                                    |
| M7-8 | TODO archival + carry-forward to V2  | ❗ TODO    | V2 backlog now documented                                                                            |

---

## 10. SCREEN TRACKER (42 screens)

| Screen                | Status     | Screen                  | Status  |
| --------------------- | ---------- | ----------------------- | ------- |
| S-001 Unlock          | ✅ DONE    | S-041 Model Grid        | ❗ TODO |
| S-002 Wizard          | ✅ DONE    | S-042 Formula Inspector | ❗ TODO |
| S-003 Global Search   | 🚧 PARTIAL | S-043 Drivers           | ❗ TODO |
| S-004 App Shell       | ✅ DONE    | S-044 Assumptions       | ❗ TODO |
| S-010 Dashboard       | 🚧 PARTIAL | S-045 Headcount         | ❗ TODO |
| S-020 Companies       | 🚧 PARTIAL | S-046 Capital/Debt/WC   | ❗ TODO |
| S-021 COA             | 🚧 PARTIAL | S-047 Production        | ❗ TODO |
| S-022 Calendar        | ✅ DONE    | S-048 RevRec            | ❗ TODO |
| S-023 Packs           | 🚧 PARTIAL | S-050 Scenarios         | ❗ TODO |
| S-030 Import Hub      | 🚧 PARTIAL | S-051 Compare           | ❗ TODO |
| S-031 Mapping         | 🚧 PARTIAL | S-052 What-If           | ❗ TODO |
| S-032 Commit          | 🚧 PARTIAL | S-053 Cycle/Collection  | ❗ TODO |
| S-033 Connectors      | ❗ TODO    | S-054 Variance          | ❗ TODO |
| S-034 Reconciliation  | ❗ TODO    | S-055 FVA               | ❗ TODO |
| S-040 Sheets          | ❗ TODO    | S-056 Alerts            | ❗ TODO |
| S-060 Statements      | ❗ TODO    | S-070 Audit             | ❗ TODO |
| S-061 Segment         | ❗ TODO    | S-071 Health            | ❗ TODO |
| S-062 Report Builder  | ❗ TODO    | S-072 Security          | ❗ TODO |
| S-063 KPI Builder     | ❗ TODO    | S-073 License           | ❗ TODO |
| S-064 Dashboard/Board | ❗ TODO    | S-074 Backup            | ❗ TODO |
| S-075 Settings        | 🚧 PARTIAL | S-076 About/Update      | ❗ TODO |

## 11. API COMMAND TRACKER (96 rows / 97 unique)

| Group                              | Done (Rust+TS typed)                                                         | Remaining                                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| session / security                 | session.status, session.unlock, session.lock, security.pin_setup             | security.change*pin, security.recovery*_, license._                                                                                 |
| company                            | company.list, company.create, company.open, company.delete                   | company.clone_sandbox, company.archive_year                                                                                         |
| calendar / coa / pack              | calendar.preview, calendar.apply, coa.list, pack.list                        | coa.import, coa.merge_accounts, pack.validate/install/builder.\*                                                                    |
| import                             | import.parse, import.validate, import.tieout, import.commit, import.rollback | import.map.save_v1, import.history                                                                                                  |
| model                              | model.cell.set.v1, model.recalc                                              | model.create/list/sheet.add/inspect/diff/dump_export/year.copy, model.schedule.upsert                                               |
| scenario / plan / analysis         | —                                                                            | scenario._, baseline.set, plan._, variance._, fva.get, alerts._                                                                     |
| consolidation / statement / export | —                                                                            | consolidation._, statement.get.v1, export._, report.layout._, kpi.define, health._, audit.\*                                        |
| platform                           | —                                                                            | backup._, settings._, update.check, app.diagnostics.export, reconcile._, connector._, driver._, assumption._, cycle._, collection._ |

**Add a new command:** (1) add Zod schema + row to `CommandArgs` in `src/api/schema.ts`; (2) add
Rust handler + `generate_handler!` in `src-tauri/src/lib.rs`; (3) add mock case; (4) add schema +
mock tests; (5) audit-gate it if mutating; (6) update this board.

## 12. ERROR CODE TRACKER (97 locked)

Done (31): `AUDIT_CHAIN_BREAK` `AUTH_LOCKED` `AUTH_PIN_INVALID` `BATCH_ALREADY_ROLLED_BACK`
`CAL_53WEEK_CONFLICT` `CAL_PERIOD_MAPPING_CONFLICT` `CAL_TRANSIT_AMBIGUOUS` `COMPANY_IN_USE_RECENT`
`DRIVER_OUT_OF_BOUNDS` `ENCODING_UNSUPPORTED` `FORMULA_CYCLE` `FORMULA_UNSUPPORTED_FUNCTION`
`HARDCODED_ASSUMPTION` `IMPORT_BATCH_HASH_EXISTS` `IMPORT_FILE_LOCKED` `IMPORT_FILE_UNREADABLE`
`IMPORT_PARSE_EXPIRED` `IMPORT_TIE_OUT_FAILED` `INTERNAL` `MAP_ACCOUNT_AMBIGUOUS`
`MODEL_CELL_LOCKED` `OPENING_ALREADY_SET` `PERIOD_NOT_FOUND` `PIN_POLICY_WEAK` `REFERENCE_BROKEN`
`SESSION_LOCKED` `STORAGE_DECRYPT_FAILED` `STORAGE_FILE_CORRUPT` `STORAGE_FILE_EXISTS`
`UNIT_PERIOD_MISMATCH` `VALUE_INVALID`.

**Rule:** never invent a code; reuse the 97. Add a code only through a Stage-0 docs decision + B20.

## 13. QUALITY GATES (must be green on every commit on this branch)

```
npm run check      # lint + typecheck + test + docs:verify + packs + money:ast + security
npm run build
npx prettier --check .
npx vitest run --coverage                # ≥85/80/80/85 (now 92.87/85.48/87.87/94.83)
npx vitest run --config vitest.critical.config.ts --coverage  # ≥95/90/90/95 (now 98.95/97.52/100/99.42)
```

**Zero-compromise non-negotiables (real world):** no `Number(` in a financial path (money:ast);
no `f64/f32` in Rust; no `toFixed` outside `utils/money.ts`; no mock data in product path; no raw
errors to UI; no untested `DONE`; no skipped gate; no silent auto-fix — Health Check surfaces, a
human decides.

---

_Owned by the build. Move rows only when their gate is actually green. Next logical pick:
**M3-1 HyperFormula worker + S-041 grid** (the model.cell.set.v1 contract is ready to be wired)._
