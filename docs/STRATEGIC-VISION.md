# OneFP&A — STRATEGIC VISION: THE ALL-IN-ONE, ZERO-COMPROMISE FP&A SUITE

> **Version:** v9-vision · **Date:** 2026-09-09 · **Status:** ACTIVE · **Branch:** arena/01a08593-fpa
> **Author:** Agent Mode (Arena) · **Purpose:** This document defines the absolute, non-negotiable strategic vision that guides every feature, document, and line of code in the OneFP&A project. It is the single source of truth for what "perfect" means.

---

## 1. THE NORTH STAR: WHY ANY FP&A ANALYST MUST REJECT EVERY OTHER TOOL

### 1.1 The core truth
Every FP&A professional today lives in a state of **tool fragmentation and trust deficit**:

- **Excel** is flexible but floats your numbers silently (`1 + 2 = 2.9999999999999996` at scale), has zero audit provenance, breaks links on copy, and offers no statement-level tie-out.
- **Cloud EPM platforms** (Anaplan, Workday Adaptive, Pigment, Board) charge per seat ($300–$1,200/user/year), require 3–18 month implementations, force data off the machine into vendor-controlled servers, and lock analysts out when the internet drops.
- **Excel-native add-ins** (Vena, Datarails, Cube) break on OS updates (macOS "busy" errors documented), still rely on Excel's float engine, and add another vendor layer without solving consolidation, audit, or statement generation.
- **BI tools** (Power BI, Tableau) visualize but do not model; they read data, they do not plan it.
- **ERP native modules** manage transactions, not forecasts; they are accounting systems, not FP&A systems.

### 1.2 Our declaration
**OneFP&A is designed to be the single, irreplaceable desktop application that handles the entire FP&A lifecycle — import, model, plan, analyze, report, govern — with such extreme perfection that using any other tool becomes an unacceptable professional risk.**

No analyst will reject this tool because:
- **It replaces Excel + BI + EPM + close management in one app** (38 MVP features, 42 screens, 56 DB tables, 103 typed commands, 99 error codes).
- **Every financial number is exact, audited, and provable** (`rust_decimal`, integer minor units, HMAC-SHA256 audit chain, `money:ast` gate, zero float money — B3/B6/B7/B14).
- **Every feature works fully offline; data never leaves the machine** (desktop native, AES-256-GCM encryption at rest, zero telemetry — B1/B2/B4/B18-9).
- **No per-seat billing; no cloud dependency; no implementation project** (self-serve First-Run Wizard < 10 min, 12 Industry Packs as data not code — B15).
- **All 3 OS (Windows/macOS/Linux) with identical behavior** (42 screens verified, native parity gated — B18-8).
- **Every mutation produces an immutable, verifiable audit event** (before/after, author, timestamp, HMAC chain — B7/B18-1).
- **Every screen has 5 canonical states, every error path uses a locked code with userMessage + retry flag, every feature is tested with real DB persistence** — no mock-only implementations, no placeholders, no deferred edge cases (B18-5/6).
- **Industry coverage is total: 12 launch packs covering manufacturing, SaaS, retail (4-5-4 NRF), healthcare, construction, professional services, nonprofit, government, energy, financial services, logistics, and real estate** — with unlimited user-defined packs via Pack Builder (B15, INDUSTRY-PACK-SPEC §10).

---

## 2. WHAT "ALL-IN-ONE" MEANS — THE SEVEN DOMAINS

The FP&A cycle is not a checklist. It is a continuous, interconnected loop. OneFP&A owns every stage:

