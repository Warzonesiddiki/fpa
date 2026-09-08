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

### ADR-013 · Scope discipline: 38 MVP features, V2=29, FUT=6 (B6/B20)
**Why:** reference's 202 engines + no cut list produced UNACCEPTABLE audits; we enumerate + decide at the boundary and stop.
**Consequences:** NOT BUILDING section is binding; new ideas → V2 backlog; sweep closed (2026-08-30). **v9 revision (2026-08-31):** V2 grew 20→29 and FUT shrank 8→6 as the scrapped FinPlan Pro FP&A-adjacent domains were promoted to the documented backlog (lease, tax provision, ESG, treasury/banking, insurance/financial-instruments, advanced close, data governance, report scheduling, plugin marketplace); the 38-MVP set is unchanged.

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

### ADR-023 · S-050 ships without a "Created" column until `scenarios.created_at` exists (M4-2 PR B)
**Why:** SCREENS-SPEC S-050's table lists Created, but DATABASE-SCHEMA's `scenarios` table has no
`created_at` column (id, model_id, name, kind, state, parent_scenario_id, baseline), and no migration is
in this PR. Shipping a fake timestamp (e.g. mocking or reusing `version.created_at`) would break the
money-grade "never fabricate data" rule and the docs-are-source-of-truth rule (DATABASE-SCHEMA is
authoritative). 
**Consequences:** the S-050 page renders name/kind/state/base/versions only; the column stays documented
in SCREENS-SPEC as spec intent. Land it in one Tier-3 migration change: schema `ALTER` + typed row field
+ column render + date-locale tests together (the inline page comment points here).

### ADR-024 · One shared scenario read side for S-050 and the S-041/S-040 switcher (M4-2 PR B)
**Why:** S-050 (Scenario Manager) and the Scenario switcher in the model-grid toolbar show the same
lifecycle data; keeping two stores or two fetch paths would let the toolbar badge and the manager table
disagree about state (e.g. Draft vs Locked) after a transition.
**Consequences:** both read `useScenarioStore` populated from `model.list` (Model shape
`{id, company_id, name, horizon, pack_id, scenarios[]}`); the picker is a controlled widget whose active
id comes from the grid store (`scenarioId`) and whose change calls `setScenario()` (rebuilds the
HyperFormula worker through the audited path). `/app/plan` redirects to `/app/plan/scenarios` so the
Planning-area navigation has one stable entry (S-051+ land as siblings later).

### ADR-025 · Locked-scenario edit error is the catalog code `MODEL_CELL_LOCKED` (canonicalization, M4-2 PR B)
**Why:** narrative docs (AUTH-SPEC, USER-FLOWS, USER-STORIES, an S-041 error list) said `SCENARIO_LOCKED`,
but the locked error catalog (ERROR-HANDLING) defines `MODEL_CELL_LOCKED`, and the M4-2 PR A mock already
emits it table-driven from the scenario state. Two spellings for one user-facing condition would leak into
copy/tests and break the 97-code lock.
**Consequences:** all four doc references rewritten to `MODEL_CELL_LOCKED`; editing a Locked Scenario stays
possible as an *attempt* so the typed error (with its message) surfaces instead of a silent bypass; S-050
lifecycle errors keep their own codes (`SCENARIO_NAME_DUP`, `SCENARIO_LOCK_CONFLICT`,
`BASELINE_REPLACE_REASON_REQUIRED`).

### ADR-026 · Admit the two S-045 headcount validation codes to the canonical taxonomy (M3-6)
**Why:** the headcount contract needs stable, actionable distinctions between an invalid date window
and a same-role overlap. Reusing `VALUE_INVALID` would erase row/period details and contradict the
screen/story/API requirement for typed errors. These are real domain errors, not implementation-only
strings.
**Decision:** add `HC_DATE_INVALID` and `HC_OVERLAP` to ERROR-HANDLING.md, bringing the locked catalog
to 99 codes. Both are 422/non-retryable and preserve safe row/period details; their exact user text is
mirrored by the TS model, mock, S-045 page, API-SPEC, and tests.
**Consequences:** native schedule work must map these codes in its handler before M3-6 can become DONE.
The current TS slice remains `PARTIAL`/`NATIVE-UNVERIFIED`: its browser mock is still in the product
path and no native SQLite persistence or cargo verification is claimed.

