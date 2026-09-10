# OneFP&A — PERFECT CHECKLIST (v9, 2026-09-09)

> **Purpose:** This checklist is used before any feature claims `✅ DONE`, before any release claims `v1.0.0`, and continuously during the M8 Perfection Sprint. It has zero exceptions. If a box is not checked, the claim is false.

---

## A. FEATURE-LEVEL PERFECT CHECKLIST (apply to every M1–M6 feature)

For each feature (`F-001` through `F-038`) and each milestone (`M0` through `M8`):

- [ ] **A1. Spec exists** — the spec file (`docs/SCREENS-SPEC.md`, `docs/API-SPEC.md`, `docs/INDUSTRY-PACK-SPEC.md`, `docs/MODELING-METHODS-SPEC.md`, etc.) contains the exact behavior, not a description of intent.
- [ ] **A2. 5 screen states implemented** — `loading`, `empty`, `error`, `success`, `populated` all exist in code and are tested.
- [ ] **A3. Every error path uses locked code** — the error code exists in `ERROR-HANDLING.md` (99 codes locked), is emitted from `core/error.rs` (Rust) or mirrored in `src/api/mock.ts` with identical text, and is shown in the UI with `userMessage` + `retry` flag.
- [ ] **A4. Money is exact** — no `Number(`, no `f64`, no `float` in any financial path; `rust_decimal` or integer minor units (`i64`) used; `npm run money:ast` PASS.
- [ ] **A5. Audit event verified** — every mutation produces an HMAC event (`audit_events` table); the event contains `author`, `action`, `before`, `after`, `timestamp`, `company_id`, `integrity_check`; the chain verifies (`previous.integrity_check` → `current.state` → `current.integrity_check` unbroken).
- [ ] **A6. Real DB persistence** — no mock-only path in production; `sqlite` (`.fpa` or `onefpa.db`) is the source of truth; the mock mirrors the real contract but is not relied upon.
- [ ] **A7. Unit + integration + property tests** — at minimum: engine tests (pure functions), protocol tests (wire contract), store tests (state mutation), page tests (UI states + a11y), schema tests (Zod binding), mock tests (parity verification), fixture/oracle tests (deterministic expected values).
- [ ] **A8. Coverage gates green** — main `S/B/F/L ≥ 85/80/80/85`; critical `S/B/F/L ≥ 95/90/90/95`; measured by `scripts/coverage-gate.mjs` (not approximate).
- [ ] **A9. Performance budget met** — startup `< 5s`; recalc `< 50ms` per cell / `< 2s` full model; import `< 5s` for 100k GL rows; consolidation `< 10s` for 50 BU; export `< 5s`; measured by `npm run bench` or `cargo bench` on reference hardware (not sandbox estimates).
- [ ] **A10. A11y gate green** — `axe-core` 0 violations; keyboard-only operation (Tab/Enter/Esc/arrows); focus restoration; reduced-motion; no color-only signals (icon + text); 200% zoom; multi-monitor/window-state persistence.
- [ ] **A11. Security gate green** — `security.pin_setup` + `session.unlock` + AES-256-GCM + HMAC key in OS keychain/container; `security.scan` PASS; no telemetry (`scripts/telemetry-scan.mjs` PASS); `LICENSE-SPEC.md` verified.
- [ ] **A12. Docs synchronized** — `DOCS-INDEX.md` includes the doc; `docs:verify` PASS (links, terminology, off-index detection); `FEATURE-TRACEABILITY-MATRIX.md` row exists and is consistent; `TASKBOARD.md` row updated with evidence; `AUDIT-VECTOR-PLAN.md` references any audit vectors the feature addresses.
- [ ] **A13. Native gates executed** — `npm run check` PASS; `npm run build` PASS; `cargo fmt --check` clean; `cargo clippy --all-targets -- -D warnings` PASS; `cargo test` PASS (if native handler exists); `npm audit --audit-level=high` 0 vulnerabilities; `npm run packs:validate` 12/12 (if pack-related); `npm run docs:verify` PASS.
- [ ] **A14. Zero fabricated claims** — no feature claims `✅` without the above evidence; no mock-only production path; no deferred error handling; no placeholder text; no invented test results.
- [ ] **A15. Blocker named honestly** — if `✅` is impossible (e.g., native CI unavailable, 3-OS matrix pending, performance reference hardware missing), the exact blocker is named in `TASKBOARD.md` and `MILESTONE-EVIDENCE.md`; the feature stays `🚧 PARTIAL` until the blocker is resolved.

---

## B. RELEASE-LEVEL PERFECT CHECKLIST (v1.0.0)

Before any tag or release label (`v1.0.0`, `rc1`, etc.):