| Domain | What "all-in-one" demands | Where it lives in the product |
|---|---|---|
| **D1 Foundation** | Multi-Company files, hierarchical COA with dimensions, non-standard fiscal calendars (4-5-4/4-4-5/52-53wk), first-run wizard that creates a working company in < 10 min. | F-001…F-006 · S-002 · S-020 · S-021 · S-022 · S-023 |
| **D2 Ingestion** | ANY ERP's GL Dump (XLSX/CSV/TSV/delimited); Excel/CSV driver data; 4 live connectors (QBO/Xero/NetSuite/Sage) + GL Dump as guaranteed path for every other ERP; mapping templates with version control; HARD/WARNING validation with per-row reports; trial balance tie-out gate; source vault with file compression + SHA-256. | F-007…F-011 · S-030 · S-031 · S-032 · S-034 · M2-1…M2-4 |
| **D3 Modeling** | Multi-sheet models; HyperFormula engine (Excel-compatible formulas + 8 custom Analysis Functions); named ranges; formula inspection (precedents/dependents/cycles); driver-based modeling (5–7 core drivers); assumption register (hardcoded value detection + conversion); 7 planning methods (manual/static/driver/growth%/YoY/seasonal/spread); period spreading; headcount/workforce planning; capital/debt/WC/13-week cash; production/backlog/revrec. | F-012…F-020 · S-040…S-048 · M3-1…M3-10 |
| **D4 Planning** | Budget/Forecast/Rolling forecast; scenario state machine (Draft→Review→Approved→Locked + Version freeze); model compare (2-way cell-level diff); what-if overlay/sensitivity/goal seek; planning cycle manager with milestone tracking and close checklist; input collection loop (structured export → contributor fill → audited re-import). | F-021…F-023 · S-050…S-053 · M4-1…M4-6 |
| **D5 Analysis** | Variance $/% (Actual vs Budget/Forecast/Commit); 3-way comparison; variance attribution (Volume/Price/Mix/FX/Efficiency); FVA (MAPE/bias/hit rate); alert engine (thresholds per KPI/line, in-app + OS opt-in, 90-day retention, dedupe/digest). | F-024…F-026 · S-054…S-056 · M5-1…M5-4 |
| **D6 Reporting & Consolidation** | Statement suite (P&L/BS/CF/SoCE/Segment); GAAP/IFRS presets; multi-entity consolidation (IC tie-out + FX + NCI + balance translation + OCI/CTA); report builder + KPI builder; dashboard + board pack; Excel/PDF/export model dump/data room; export formula-injection guard. | F-027…F-032 · S-060…S-064 · M6-1…M6-9 |
| **D7 Governance** | Audit trail (HMAC-SHA256 chain, every edit); health check (pre-save/pre-export gate: tie-outs, broken refs, rounding, missing drivers, anomalies); security at rest (AES-256-GCM, Argon2id PIN, recovery phrase, OS keychain); licensing (Ed25519 offline keys, 60-day grace); backup/restore; help/search/accessibility (WCAG 2.2 AA, keyboard-only, dark/light, multi-monitor, locale-aware). | F-033…F-038 · S-001 · S-003 · S-070…S-076 · M1-3…M1-4 · M1-7 · M6-7…M6-9 |

---

## 3. ZERO-COMPROMISE ARCHITECTURE (THE NON-NEGOTIABLES)

These rules (B1–B20 in ZERO-COMPROMISE-RULES.md) are not suggestions. They are the engineering and product contract that makes "no analyst can reject this" possible:

