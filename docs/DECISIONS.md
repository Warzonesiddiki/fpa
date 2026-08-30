# DECISIONS.md

> OneFP&A · v1.0.0 · **Every assumption (Stage 0.9) + every architectural decision with reasoning.** New decisions: add ADR-###. Contradictions: reference stage; resolution is THIS file.

---

## 1. ASSUMPTIONS LOG (locked Stage 0, superseding v1/v2/v3 iterations)

| # | Assumption | Status |
|---|---|---|
| A1 | Primary users: FP&A analysts, finance managers, CFOs of SMB/mid-market ($5M–$500M) + diversified groups + startups + regulated/sovereignty buyers | Locked |
| A2 | UI English v1.0.0; locale-aware formats; full i18n V-011 (v1.1) | Locked |
| A3 | Excel/CSV + GL Dump is the dominant data path; connectors are convenience, GL Dump is the guarantee (B19) | Locked |
| A4 | "No other tool" = complete FP&A cycle in-app; NOT accounting system of record | Locked |
| A5 | Monetization: self-host/enterprise; offline Ed25519 license (F-035); no billing system in-app | Locked |
| A6 | App is fully offline-capable; cloud sync is FUT-002 (only if strategy changes) | Locked |
| A7 | Financial data sensitive: AES-256-GCM at rest, zero telemetry (B18-9) | Locked |
| A8 | Structure: COA + dimensions + periods + scenarios; statements derived from Account Type/Report Section | Locked |
| A9 | Multi-currency + multi-entity consolidation in v1.0.0 (Stage 0 v5 upgrade); one active entity requirement removed — BUs are first-class | Locked |
| A10 | Fiscal years non-calendar + retail calendar family (4-5-4 etc.) are first-class (F-003) | Locked |
| A11 | Platform parity is a hard requirement: identical feature set + results on Win/macOS/Linux (B18-8) | Locked |
| A12 | Excel export + import bidirectional; PDF deterministic | Locked |
| A13 | No AI in v1.0.0; on-device explainable AI in v1.1 (V-001, B17) | Locked |
| A14 | Model = fiscal-year-sheet layout: Sheets → Lines → Values (scenario × period) | Locked |
| A15 | "Most advanced" = depth + correctness (audit-grade, consolidation, formulas), NOT unrelated domains (banking/ESG/lease cut) | Locked |
| A16 | v1.0.0 may build longer; correctness gates are not skippable | Locked |
| A17 | AI never a data dependency; on-device, opt-in (B17) | Locked |
| A18 | Healthcare/regulated packs contain NO PHI/PII — financial metadata only | Locked |
| A19 | Single user, one machine, multiple Company Files (multi-user = V-015 v1.1) | Locked |
| A20 | Most real clients use GL Dumps from non-connector ERPs (Tally, SAP on-prem, Oracle EBS, Zoho, MYOB…) — primary path (B19) | Locked |
| A21 | "All industries" = industry-agnostic engine + data-driven Industry Packs (B15), not per-industry code; conglomerates = BU-level packs + group consolidation | Locked |
| A22 | Zero-compromise = every v1.0.0 feature ships complete; v1.1 items deferred by design, never half-built (B20; sweep closed 2026-08-30) | Locked |

## 2. ARCHITECTURAL DECISIONS (ADR-style)

### ADR-001 · Desktop-only, local-first (B1) — REF: Stage 0 Q1/Q2 answers
**Decision:** Tauri 2 native app, no server, no PWA, no web runtime in product.
**Why:** user requirement (works offline, 3 OS, no per-seat cloud); reference project's web+server+PWA+desktop hybrid (W4) was its core contradiction; data sovereignty buyers require local.
**Consequences:** no accounts/roles (AUTH-SPEC local), Input Collection Loop instead of multi-user (F-023), offline license (F-035).

### ADR-002 · Hybrid Rust + TypeScript, 15 technologies (B13/B14)
**Decision:** Rust owns money/calendar/engines/ingestion/connectors/export/crypto/DB; TS owns UI/format/worker calc; HyperFormula for Excel-parity formulas; tauri-specta for typed IPC.
**Why:** best of each; the reference's TS-everything + float money was its #1 defect (W2); Excel semantics can't be cost-effectively reimplemented in Rust (R3).
**Consequences:** money crosses IPC as i64/string (I1); decimal.js display-only; no per-industry code.