### ADR-027 · Classify the 17 undefined code citations as prefixes, reserved names, or one wrong name — do not grow the catalog
**Why:** reviving the dead `docs:verify` code guard (KI-015) made every cited name checkable for the first time, and
17 had no §2 row. The obvious move — admit them all, 99 → 116 — was tested against the binary and is **wrong**: seven
of them are never sent on the wire. `import.rs` files row findings as `RowIssue { code, message }` where `code` is an
existing catalog code and `message` begins with a sub-reason prefix (`"CURRENCY_UNKNOWN: USD (MONEY-ROUNDING-SPEC §1)"`);
the Rust tests assert those prefixes verbatim, so they are contract, but they are not codes. One name
(`INVALID_ARGUMENT`) is a leaked Rust variant name whose wire code is `VALUE_INVALID` per `core/error.rs:168`. Nine are
forward references to capability no build session has written yet. Inventing 16 rows would have made the catalog the
least trustworthy document in the suite, and the API would have promised codes no client can receive.
**Decision:** keep the catalog at **99**. Document the prefix convention in `ERROR-HANDLING.md` **§2B** (each prefix
bound to its governing §2 code), park the nine unbuilt names in **§2C** as reserved-with-no-copy, correct
`API-SPEC.md` to cite `VALUE_INVALID`, and make §2B the *only* exemption source for `docs:verify` 7b — deleting the
hand-maintained baseline, so changing what the gate accepts requires changing a spec, and a malformed §2B row fails
the run rather than silently loosening it.
**Consequences:** `docs:verify` 7b now has zero hardcoded exemptions and a mutation self-test, and its pass/fail
signal is meaningful again. Prefix renames are breaking changes to the Rust test suite, which §2B now states. The nine
reserved names must be admitted with `userMessage`/`httpStatus`/`Retry` **as part of the owning feature's Definition of
Done** — they cannot ship as a bare `Error:` line on a screen. The `ACCOUNT_MISSING` branch's copy defect is a real
user-facing bug and moves to KI-018; it needs Rust + mock + test in one PR, so it is not folded into a docs revision.

### ADR-028 · Remove the unsigned auto-updater — no update path ships without signature verification (WS-09)
**Why:** `tauri.conf.json` configured the updater plugin with a GitHub releases endpoint but an **empty `pubkey`**.
A Tauri updater without a public key cannot verify update signatures: any file served at the endpoint (or pushed to it)
would be accepted and installed. For a local-first, "data never leaves your machine" financial app this is an
unacceptable hole (B1, SECURITY-CHECKLIST). The UI never invoked the updater (`update.check` has no handler; S-075
shows a "native gate pending" note), so the plugin compiled in was pure attack surface with zero user value.
**Decision:** remove the updater entirely rather than ship it unverifiable — delete the `plugins.updater` block,
the `tauri-plugin-updater` crate + registration, the `updater:default` capability, and its lockfile entries. Updates
are manual (download installer from Releases) until a signed updater ships. Re-enabling requires: a real Ed25519
keypair (`tauri signer generate`), `pubkey` in config, the private key in release CI secrets only, and a
signature-verified manifest — as one change, never an intermediate empty-pubkey state.
**Consequences:** S-075's update-channel preference remains stored but inert (honest copy says so). F-036 (update
UX) stays TODO with M7-2 signing. `cargo` dependency tree shrinks (reqwest/rustls/tar etc. leave the updater's
subtree). The B18-9 offline promise is unaffected — no telemetry, no phone-home; there never was an update check
call. Security posture: no unsigned update path can ship by default again.