| Rule | What it prevents | Why an analyst cares |
|---|---|---|
| **B1** Desktop native only | No cloud dependency | Works on a plane, in a bunker, at a client's site with no Wi-Fi. |
| **B2** Local-first, single-user, offline-capable | No synchronous collaboration server | No vendor lock-in; no data breach surface; works without the vendor existing. |
| **B3** Exact decimal money (`rust_decimal`, integer minor units, no float) | Silent rounding errors that compound | The audit trail proves the number; Excel cannot make this claim. |
| **B4** One storage engine: SQLite (WAL) inside local directory | Fragmented data sources | All company data in one file; portable; backed up by the user's existing backup system. |
| **B5** Deterministic & reproducible | Random or platform-dependent results | The same model produces the exact same export bytes on Windows, macOS, Linux. |
| **B6** Rust core owns all financial computation; UI never computes money | Inconsistent results between screens | Every statement, consolidation, and variance uses the same engine. |
| **B7** Every mutation audited (HMAC-SHA256 chain) | Silent changes; no provenance | The auditor asks "who changed this?" — the answer is a cryptographic proof. |
| **B8** Docs = source of truth | Misinformation; orphaned features | Every claim in this document maps to a file, a screen, a command, a test. |
| **B9** One source of truth per global config | Drifting names/versions | Product identity is consistent across screens, docs, and code. |
| **B10** No TBDs/placeholders/weasel words | False promises | Every spec claims an exact value, exact state, exact error code — verified. |
| **B11** Accessibility is a gate, not a review step | Exclusion of analysts with disabilities | Keyboard-only operation; 200% zoom; reduced motion; color-independent signals. |
| **B12** Every error = typed code + userMessage + retry flag | Silent failures; raw errors in UI | Users know exactly what failed and whether retrying will help. |
| **B13** Technology budget ≤ 15 (12 shipped, 3 dev-only) | Technology bloat; maintenance risk | The codebase is lean; no orphaned dependencies. |
| **B14** One owner per concern, one implementation | Duplicate code; conflicting logic | One Money Core, one Calendar engine, one Formula engine. No second implementation. |
| **B15** Industry Packs = data, never code | Per-industry custom code | Any industry can be served by creating a new `.fpapack` file — no developer required. |
| **B16** Models stay simple: 5–7 core drivers advisory | Over-engineered, opaque models | Complexity is surfaced, not hidden; analysts understand every link. |
| **B17** AI: none in v1.0.0; v1.1 = on-device, explainable-only, opt-in | Unverifiable AI recommendations | Every insight in the future will cite the exact cell, driver, and formula. |
| **B18-1** HMAC-SHA256 audit chain; key in OS keychain | Tampered audit logs | A broken chain triggers read-only mode + restore path. |
| **B18-2** No float across IPC for money | Float corruption on wire | Every money value crosses the Rust/TypeScript boundary as integer minor units or decimal strings. |
| **B18-3** No mock/demo data in production paths | Fake data in real reports | The Demo Company is clearly marked and separate; fixtures live in `tests/fixtures/`. |
| **B18-4** Security designed in, verified in every release | Bolt-on security | Threat model, crypto parameters, secrets policy are documented and CI-tested. |
| **B18-5/6** All states & errors ship with the feature | Deferred error handling; missing states | No feature claims `DONE` without 5 screen states + every error path + audit event. |
| **B18-7** Gates are blocking; nothing skippable | Compromised releases | The `npm run check` pipeline runs 14 gates (lint, tsc, vitest, coverage, docs:verify, schema-equality, packs, money:ast, tokens, ipc:casing, command:parity, security) — zero skips permitted. |
| **B18-8** Platform parity is hard (Windows/macOS/Linux) | Different behavior per OS | Every native gate runs locally; CI targets all three OS. |
| **B18-9** Zero telemetry/analytics/phone-home | Privacy violations; data leaks | Only user-initiated connector sync and update check contact the network. |
| **B19** GL Dump = the guarantee; connectors = convenience | Dependency on specific ERP integrations | Any ERP's GL export imports via Manual Import with mapping wizard. No connector required. |
| **B20** Scope discipline: 38 MVP + 29 V2 + 6 FUT; nothing half-shipped | Feature creep; broken releases | Every new idea goes to the backlog, not into v1.0.0. |

---

## 4. THE COMPETITIVE REALITY: WHY NO ONE ELSE CAN MATCH THIS

Based on the live competitive analysis (docs/COMPETITIVE-ANALYSIS.md, verified against published review sources 2026-09-04):