### ADR-003 · Money core: integer minor units + rust_decimal (I1)
**Why:** audit-grade exactness; `REAL`/float corrupts cents at scale (reference issue #0001 found 134 float sites).
**Consequences:** AST gate (`money:ast`); model values `amount_minor INTEGER`; all arithmetic in Rust.

### ADR-004 · One Fiscal Calendar engine (B14/I5)
**Why:** reference had 4 competing calendar implementations (W3) + F-0010 flagged 4-4-5/leap-year as casual. Calendar correctness is a product requirement (retail 4-5-4, 52-53, mixed-BU groups).
**Consequences:** `core/calendar.rs` only; oracle fixtures vs published NRF calendars; transit mapping.

### ADR-005 · SQLite WAL single store; no browser IndexedDB (B4)
**Why:** reference had 3 persistence layers (W4); one source of truth; encrypted at rest; portable Company File.
**Consequences:** Rust-only DB access; migrations versioned; backup/restore native.

### ADR-006 · Industry Packs as data, never code (B15)
**Why:** reference's 202 engines + 30 sector packs = scope explosion + doc theater (W1/W6); "all industries" is achievable with config (12 packs + builder).
**Consequences:** pack schema validated; no sector pages/engines ever; new pack = data PR.

### ADR-007 · GL-Dump-first ingestion, connectors as convenience (B19)
**Why:** majority of clients' ERPs are not connector-covered; F-01 (all-in-one) failed in reference because ingestion wasn't first-class.
**Consequences:** one pipeline (parse→map→validate→tie-out→commit); Source Vault + Reconciliation; connectors produce the same Import Batch.

### ADR-008 · No telemetry, no analytics (B18-9)
**Why:** trust + regulated buyers; reference sent Sentry optionally (we reject by default).
**Consequences:** MONITORING is local + release-infra only; Local Diagnostics sanitized; any future metrics require ADR + explicit opt-in.

### ADR-009 · Excel-compatible formulas via HyperFormula in worker (R3)
**Why:** Excel parity is the #1 user need; rebuilding in Rust = years (rejected); worker keeps 1M-cell UX.
**Consequences:** supported-function whitelist documented; `#CYCLE!` never silent; recalculation incremental.

### ADR-010 · Statements computed by Rust engines, not stored (B14)
**Why:** single source of truth; tie-outs + rounding rules enforced at compute; no denormalized drift.
**Consequences:** `statement.get.v1` computes on demand; Health Check gates exports; rounding largest-remainder (F-027).

### ADR-011 · Audit chain HMAC-SHA256, key in keyring (B18-1)
**Why:** tamper-evidence; reference left unkeyed SHA-256 (documented red item).
**Consequences:** chain verified on unlock; `AUDIT_CHAIN_BREAK` → read-only + restore; Data-Room export.

### ADR-012 · Offline Ed25519 license activation (F-035)
**Why:** self-host/enterprise chosen; no cloud dependency; reference had none (W7).
**Consequences:** machine-bound optional; grace 60d; activation file exchange.

### ADR-013 · Scope discipline: 38 MVP features, V2=20, FUT=8 (B6/B20)
**Why:** reference's 202 engines + no cut list produced UNACCEPTABLE audits; we enumerate + decide at the boundary and stop.
**Consequences:** NOT BUILDING section is binding; new ideas → V2 backlog; sweep closed (2026-08-30).

### ADR-014 · Exports: rust_xlsxwriter + typst (not exceljs/jsPDF)
**Why:** deterministic, injection-safe, identical on 3 OS; reference used jsPDF (browser-dependent).
**Consequences:** PDF hash equality CI gate; `EXPORT_FORMULA_INJECTION_GUARD`.

### ADR-015 · QA gates blocking, no skips (B18-7)
**Why:** reference CI had timeouts, `continue-on-error`, and skipped a11y gates (W8/reference issues #0002/03).
**Consequences:** 12-stage CI; no `retry:3` masking; coverage waivers capped (2/release, audited).

### ADR-016 · Persona-first UX: 3 personas drive states/flows (P1)
**Why:** Ravi/Priya/Alex cover SMB, conglomerate, startup — every screen must serve one; prevents "for admins only" drift.
**Consequences:** persona matrix in USER-PERSONAS; stories tagged.

### ADR-017 · Full Excel formula engine is MVP (Q7)
**Why:** "as powerful as possible" (user), the #1 Excel-replacement need; reference left formulas hand-rolled (W2).
**Consequences:** HyperFormula core MVP; Analysis Functions declared; UDFs V2.

### ADR-018 · Four ERP connectors in v1.0.0 + GL Dump everywhere (Q4)
**Why:** user explicitly required all 4 + manual; B19 guarantees no client is locked out.
**Consequences:** adapter contract + keychain + rate limit policy; connector scope tables documented.

### ADR-019 · Working name "OneFP&A" (B9)
**Why:** decisions need a name; all brand strings centralized in one config; rename before launch is a config change (no code).
**Consequences:** `com.onefpa.desktop` bundle id; pack namespace `onefpa.packs.*`.

### ADR-020 · No server means AUTH-SPEC adapted (template deviation, flag in Phase 3)
**Why:** local-first single-user; template assumed web auth (register/login/reset/verify).
**Consequences:** PIN/unlock/recovery/license flows; permission matrix is object-level (Scenario State, instance, license).

### ADR-021 · Portability: Company File is self-contained (packs embedded by version)
**Why:** open `.fpa` on any OS/machine; no "missing pack" dead ends.
**Consequences:** pack version pinned in Company; pack update = diff prompt (F-005).

### ADR-022 · Performance budgets numeric + bench-gated (PERFORMANCE-REQUIREMENTS)
**Why:** reference's perf claims were uncountable audits (W2); "most advanced" must be measurable.
**Consequences:** vitest/cargo bench in CI; regression >10% blocks.

## 3. SUPERSEDED DECISIONS (for the record)

| Superseded by | Note |
|---|---|
| v1 MVP=10 → v3 all-in-one (17) → v6 (29) → v8 (38 locked) | User mandate "most advanced all-in-one"; sweep closed at 38 w/ B20 |
| Single entity only (initial) → multi-BU groups | Conglomerate/client requirement (user, 2026-08-30) |
| Sector packs cut → config-driven Industry Packs (12) | "Useful for all industries" — solved by data, not code |
| Reference stack (TS-only + server + dual storage) → hybrid | Reference audit W1–W8 |

*Referenced by: DOCS-INDEX.md, ROADMAP.md, DEFINITION-OF-DONE.md.*