- [ ] **B1. All 38 MVP features verified** — `TASKBOARD.md` M1–M6 rows show `✅` or `🚧 PARTIAL` with named blockers; `FEATURE-TRACEABILITY-MATRIX.md` shows 0 `❌` gaps.
- [ ] **B2. All 42 screens verified** — `SCREENS-SPEC.md` 42 screens complete; `TASKBOARD.md` screen tracker shows all 42.
- [ ] **B3. All 103 typed commands verified** — `API-SPEC.md` 103 rows; `TASKBOARD.md` command tracker shows 87 native + full TS mock parity; 18 no-handler commands tracked in `NEXT-UP` with design-first order (no fake stubs).
- [ ] **B4. All 99 error codes locked** — `ERROR-HANDLING.md` taxonomy complete; `core/error.rs` constructs verified; `docs/AUDIT-VECTOR-PLAN.md` shows 99 codes mapped.
- [ ] **B5. All 56 DB tables verified** — `DATABASE-SCHEMA.md` 56 tables; `script/schema-equality-check.mjs` PASS; no float money columns (`money:ast` PASS).
- [ ] **B6. All 5 build-readiness gates green** — G1 docs, G2 fixtures, G3 command parity, G4 toolchain, G5 contradictions (0 open except tracked Stage-0 recalc token).
- [ ] **B7. All 12 Industry Packs verified** — `INDUSTRY-PACK-SPEC.md` §10; `packs:validate` 12/12; `tests/fixtures/calendar/` 5 presets; `tests/fixtures/coa/` 5 pairs.
- [ ] **B8. All 25 audit vectors documented** — `docs/AUDIT-VECTOR-PLAN.md` 25 vectors; `TASKBOARD.md` M8 Perfection Sprint references them; no hidden gaps.
- [ ] **B9. All quality gates blocking (14 gates)** — `npm run check` PASS; `npm run build` PASS; coverage main + critical PASS; docs:verify PASS; packs PASS; money:ast PASS; security PASS; `npm audit` 0 HIGH; `cargo` gates verified locally (or explicitly named as CI-only).
- [ ] **B10. Zero telemetry** — `scripts/telemetry-scan.mjs` PASS; `B18-9` verified.
- [ ] **B11. Zero mock in production path** — `B18-3` verified; `tests/fixtures/` clearly marked; `Demo Company` clearly marked.
- [ ] **B12. Zero float money** — `money:ast` PASS; `core/money.rs` uses `rust_decimal`; `utils/money.ts` exact; no `f64`/`f32` in financial path (`MONEY-ROUNDING-SPEC.md` verified).
- [ ] **B13. Scope discipline (B20)** — 38 MVP + 29 V2 + 6 FUT; no half-shipped features; `PRD.md` §5 NOT BUILDING enforced; `DOCS-INDEX.md` reflects locked scope.
- [ ] **B14. Platform parity (B18-8)** — identical behavior on all 3 OS; native gates executed locally; CI targets 3 OS (blocked by token — named honestly).
- [ ] **B15. Documentation consistency (B8)** — `docs/DOCS-INDEX.md` 68 indexed; `FEATURE-TRACEABILITY-MATRIX.md` 0 gaps; contradiction scan 0 open (except tracked recalc token); terminology audit 0 open.
- [ ] **B16. Security designed in (B18-4)** — `SECURITY.md` + `SECURITY-CHECKLIST.md` + `AUTH-SPEC.md` + `LICENSE-SPEC.md` verified; `npm run security:scan` PASS; `security.scan` clean.
- [ ] **B17. Accessibility gate (B11)** — `axe` 0 violations per screen (42 screens verified); keyboard-only operation; `ACCESSIBILITY.md` verified.
- [ ] **B18. Zero fabricated evidence** — `EVIDENCE-STANDARDS.md` §4 continuous session log shows executed commands, not intent statements; `MILESTONE-EVIDENCE.md` shows exact results per milestone.

---

## C. CONTINUOUS SESSION LOG (2026-09-09 — NEXT 5 HOURS)

Every update to this file must include a timestamp, the file edited, the command executed (if applicable), the result, and the next blocker/action.

| Timestamp | File / Action | Command / Evidence | Result | Next blocker / action |
|---|---|---|---|---|
| 2026-09-09 (start) | `docs/STRATEGIC-VISION.md` created; `README.md` updated; `COMPETITIVE-ANALYSIS.md` updated; `PRD.md` updated; `TASKBOARD.md` M8 + strategic reference added; `docs/AUDIT-VECTOR-PLAN.md` created; `docs/EVIDENCE-STANDARDS.md` created; `docs/MILESTONE-EVIDENCE.md` created; `docs/DOCS-INDEX.md` updated (#66–#69); `ZERO-COMPROMISE-RULES.md` updated | `npm run docs:verify` PASS; `git status` shows 6 changed + 5 new (11 files total) | Strategic vision, audit vector plan, evidence standards, milestone tracker, perfect checklist all created/updated; DOCS-INDEX consistent (68 docs + README = 69 rows); `TASKBOARD.md` M8 Perfection Sprint added | Continue session with specific feature fixes (user direction needed for M3-1 persistence, M6-1 statement oracles, M5-1 variance, or M4-3 compare) |

---

*This checklist is enforced continuously. Any claim of `✅ DONE` that does not reference evidence in this file or in `TASKBOARD.md` or in `MILESTONE-EVIDENCE.md` is automatically invalid.*