| Competitor class | Their documented weakness | How OneFP&A eliminates the weakness permanently |
|---|---|---|
| **Cloud EPM (Anaplan, Adaptive, Pigment, Board, Planful, OneStream)** | Per-seat billing; 3–18 month implementations; data off-machine; no offline capability | Per-Company license; < 10 min self-serve setup; data never leaves; full offline capability |
| **Excel-native add-ins (Vena, Datarails, Cube)** | Break on OS updates; still use float engine; no true statement engine; performance degrades on large data | Native desktop app on all 3 OS; exact decimal engine; full statement suite; 2M GL line / 1M formula cell targets |
| **Excel itself** | Float rounding; broken links; zero audit provenance; no statement tie-out; no multi-entity consolidation | `rust_decimal`; HMAC audit; Health Check gate; full consolidation engine; 12 Industry Packs |
| **BI/Visualization (Power BI, Tableau)** | Read-only; no planning engine; no scenario modeling | Full planning, scenario, and reporting engine — visualization is included but subordinate to modeling |
| **ERP native planning** | Transaction-focused; not forecast-focused; no scenario/version management; no board reporting | Purpose-built for forecasting, budgeting, variance, and board-level reporting |

---

## 5. THE INDUSTRY COVERAGE: WHY "ALL INDUSTRY" IS REAL, NOT MARKETING

The 12 launch Industry Packs (INDUSTRY-PACK-SPEC.md §10) are not marketing slides. They are validated JSON data files that configure the exact COA, KPI definitions, driver templates, report layouts, GL templates, and calendar presets for:

1. **SaaS / Technology** — deferred revenue, ARR, NRR, CAC payback, burn multiple
2. **Manufacturing** — standard costing, production plan, capacity, WIP, inventory turns
3. **Retail / CPG** — 4-5-4 NRF calendar, markdown/shrink, footfall × conversion × AOV, same-store sales
4. **Healthcare** — payer mix, cost/patient, days AR, denial rate
5. **Construction / Engineering** — WIP accounts, contract %, backlog, over/under billing
6. **Professional Services** — utilization %, rate, pipeline, revenue/FTE
7. **Nonprofit** — fund/restricted, grants, donors, program ratio
8. **Government** — Oct–Sep calendar, fund/encumbrance, budget execution %
9. **Energy / Utilities** — regulated tariff, volume, weather impact, tariff recovery
10. **Financial Services / Insurance** — AUM, NIM, MLR, loss ratio
11. **Logistics** — cost/mile, fuel price, utilization, DSO
12. **Real Estate** — NOI, occupancy, rent roll, cap rate

Every pack includes:
- A schema-validated `pack.json` (key, name, version, description, logo_ref, default_calendar, default_currency_hint, locale_hint)
- A `coa_template.json` with account types mapped to GLOSSARY Account Type
- A `kpi_definitions.json` with formulas referencing engine line keys (not raw cells) so KPIs survive COA edits
- A `driver_templates.json` with 5–7 core drivers and closed-type bounds (volume_x_rate, headcount, growth, seasonal, spread, ratio, manual)
- `report_layouts.json` for P&L/segment layouts with period/YTD/variance/threeway columns
- A `gl_template.json` defining the canonical source column mapping
- Optional `group_rollup_maps.json` for consolidation

**The Pack Builder (F-005, S-023)** allows any user to create, edit, and publish custom packs (`.fpapack` zip files with checksum) without writing code. A user-built pack has `is_bundled=0`, is never pushed into the update channel, and is validated by the same loader rules as the 12 launch packs.

**Conglomerate rule (INDUSTRY-PACK-SPEC §10):** Each BU picks any pack/calendar/currency independently; group consolidation uses each BU's rollup maps (F-028, M6-3). There is no "group industry" — the group is a framework, not a sector.

---

## 6. WHAT "PERFECT" LOOKS LIKE AT EVERY STAGE

### 6.1 M0 — Spec & Fixtures (4 rows)
**Status:** M0-1/M0-3/M0-4 ✅ DONE; M0-2 🚧 PARTIAL (G4 native toolchain remains CI-bound).
**Perfection requirement:** Every fixture is deterministic (identical SHA256 across runs); every spec contradiction is resolved (0 open contradictions); the 5 build-readiness gates (G1 docs, G2 fixtures, G3 command parity, G4 toolchain, G5 contradictions) are fully green.

