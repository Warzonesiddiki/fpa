# CHANGELOG.md

> OneFP&A · Kept in Keep-a-Changelog format. Versions follow semver. Releases: v1.0.0+.

## [Unreleased]
### Added
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
- First-run Wizard, Industry Pack library (12 packs), GL-Dump-first ingestion pipeline, Excel-compatible formula grid, driver-based modeling, scenarios/versions, consolidation engine, statement suite, audit trail, offline licensing — all specified. Implementation status is tracked per unit in the root `TASKBOARD.md` (snapshot 2026-09-03: 18/42 screens routed, 35 Rust IPC handlers, 39/97 error codes emitted, 526 tests; Rust side hand-reviewed only — native compile pending CI, see TASKBOARD §14). (Earlier text here said "none yet implemented" — stale since the M1 work of 2026-09-01; corrected, not rewritten, per `docs/ROADMAP.md`).
- **Zero-Compromise revision (2026-08-30):** 16 supplemental docs closing audit gaps — Industry Pack schema, Formula Engine function set, Money/Rounding algorithm, Modeling Methods, Scenario/Version semantics, Canonical GL Template, Connector Data Dictionary, Export Formats, Test Fixtures + oracles, Localization, Compliance/Data Sovereignty, Security Incident Response, DR Recovery Runbook, Onboarding User Guide, Release Checklist, **ZERO-COMPROMISE-RULES.md** (B1–B20 were referenced everywhere but never codified; QA base checklist renamed B1–B8 → Q1–Q8 to end the namespace collision).
- **Gap fixes in existing specs:** 72 → 96 typed IPC commands (added pack/cycle/collection/scenario-lifecycle/plan-analysis/board-pack/schedule/reconcile plus existing-groups expanded); 49 → 56 DB tables (planning_cycles, cycle_tasks, collection_uploads, reason_codes, annotations, currency_scales, license_requests); 82 → 97 error codes (added 15: FORMULA_UNSUPPORTED_FUNCTION, PACK_VERSION_EXISTS, PACK_IN_USE_LOCKED, CYCLE_NAME_DUP, CYCLE_TASK_BLOCKED, COLLECTION_CONFLICT, COLLECTION_STRUCTURE_CHANGED, CAPEX_IN_SERVICE_INVALID, PRODUCTION_CAPACITY, REVREC_COST_ESTIMATE_INVALID, COMPANY_IN_USE_RECENT, BASELINE_REPLACE_REASON_REQUIRED, MODEL_YEAR_EXISTS, SOURCE_BOOTSTRAP_EMPTY, PACK_NO_COMMENTARY); 42 screens (corrected from 47 — phantom refs for wizard/Pack Builder removed, S-023 Pack Studio added); glossary + 13 engineering terms; orphan refs fixed.

### Fixed
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
