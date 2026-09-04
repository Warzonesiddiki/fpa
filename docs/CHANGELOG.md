# CHANGELOG.md

> OneFP&A · Kept in Keep-a-Changelog format. Versions follow semver. Releases: v1.0.0+.

## [Unreleased]
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