### 6.2 M1 — Foundation (10 rows)
**Status:** All 🚧 PARTIAL — code exists, native gates CI-bound; M1-1 native migration/test verified locally 2026-09-07; all others read-verified.
**Perfection requirement:** Rust scaffold (AppError, Money, Calendar, Migrations) runs `cargo test` + `clippy --all-targets -- -D warnings` + `fmt --check` clean; Tauri shell registers all commands with typed bridge; Security (PIN/recovery/AES-GCM/keychain) has full test coverage; License (Ed25519 + grace + S-073) has 5 fixture payloads + exact 60-day boundary tests; Company Manager includes archive + clone + sandbox; COA + Dimensions includes import/merge; Calendar includes NRf fixtures (all 5 presets); Wizard includes demo toggle + resume-safe draft + FY start picker; Pack loader fixes nested layout bug + description column; Settings/search has full persistence + root theme/density + grid density + HMAC audit.

### 6.3 M2 — Ingestion (10 rows)
**Status:** M2-1 through M2-5 🚧 PARTIAL; M2-6 through M2-9 ✅ DONE; M2-10 ❗ TODO.
**Perfection requirement:** The ingestion pipeline is a single, audited, transaction-isolated path: parse → normalize → map (versioned) → validate (HARD/WARNING) → preview (first 50 valid rows) → tie-out (exact integer minor units) → commit (authoritative transaction + exclusion audit) → history (persistent pagination + rollback). Every stage has a strict snake_case contract, a mock mirror, a Rust handler (or explicit design document for unbuilt commands), and a UI screen with 5 canonical states. Source Vault remains blocked on compressed payload schema + atomic resealing — this is documented, not fabricated.

### 6.4 M3 — Modeling (10 rows)
**Status:** M3-5 ✅ DONE; M3-6 ✅ DONE; M3-7 ✅ DONE; M3-8 ❗ TODO; M3-9 🚧 PARTIAL; M3-10 ✅ DONE; others 🚧 PARTIAL or ❗ TODO.
**Perfection requirement:** The HyperFormula engine evaluates all Excel-compatible functions plus 8 custom Analysis Functions (CAGR, MOVINGAVG, TREND, SEASONALITY, YOY, PRIORPERIOD, PRIORYEAR, RATIO) natively in the cell graph. Named ranges resolve assumption entries in formulas. Formula inspection traces precedents/dependents and detects cycles. Driver tables feed model formulas. Assumption register detects and converts hardcoded values. Planning methods (manual/static/driver/growth%/YoY/seasonal/spread) are visible and selectable per line. Period spreading validates weights to 1.00 ± 1e-6. Headcount planning computes exact Decimal day-count proration. Capital/debt schedules compute exact interest (Actual/360) with covenant gauges. The grid supports Excel-parity keyboard navigation, fill, paste, copy, undo/redo (≥250 levels), and 1M-cell virtualization.

### 6.5 M4 — Planning (6 rows)
**Status:** M4-1 🚧 PARTIAL; M4-2 ✅ DONE; M4-3 ❗ TODO; M4-4 ❗ TODO; M4-5 ❗ TODO; M4-6 ❗ TODO.
**Perfection requirement:** Budget/Forecast/Rolling forecast are labeled with hybrid period states (`ACTUAL`, `FORECAST`, `PLAN_ONLY`, `HYBRID`). Scenario versions freeze at `LOCKED` (immutable). Model compare produces exact cell-level deltas. What-if overlay, sensitivity tornado, and goal seek bisection solver operate with exact `Decimal` arithmetic and documented error variants. Planning cycles track milestones and close checklists with dependency enforcement.

