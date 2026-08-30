# ZERO-COMPROMISE-RULES.md

> OneFP&A · v1.0.0 · **The canonical definition of the Stage-0 Zero-Compromise rules B1–B20 (including B18-1…B18-9).** These are the *product/architecture* rules referenced by DECISIONS.md ADRs, GLOSSARY, PRD, and every spec. They are NOT the per-feature QA checklist — QA uses **Q1–Q8** (QA-CHECKLIST.md §1, renamed 2026-08-30 to remove the old B1–B8 collision).
> Any doc that cites a B-rule must cite the number as defined here; a new rule requires a Stage-0-style decision + this file update (B20).

---

## B-RULES (product & architecture — normative)

| # | Rule | Source / ADR |
|---|---|---|
| **B1** | Desktop native only. No HTTP server, account server, web/PWA runtime, or cloud dependency exists in the product; the dev web preview is build tooling, never a product surface. | ADR-001 (A4, A19) |
| **B2** | Local-first, offline-capable, single-user (one machine, multiple Company Files). Every feature must work with zero network. Multi-user is V-015. | A6, A19; DR-RECOVERY-RUNBOOK |
| **B3** | Money is exact, always. Money Value with integer minor units / decimal strings; no float anywhere on a financial path at rest, in IPC, or in UI math; `npm run money:ast` gate. | ADR-003 (I1, A12); MONEY-ROUNDING-SPEC |
| **B4** | One storage engine: SQLite (WAL) inside the app data directory; DB is Rust-only (UI never queries it); no browser IndexedDB. | ADR-005 |
| **B5** | Deterministic & reproducible: identical inputs → identical values and export bytes on all platforms; every engine has property + oracle fixtures; no network in tests. | A11, A12; TEST-FIXTURES-SPEC |
| **B6** | Financial computation is owned by the Rust core (statements, calendar, consolidation, money, audit). The UI never computes money; the formula engine is the single documented exception (B14). | ADR-010 |
| **B7** | Every mutation is audited: event with before/after + author + timestamp, appended to the HMAC-SHA256 chain; read-only commands don't need events. | ADR-011 (B18-1) |
| **B8** | Docs are the source of truth: every doc is in DOCS-INDEX.md; off-index docs fail CI; terminology per GLOSSARY.md verbatim. | DOCS-INDEX; CI `docs:verify` |
| **B9** | One source of truth per global config: product name, version, brand strings live in one config file (no copies). | ADR-019 |
| **B10** | No TBDs/placeholders/weasel words in shipped specs: every claim is specific (exact value, exact state, exact error code, exact column). | DEFINITION-OF-DONE §2 |
| **B11** | Accessibility is a gate, not a review step: axe 0 violations, keyboard-only operation, 200% zoom, reduced-motion, no color-only signals. | QA-CHECKLIST Q4 (A11) |
| **B12** | Every error is a typed code from ERROR-HANDLING.md with userMessage + retry flag; no silent catch, no raw Russian-doll errors in UI. | ERROR-HANDLING (B18-5/6) |
| **B13** | Technology budget ≤ 15 (12 shipped, 3 dev-only). A new runtime technology requires an ADR; dev-only tech never ships. | ADR-002 |
| **B14** | One owner per concern, one implementation: one Money Core, one Calendar engine, one Formula engine, one Ingestion pipeline. Duplicate implementations are a defect. | ADR-002/004/010 |
| **B15** | Industry Packs are DATA, never code. Per-industry engines/sector modules are forbidden; "all industries" = engine + Pack data. | ADR-006 (A21) |
| **B16** | Models stay simple: 5–7 core drivers advisory, modular input/calc/output layout, no overcomplicated chain; complexity is surfaced, not hidden. | INDUSTRY-PACK-SPEC; MODELING-METHODS-SPEC |
| **B17** | AI: none in v1.0.0. v1.1 (V-001) is on-device, explainable-only, opt-in, never a data dependency. | A13, A17 |
| **B18** | Quality gates are blocking; nothing skippable — see sub-rules: | — |
| **B18-1** | Audit chain: HMAC-SHA256, key in OS keychain; tamper → read-only + restore path. | ADR-011 |
| **B18-2** | No IEEE-754 float across the IPC boundary for money (i64 minor units / decimal string only). | GLOSSARY Money Value |
| **B18-3** | No mock/demo/fixture data in production paths; Demo Company is a separate, clearly-marked artifact; fixtures live in `tests/fixtures/`. | TEST-FIXTURES-SPEC |
| **B18-4** | Security designed in, not bolted on: threat model, crypto parameters, secrets policy documented and CI-verified in every release. | SECURITY-CHECKLIST |
| **B18-5/6** | All states & errors ship in the same PR as the feature. No "we'll add error handling later"; no deferred edge cases for a v1.0.0 feature. | DEFINITION-OF-DONE |
| **B18-7** | Gates are blocking: no `skip`/`continue-on-error` in release paths; CI runs the full 12-stage pipeline with zero skips. | ADR-015; RELEASE-CHECKLIST |
| **B18-8** | Platform parity is hard: identical features + results on Windows/macOS/Linux; CI runs all three with identical reports. | A11 |
| **B18-9** | Zero telemetry/analytics/phone-home (except user-initiated connector sync + update check). Local Diagnostics is user-triggered, sanitized, no financial values. | ADR-008 (A7) |
| **B19** | GL Dump is the guarantee: any ERP's GL export imports via Manual Import (mapping wizard). Connectors are convenience, never a prerequisite; Manual Import works with zero connectors. | ADR-007 (A3, A20) |
| **B20** | Scope discipline: 38 MVP features locked; V2 (20) + FUT (8) deferred by design, never half-shipped; new ideas go to the backlog, not into v1.0.0 (sweep closed 2026-08-30). | ADR-013 (A22) |

---

## ENFORCEMENT (CI map)

| Rules | Gate |
|---|---|
| B3, B18-2 | `npm run money:ast` + schema check (no REAL money columns) |
| B4, B14 | architecture lint / module-boundary tests |
| B5 | property + oracle suites, byte-hash export tests |
| B8, B9 | `docs:verify` (DOCS-INDEX, links, GLOSSARY, banned terms) |
| B11 | axe + keyboard E2E in CI |
| B12 | error-taxonomy completeness test (every API-referenced code defined) |
| B18-1 | audit chain tamper test |
| B18-3 | `scripts/mock-data-audit` |
| B18-7 | pipeline config check (no `continue-on-error` on release jobs) |
| B18-8 | triple-OS CI matrix |
| B18-9 | `scripts/telemetry-scan.mjs` |
| B15 | `scripts/pack-data-only.mjs` (no executable code in packs) |
| B20 | feature-count scan (38/20/8) |

## NAMESPACE NOTE (renamed 2026-08-30)

Before this file existed, QA-CHECKLIST.md §1 used B1–B8 for its per-feature base checklist, colliding with the product rules above. To end the collision (zero compromise), the QA items are now **Q1–Q8**:
Q1 5 screen states · Q2 error codes/userMessage/retry · Q3 money AST gate · Q4 accessibility · Q5 coverage targets · Q6 performance budget · Q7 audit event per mutation · Q8 docs synced.
All references to "B1–B8" in the QA sense must read Q1–Q8 (DEFINITION-OF-DONE, DOCS-INDEX row 24).

*Referenced by: DECISIONS.md ADRs, PRD, GLOSSARY, QA-CHECKLIST, DEFINITION-OF-DONE, RELEASE-CHECKLIST.*
