# CHANGELOG.md

> OneFP&A · Kept in Keep-a-Changelog format. Versions follow semver. Releases: v1.0.0+.

## [Unreleased]
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
  `docs:verify` claim, `README.md`, `HANDOVER.md`, `CONTINUE-PROMPT.md`, `ARCHITECTURE.md`, `docs/CLAUDE.md` and the
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