### 6.6 M5 — Analysis (4 rows)
**Status:** M5-1 ❗ TODO; M5-2 ❗ TODO; M5-3 ❗ TODO; M5-4 🚧 PARTIAL.
**Perfection requirement:** Variance computes exact integer minor-unit deltas and Decimal percentages with account-nature-driven F/U evaluation. 3-way comparison works. Attribution breaks variance into Volume/Price/Mix/FX/Efficiency with sum-of-parts equality. FVA scores every forecast version (MAPE, bias, hit rate) with version-count thresholds. Alerts evaluate rules once per day with 90-day retention and exact-decimal threshold comparisons.

### 6.7 M6 — Reporting & Governance (9 rows)
**Status:** M6-1 🚧 PARTIAL; M6-2 ❗ TODO; M6-3 ❗ TODO; M6-4 ❗ TODO; M6-5 🚧 PARTIAL; M6-6 ❗ TODO; M6-7 🚧 PARTIAL; M6-8 🚧 PARTIAL; M6-9 🚧 PARTIAL.
**Perfection requirement:** Statement suite produces P&L, BS, CF (indirect), SoCE, and Segment reports with tie-out integrity. GAAP/IFRS presets are selectable. Multi-entity consolidation supports IC tie-out, FX rates, NCI, balance translation, and group rollups. Report and KPI builders produce versioned layouts. Dashboard and board pack generate fixed-layout statements with commentary and export. Export suite produces `.xlsx` (with formula injection guard), `.pdf` (deterministic, 3-OS identical), model dump, and data room. Health check is a blocking pre-save/pre-export gate with explicit fix list and waiver reason tracking. Audit trail is a verifiable HMAC chain with filterable payload expansion.

### 6.8 M7 — Release (8 rows)
**Status:** M7-1 ❗ TODO; M7-2 ❗ TODO; M7-3 ⏸️ BLOCKED; M7-4 🚧 PARTIAL; M7-5 ⏸️ BLOCKED; M7-6 🚧 PARTIAL; M7-7 ❗ TODO; M7-8 ❗ TODO.
**Perfection requirement:** The 12-stage CI pipeline runs on 3 OS with zero skips. Signing/notarization uses Ed25519 keys with verified manifest. Performance benchmarks measure startup (<5s), recalc (<50ms per cell, <2s full model), import (<5s for 100k GL rows), consolidation (<10s for 50 BU), and export (<5s). A11y full sweep achieves axe 0 + keyboard-only operation across all 42 screens. E2E covers all 14 user flows on all 3 OS. Release candidate passes every gate before v1.0.0 tag.

---

## 7. THE VISION IN ONE SENTENCE

> **OneFP&A is the desktop-native, local-first, exact-decimal, fully-audited, all-industry FP&A suite that makes every cloud EPM obsolete, makes every Excel workbook untrustworthy, and makes every analyst's job defensible — because every number has a proof, every change has a chain, and every industry has a pack.**

---

## 8. HOW TO USE THIS DOCUMENT

1. **Every feature proposal must answer:** "Does this make any analyst reject any other tool?" If no, it is a V2 or FUTURE idea (B20). If yes, it is an M1–M7 milestone.
2. **Every spec edit must reference:** This vision + ZERO-COMPROMISE-RULES.md + the specific milestone table in TASKBOARD.md.
3. **Every `DONE` claim requires evidence:** A command output (`npm run check`, `cargo test`, `npm audit`, `npm run docs:verify`, `npm run packs:validate`, `npm run money:ast`, `npm run build`) — not a code review comment, not a chat statement.
4. **Every gap must be named honestly:** If a feature is partial, the exact missing gate (native compile, E2E, 500k benchmark, 3-OS CI, signing, toolchain restoration) must be listed — never hidden.

---

*Referenced by: README.md, PRD.md, TASKBOARD.md, COMPETITIVE-ANALYSIS.md, ZERO-COMPROMISE-RULES.md, DEFINITION-OF-DONE.md, RELEASE-CHECKLIST.md, Q&A-CHECKLIST.md.*
