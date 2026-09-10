# OneFP&A — EVIDENCE STANDARDS FOR PERFECTION (v9, 2026-09-09)

> **Purpose:** There is no "close enough." There is only executed evidence. This document defines exactly what evidence must exist for any feature, screen, command, error code, audit event, or quality gate to claim it is complete. It applies to every milestone (M0–M7) and to the M8 Perfection Sprint.

---

## 1. THE FIVE PILLARS OF EVIDENCE

Every claim of completeness must satisfy all five pillars. A feature missing any pillar is `🚧 PARTIAL` or `❗ TODO`, never `✅ DONE`.

### Pillar 1 — Executed Command Evidence (not review comments)
- The exact command output (`npm run check`, `npm run build`, `cargo test`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check`, `npm audit --audit-level=high`, `npm run docs:verify`, `npm run packs:validate`, `npm run money:ast`, `npm run bench`) must be captured in the taskboard row or linked evidence file.
- If a native gate (`cargo`) is unavailable, the exact reason (`bash: cargo: command not found`, `rustc` version, toolchain file reference) must be documented; the feature cannot claim `✅` for native gates.
- No feature claims `✅` based on code review, chat statements, or "looks good" assessments.

### Pillar 2 — Real Database Persistence (no mock-only in product path)
- Every mutation writes to the actual SQLite DB (`onefpa.db` or `.fpa` container) with an HMAC-SHA256 audit event (`audit_events` table) in the same transaction.
- The mock (`src/api/mock.ts`) must mirror the real Rust contract exactly (same error codes, same response shapes, same validation rules) — but the mock is for dev-preview only; the product path uses the real DB.
- If persistence is missing (e.g., `model.cell.set.v1` writes audit only, not `model_values`), the feature is `🚧 PARTIAL` with the exact persistence gap named.

### Pillar 3 — Five Canonical Screen States + All Error Paths
- Every screen (`S-001` through `S-076`, plus dialogs `D-001` through `D-010`) must have explicit implementations for:
  1. `loading`
  2. `empty`
  3. `error` (with exact error code from `ERROR-HANDLING.md`)
  4. `success`
  5. `populated`
- Every error state must show the locked error code (`AUTH_PIN_INVALID`, `VALUE_INVALID`, etc.), the user message (`userMessage` from `core/error.rs`), the retry flag (`retry` boolean), and any retry timer (`retryAfterMs` for `AUTH_LOCKED`).
- No screen claims `✅` with only 3 or 4 states implemented.

### Pillar 4 — Audit Event Verification
- Every mutation produces an HMAC audit event with: `author` (authenticated user/session), `action` (catalog command name, snake_case), `before` (serialized previous state), `after` (serialized new state), `timestamp` (UTC, synchronized), `company_id` (scope), and `integrity_check` (`HMAC-SHA256` over the serialized payload using the key from OS keychain or container envelope).
- The audit chain must verify: `previous.integrity_check` → `current.state` → `current.integrity_check` forms an unbroken sequence.
- If audit is missing for any mutation path, the feature is `🚧 PARTIAL` with the exact missing audit event named.

### Pillar 5 — Coverage + Performance + Accessibility Gates
- Coverage: `S/B/F/L ≥ 85/80/80/85` for main; `S/B/F/L ≥ 95/90/90/95` for critical (measured by `scripts/coverage-gate.mjs`).
- Performance: startup `< 5s`; recalc `< 50ms` per cell, `< 2s` full model; import `< 5s` for 100k GL rows; consolidation `< 10s` for 50 BU; export `< 5s` (defined in `PERFORMANCE-REQUIREMENTS.md`).
- Accessibility: axe 0 violations (`axe-core`); keyboard-only operation verified (`Tab` order, `Enter` activation, `Esc` close, arrow-key navigation); focus restoration after modal/drawer close; 200% zoom; reduced-motion support; no color-only signals (icon + text always paired).
- If any gate fails, the feature cannot claim `✅`.

---

## 2. EVIDENCE TEMPLATE (MANDATORY FOR EVERY ROW)

Every `TASKBOARD.md` row must include or reference:

```
Status: [❗ TODO / 🟨 IN PROGRESS / 🚧 PARTIAL / ✅ DONE / ⏸️ BLOCKED]
Evidence command(s): [exact npm/cargo commands executed]
Evidence result(s): [PASS / FAIL with exact error message, or "not executed — blocker: ..."]
Native gate executed: [YES / NO — reason: ...]
DB persistence verified: [YES — table/row referenced / NO — gap named]
Audit event verified: [YES — event code / NO — gap named]
Screen states (5/5): [list completed / missing]
Error paths covered: [count / missing codes]
Coverage gate: [PASS — S/B/F/L percentages / FAIL / NOT RUN]
Performance gate: [PASS / FAIL / NOT RUN — budget reference]
A11y gate: [PASS — axe 0 / FAIL / NOT RUN]
Docs synced: [YES — files updated / NO — files named]
Blocker / next action: [exact missing gate or dependency]
```

If any field is missing, the row does not meet the evidence standard.

---

## 3. EVIDENCE STANDARDS BY MILESTONE

### M0 — Spec & Fixtures
- **Evidence:** `npm run docs:verify` PASS (64 docs indexed, 42 screens, 103 commands, 87 codes + 21 reserved); `scripts/docs-index-gen.mjs` matches disk; `tests/fixtures/calendar/` files exist (`nrf-454-2024-2028.json`, `nrf-544-expected.json`, `README.md`); `tests/fixtures/demo_company/` byte-identical (`sha256: 42b7...40a`); `docs/examples/sample_gl_dump.csv` deterministic; `.gitignore` no longer ignores fixtures; `FEATURE-TRACEABILITY-MATRIX.md` contradiction scan 0 open items (except tracked Stage-0 recalc token); terminology audit 0 open violations (8 fixed in 2026-08-31 re-scan).
- **Native gate:** `cargo test` unavailable in sandbox; CI required for M7-1.

### M1 — Foundation
- **Evidence:** `core/money.rs` uses `rust_decimal`; `core/error.rs` has 99 locked codes; `core/calendar.rs` has inline NRF assertions; `001_initial.sql` has 56 tables; `pack.schema.json` nested layout verified; `tasks/settings.get` and `tasks/settings.set` have HMAC audit events; `company.create` seeds all 5 wizard steps; `company.clone_sandbox` has audit event; `calendar.preview` has fixture-bound tests; `cal.fixtures` tests bind to files.
- **Native gate:** `cargo fmt --check` clean; `cargo clippy --all-targets -- -D warnings` PASS; `cargo test` 263/263 PASS (2026-09-07, Windows desktop, `rustc 1.98.1`).

### M2 — Ingestion
- **Evidence:** `import.parse` handles XLSX/XLS/CSV/TSV/BOM/Latin-1; `import.map.save_v1` has strict Zod + version control + HMAC audit; `import.validate` produces HARD/WARNING responses with 50-row preview cap; `import.tieout` shows exact integer totals and only attributable exclusions; `import.commit` writes `gl_lines` + `ic_lines` + exclusion metadata atomically; `import.history` has paginated persistent results; `import.rollback` deletes only target batch + writes reason audit; `tests/fixtures/coa/` has 5 input/expected pairs.
- **Native gate:** All Rust handlers (`import.parse`, `map.save_v1`, `validate`, `tieout`, `commit`, `rollback`, `history`) registered in `lib.rs`; `cargo test` verifies wire contracts, normalization, audit chain, rollback lineage. M2-4 Source Vault remains `⏸️ BLOCKED` on compressed payload schema + atomic resealing.

### M3 — Modeling
- **Evidence:** `modelEngine.ts` evaluates 8 Analysis Functions natively (CAGR, MOVINGAVG, TREND, SEASONALITY, YOY, PRIORPERIOD, PRIORYEAR, RATIO); Named Ranges (`addNamedRange`/`removeNamedRange`/`listNamedRanges`/`getNamedRangeValue`) wrap HyperFormula expressions; `findHardcodedLiterals` detects hardcoded values; `driver.upsert` validates exact-decimal bounds; `assumption.upsert` writes to DB + audit; `model.schedule.upsert` (headcount) has `schedule_id`, `recalc`, positive `audit_id`, `HC_DATE_INVALID`/`HC_OVERLAP`; `spreading.ts` validates weights 1.00 ± 1e-6; `clearCell` supports undo-to-empty; `modelHistory.ts` manages ≥250 undo levels.
- **Native gate:** `driver_values` persistence NOT written (M3-3); `model_values` persistence NOT written (M3-1); `driver.import` destination pipeline unbuilt; `cargo test` unavailable for M3-4 hardcode scan audit event.

### M4 — Planning
- **Evidence:** `scenario.create`/`duplicate`/`submit`/`approve`/`lock`/`reopen`/`delete` + `baseline.set` all have typed Rust handlers + HMAC audit; `SCENARIO_NAME_DUP`/`SCENARIO_LOCK_CONFLICT` emitted; `plan.whatif_overlay`/`plan.sensitivity` (tornado) / `plan.goal_seek` (bisection, ≤100 iters, 1e-9 tolerance) have exact Decimal arithmetic; `cycle.*` commands have milestone tracking; `collection.export`/`collection.import` have conflict detection and audit.
- **Native gate:** All 6 M4 rows have native Rust handlers (`scenario.rs`, `plan.rs`, `cycle.rs`, `collection.rs`); `cargo test` verified 161/161 for M4-2; M4-3/4/5/6 have native commands but E2E flows remain `🚧 PARTIAL` (native tauri-driver unavailable).

### M5 — Analysis
- **Evidence:** `variance.get` produces exact integer-minor deltas + Decimal % + F/U evaluation; `variance.set_reason_code` writes HMAC audit; `fva.get` produces MAPE/bias/hit rate with version threshold; `alerts.create_rule` validates exact-decimal thresholds; `alerts.list` filters with 90-day retention; `M5-4` 34/34 gates pass.
- **Native gate:** `alerts.dismiss`/`alerts.mute_rule` added to catalog (§7); Rust `commands/alerts.rs` authored; `ALERT_RULE_INVALID` mapped; `cargo test` unavailable here.

### M6 — Reporting & Governance
- **Evidence:** `statement.get.v1` produces P&L/BS/CF with tie-outs (`statement.rs`); S-060 has 5 canonical states + 0 axe; `consolidation.run` detects `IC_UNMATCHED` (422) and `SEGMENT_TRANSLATION_PENDING` (409); `report.layout.save`/`render` + `kpi.define` have broken-reference (`LAYOUT_REFERENCE_BROKEN`) and division-by-zero (`KPI_DIV_ZERO`) detection; `export.*` has injection guard (`sanitize_cell_formula_injection`) + health-check gate (`HEALTH_CHECK_BLOCKED`); `health.run`/`health.waive` have 5-category engine + fingerprint-carry-forward + audit; `audit.list` exposes chain verdict; `audit.export_dataroom` writes HMAC audit; `backup.create`/`backup.restore` have AES-256-GCM + snapshot + audit.
- **Native gate:** `statement.get.v1` mock + page tests green; `consolidation.*` 225/225 cargo tests PASS; `export.*` `cargo test --lib commands::export` PASS; `health.*` `cargo test` verified; `audit.*` `cargo test` verified; `backup.*` vitest 4/4 PASS. Largest-remainder rounding (`MONEY-ROUNDING-SPEC` §3) and 3-OS deterministic export (`EXPORT-FORMAT-SPEC` §3) require CI reference hardware (M7-3).

### M7 — Release
- **Evidence:** `.github/workflows/ci.yml` exists (12 stages); `npm run bench` defined; `playwright` 6/6 specs PASS (Chromium, Windows); `docs/STRATEGIC-VISION.md` and `docs/AUDIT-VECTOR-PLAN.md` added to DOCS-INDEX; 25 audit vectors named honestly (`❗ TODO`); no fabricated baseline numbers.
- **Native gate:** `.github/` not published (token lacks `workflows`); 3-OS CI matrix (M7-1); signing certs (KI-003); E2E native tauri-driver (M7-5); performance baseline numbers (M7-3) — all explicitly tracked.

---

## 4. CONTINUOUS SESSION TRACKING (2026-09-09 — NEXT 5 HOURS)

This file is updated continuously during the session. Each update adds:
- Time stamp
- Document/file updated
- Evidence produced (command output or new content)
- Next action or blocker resolved

**Session start: 2026-09-09 (current turn)**

---

*Every claim in this file must reference a command output, a file edit, or a verified test result — never a statement of intent.*