### ADR-029 · `model.inspect` is served by the HyperFormula engine, not a Rust handler (WS-05)
**Why:** D1 ordered all three mock-only commands implemented as native Rust handlers. That premise predates the M3-1/M3-2
landing of the model engine: the cell graph — precedents, dependents, cycle paths — is owned by the HyperFormula engine in
the webview Worker (ARCHITECTURE "Worker split"; S-042 already inspects through it). Faithful precedent extraction is
*impossible* from persisted formula text alone: `INDIRECT`, `OFFSET` and named ranges resolve only inside the evaluating
engine, so a Rust text-parser over `model_values` would be a second, guaranteed-divergent graph — exactly what B14 (one
owner per concern) and WS-05's own "do not build a second graph" note forbid.
**Decision:** the bridge gains an in-process engine-command registry (`registerEngineCommand`; routing order in `call`:
Zod arg gate → engine handler → Tauri IPC → dev mock). `src/stores/model.ts` — the engine singleton's composition root —
registers `model.inspect` to the shared client's `inspectCell`, returning exactly the catalogued 9-field shape. The
command keeps its Zod schema, API-SPEC row, and dev-mock case (fallback when no engine is registered). No Rust handler
is written; the Rust core stays the owner of everything persisted.
**Consequences:** `model.inspect` now answers identically in the dev preview and the desktop shell, from the same graph
S-042 shows — zero drift by construction. The command is an in-process read of session-gated data (the grid reached the
engine only through `require_unlocked`-gated loads), so it performs no separate session check; API-SPEC marks it
engine-served. `CommandArgs`/mock parity tests are untouched. D1's remaining half — `company.archive_year` (WS-07) —
stays a genuine Rust handler: company lifecycle is Rust-owned, no graph involved.

### ADR-030 · The Tauri wire contract is snake_case — every command declares it; a gate enforces it
**Why:** the 2026-09-07 continuation audit found 21 of 84 `#[tauri::command]`s annotated `rename_all = "camelCase"`
(the M1-era modules: session, company, coa, calendar, pack, security, settings, license, backup), while the entire
frontend wire contract is strict snake_case (API-SPEC §2 rows, Zod `CommandArgs`, every `call()` site). Tauri 2
expects camelCase invoke keys under that annotation, so `invoke("session.unlock", {company_id})` deserializes nothing —
15 commands with multi-word args were dead in the real desktop shell, including `session.unlock`, `company.create`,
`calendar.preview`, `coa.list`, and `company.delete`. Nothing caught it: the mock answers the dev preview, E2E runs on
the dev server (WS-08), and CI compiles Rust but never crosses the invoke boundary.
**Decision:** normalize all commands to `rename_all = "snake_case"` (attribute-only change; the 61 newest commands —
`driver.import`, `model.cell.set.v1`, `assumption.waive`, … — already used it because that is what actually works), make
the two zero-arg session commands explicit, and add `scripts/ipc-casing-check.mjs` to `npm run check` + CI: every
`#[tauri::command]` in `src-tauri/src` must declare `rename_all = "snake_case"`.
**Consequences:** single-word commands are unaffected by casing; multi-word commands now deserialize their arguments
in the real shell. The gate makes the convention machine-checked, so a camelCase annotation can never land again.
Known residual gap (recorded, not fixed here): no test executes the real invoke boundary end-to-end — tauri-driver
E2E in release CI remains the durable closure (CI-CD §6.2).

## 3. SUPERSEDED DECISIONS (for the record)

| Superseded by | Note |
|---|---|
| v1 MVP=10 → v3 all-in-one (17) → v6 (29) → v8 (38 locked) | User mandate "most advanced all-in-one"; sweep closed at 38 w/ B20 |
| Single entity only (initial) → multi-BU groups | Conglomerate/client requirement (user, 2026-08-30) |
| Sector packs cut → config-driven Industry Packs (12) | "Useful for all industries" — solved by data, not code |
| Reference stack (TS-only + server + dual storage) → hybrid | Reference audit W1–W8 |

*Referenced by: DOCS-INDEX.md, ROADMAP.md, DEFINITION-OF-DONE.md.*
