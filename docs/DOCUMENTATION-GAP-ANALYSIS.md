# DOCUMENTATION-GAP-ANALYSIS.md

> OneFP&A · 2026-09-04, revised 2026-09-05 · **Audit of this suite against the 101-item pre-build documentation checklist, with the remaining
> gaps registered by owner.** Reviewing this file replaces re-running the audit in chat. Statuses:
> ✅ complete · 🟡 partial (covered, thinner or relocated than the checklist asks) · ❌ applicable and absent · ➖ not applicable by design.

---

## 1. HEADLINE (101 checklist items)

| Phase | Items | Before | After | Still open in this phase |
|---|---|---|---|---|
| 0 Discovery | 1–7 | ✅1 🟡5 ❌1 | **✅3 🟡4** | #2 vision narrative, #3 primary-persona flag, #6 risk severity/mitigation, #7 product KPIs |
| 1 Definition | 8–17 | ✅9 ❌1 | ✅9 ❌1 | #12 journey maps (deferred by choice) |
| 2 UX & Design | 18–27 | ✅6 🟡1 ❌3 | **✅7 🟡2 ❌1** | #21 hi-fi prototype, #19 flow diagrams (§3 row 19) |
| 3 Architecture | 28–49 | ✅12 🟡7 ❌1 ➖2 | ✅12 🟡7 ❌1 ➖2 | #46 capacity plan; partials are desktop-app N/A-adjacent |
| 4 Security/Privacy | 50–55 | ✅4 🟡2 | ✅4 🟡2 | #53 user-facing policy text, #52 formal classification tiers |
| 5 Standards | 56–65 | ✅7 🟡3 | **✅9 🟡1** | #64 recipe breadth (multi-runtime recipes) |
| 6 Testing | 66–73 | ✅6 🟡2 | ✅6 🟡2 | #68 E2E implementation (specs are complete) |
| 7 DevOps | 74–83 | ✅6 🟡2 ❌1 ➖1 | ✅6 🟡2 ❌1 ➖1 | #82 cost model; #76 CI execution is env-bound |
| 8 Execution | 84–89 | ✅4 🟡1 ❌1 | **✅5 🟡1** | #88 change-process formality |
| 9 Business/Legal | 90–98 | 🟡4 ❌4 ➖1 | **🟡5 ❌3 ➖1** | #91 ToS, #92 privacy policy, #96 launch · #90 mechanism specified, numbers await ratification |
| 10 Living | 99–101 | ✅3 | ✅3 | — |
| **Total** | **101** | **✅58 🟡27 ❌12 ➖4** | **✅64 🟡26 ❌7 ➖4** | |

**Verdict (2026-09-05):** the technical spine is complete and machine-enforced (`docs:verify`, `docs-link-check --strict`,
`money:ast`, `schema-equality-check`, `telemetry-scan`). Four gaps were closed on 2026-09-04; the remaining ❌ are
(a) legal/GTM text that only a human/attorney can author, (b) #12 journey maps and #21 hi-fi prototype (deferred by
choice, with triggers), and (c) #82 cost model, due at M7. **Nothing currently blocks an AI build session.** Highest
residual risk is no longer documentation at all: it is **KI-017** (`money:ast` is red at `HEAD` on four percent/ratio sites while `TASKBOARD.md` records it green) and **KI-016's**
lesson that a plausible-looking "fix" — admitting 7 message prefixes as catalog codes — would have corrupted the taxonomy. Both are now answered: the review checklist carries the
anti-hallucination step (`CODING-STANDARDS.md` §7.8) and the gate that enforces the code half has zero hardcoded exemptions.
---

## 2. CLOSED BY THE 2026-09-04 / 05 REVISIONS

| Checklist item | Was | Now | Doc |
|---|---|---|---|
| #4 Competitive Analysis | no feature matrix, no pricing, no weakness table | 9-vendor matrix, Year-1 price/implementation table, per-vendor weaknesses with the counter, our own listed weaknesses | `COMPETITIVE-ANALYSIS.md` §1–§4 |
| #5 Market & Positioning | one pitch line + differentiation | positioning statement, category name, wedge, objection→answer table, anti-positioning | `COMPETITIVE-ANALYSIS.md` §5 |
| #20 Low-fi wireframes | 42 screens described in prose with **zero** geometry | layout grammar + region tokens + rules R1–R8, per-screen region contracts for all 42 screens + 10 dialogs, breakpoint behaviour, reviewer checklist | `WIREFRAMES-CORE.md`, `WIREFRAMES-ANALYTICS.md` |
| #24 Copy / microcopy | error codes only (ERROR-HANDLING); no tone, no UI strings | voice rules, mechanics table, per-slot copy formulas, locked verb/noun lexicon, dialog+notification copy, 33-key seed registry, copy review gate | `COPY-GUIDELINES.md` |
| #57 AI rules file | `docs/CLAUDE.md` existed but nothing at repo root; `.codex/AGENTS.md` pointed at a missing root file | root `CLAUDE.md` + `AGENTS.md` router files (pointer-only, no duplicated rules — B9) | `CLAUDE.md`, `AGENTS.md` |
| #87 Open questions / parking lot | no such register (findings were buried in SCREENS-SPEC availability notes) | registered below with owner + revisit trigger (§4) | this file §4 |
| #101 Docs index | 54 rows | 61 rows: 60 docs/specs + the root README pointer | `DOCS-INDEX.md` |
| #90 Pricing & entitlements | `licenses.plan` CHECKed `pro`/`enterprise` with nothing defining either | verified ground truth (enforced nowhere), the constraints an offline policy inherits, one sanctioned seam, axis sheet, **proposed** pricing, D1–D5 for the owner, interim rule that no code may branch on `plan` | `PRICING-AND-ENTITLEMENTS.md` |
| #61 Review checklist: anti-hallucination guards | no such step; the machine backstop that was supposed to cover it was unreachable | `CODING-STANDARDS.md` §7.8 (prove every dependency, symbol, command, code, table, column and key exists; widening a gate to admit a hallucination is a B8 violation) + a live `docs:verify` 7b with zero hardcoded exemptions and a mutation self-test | `CODING-STANDARDS.md` §7.8, `ERROR-HANDLING.md` §2B/§2C |

---

## 3. REMAINING GAPS — REGISTERED, NOT IGNORED

Each entry states what is missing, whether it blocks a build session, and the trigger that makes it due.

| # | Item | Status | Blocks AI coding? | Disposition & trigger |
|---|---|---|---|---|
| 12 | Journey maps (emotion/pain/opportunity layer) | ❌ | No | Deliberately deferred. Trigger: after first 10 external user sessions; feed results into `USER-FLOWS.md` failure branches. Owner: product |
| 21 | Hi-fi mockups / clickable prototype | ❌ | Partially (visual detail beyond DESIGN-SYSTEM) | Desktop-token-driven build; DESIGN-SYSTEM + WIREFRAMES + COMPONENT-LIBRARY are the contract the AI implements. Trigger: any screen where two implementations plausibly differ — draw that one, then index it |
| 46 | Scalability / capacity plan | ❌ | No (v1 envelopes exist) | Envelopes are enforced by `PERFORMANCE-REQUIREMENTS.md` (2M GL rows/Company, 1M-cell Model) and `DATABASE-SCHEMA.md` §gl_lines. Trigger: first Company File breaching an envelope in the field → new ADR + doc |
| 82 | Cost model & budget | ❌ | No | No cloud bill exists (no server). Real costs are signing/notarization/CI minutes. Trigger: M7 (release milestone) owner writes `COST-MODEL.md` before paid CI runners are enabled |
| 90 | Business model & pricing | 🟡 | Narrowly | **Written 2026-09-05:** `PRICING-AND-ENTITLEMENTS.md` records the verified ground truth (both plans feature-identical, nothing may branch on `plan`), the constraints any policy inherits (offline re-licensing, advisory local gate, governance floor), the sanctioned seam, an axis sheet and a *proposed* price table. Open: owner ratification of the numbers and the deny-path code — D1–D5 in that file |
| 91 | Terms of Service | ❌ | No | Legal text, not a build input. Owner: human/legal, due before first commercial invoice |
| 92 | Privacy policy (user-facing) | ❌ | No | The factual basis is fully written (`COMPLIANCE-DATA-SOVEREIGNTY.md`, ADR-008 no telemetry, at-rest AES-256-GCM). Policy text is a legal drafting task from that doc; due with enterprise procurement pack |
| 96 | Launch plan / GTM | ❌ | No | `RELEASE-CHECKLIST.md` covers shipping; go-to-market is outside repo scope. Trigger: rc1 |
| 95 | Brand guidelines | 🟡 | Minor | Design tokens exist; product name is still a **working name** (ADR-019, B9 centralises brand strings in one config). Trigger: naming decision recorded as an ADR, then `BRAND.md` |
| 6 | Risk register (severity/mitigation/validation) | 🟡 | No | Assumptions A1–A22 are locked in `DECISIONS.md` §1 but carry no validation plan, severity or mitigation. Trigger: any assumption whose falsification would force a schema or stack change → add to §4 with a validation step |
| 7 | Success KPIs (activation/retention/revenue) | 🟡 | No | `PROJECT-BRIEF.md` §7 has 6 numeric acceptance criteria. Adoption/retention are unmeasurable by design (zero telemetry, B18-9) — the substitute is manual: pilot interviews + `TODO.md` review |
| 32 | ER diagram + cardinality notation | 🟡 | Minor | 56 tables documented with types/FK/indexes/example rows; no `erDiagram`. Trigger: next schema change beyond `001_initial.sql` — generate the mermaid ER in the same PR |
| 61 | Code-review checklist: AI-hallucination guards | ✅ (2026-09-05) | — | **Closed:** `CODING-STANDARDS.md` §7.8 now requires every dependency, symbol, command, code, table, column and i18n key to be proven to exist before use, and states that widening a gate to admit a hallucination is a B8 violation. The machine half (`docs:verify` 7b) was unreachable and is now live: `docs:verify` 7b rejects undefined codes cited in `API-SPEC.md`, behind a baseline that may only shrink, with a mutation self-test (three probes verified 2026-09-05). Measured drift: **17 distinct codes** cited with no definition suite-wide, now classified against the binary in **KI-016**: 7 ship in `import.rs` with inline copy but no catalog row, 1 is a phantom (`INVALID_ARGUMENT` is the Rust variant name; its wire code is `VALUE_INVALID`), 9 are forward references to unbuilt capability. Still open: the §7 checklist section itself, and widening the guard beyond `API-SPEC.md` once those 17 are resolved — most of the other all-caps tokens are env vars and enum labels, not codes |
| 19 | Flow **diagrams** | 🟡 | No | 14 journeys are fully written as ordered steps + branches in `USER-FLOWS.md`; only the rendered diagram is absent. Trigger: any flow exceeding 12 steps — add the mermaid graph in the same PR that edits that flow |
| 42 | Search design | 🟡 | Minor | F-038 / S-003 defines scope and states; no index/backing-store decision recorded. Trigger: implementation start of F-038 — record as an ADR (in-memory vs `sqlite-fts5`; note ADR-005 single-store constraint) |
| 39 | Background jobs / retries / DLQ | 🟡 | Minor | Import/recalc run through the worker + batch state machine; no dead-letter section. Trigger: first retryable long-running job beyond connector sync |
| 44 | Notification preferences / quiet hours | 🟡 | No | Rules, thresholds, dedupe (≤1/24h) and 90-day retention are in `MONITORING.md`; no per-user preference screen. Trigger: if OS notifications gain a toggle, spec it in `SCREENS-SPEC.md` first |
| 41 | Media/file handling (malware, size caps) | 🟡 | No | Format/encoding/hash limits are in `GL-TEMPLATE-SPEC.md` + S-030; no scanning step. Disposition: local file on the user's own machine, no ingest of untrusted remote files → scanning is out of v1.0.0 scope; revisit if any upload-from-network path is ever added |
| 53 | Privacy policy + DSAR/DPA text | 🟡 | No | Posture and data flows documented; artifacts for enterprise buyers pending (see #92) |
| 88 | Scope-change process | 🟡 | Minor | `ZERO-COMPROMISE-RULES.md` B20 + ADR supersession record the *effect*; the intake step is §5 of this file |
| 94 | Repo LICENSE + AI-code policy | 🟡 | **Yes for release** | No `LICENSE` file at root; `license-check.mjs` gates dependency licenses and `LICENSE-SPEC.md` is activation (different meaning). Trigger: before public repo/first external copy — human chooses the license; AI-generated-code policy recorded in `DECISIONS.md` |
| 97 | Support model (channels, FAQ, SLA) | 🟡 | No | `ONBOARDING-USER-GUIDE.md` + `docs/S-076` help surfaces exist; support SLA is a business commitment → due with #92 |
| 98 | Onboarding & email lifecycle | 🟡 | No | In-app onboarding fully spec'd (`S-002`, `ONBOARDING-USER-GUIDE.md`). No email exists (no accounts, B18-9); transactional notice inventory = `MONITORING.md` alerts |
| 68 | E2E specs implemented | 🟡 | No (spec complete) | `USER-FLOWS.md` defines UF-001…UF-014; `e2e/` holds 1 spec file. **This is an implementation gap, not a documentation gap** — tracked in `TASKBOARD.md`, filled as milestones land |
| 76 | CI actually executing | 🟡 | No | `CI-CD.md` + `infra/ci.yml` are complete; `.github/workflows` is unpushable here (token lacks Workflows permission), so gates currently bind locally only. Recorded in `HANDOVER.md` §3, `TASKBOARD.md` M7-1 |
| 43 | Real-time design | ➖ | — | By design: single-user, one machine (A19, multi-user = V-015) |
| 48 | Analytics/event tracking plan | ➖ | — | By design and enforced: ADR-008 / B18-9, `scripts/telemetry-scan.mjs` fails CI on a violation |
| 75 | Infrastructure / IaC | ➖ | — | By design: no server (ADR-001); release artifacts live in `DEPLOYMENT.md` |
| 93 | Cookie policy | ➖ | — | No web surface, no cookies; revisit only with a marketing site (outside repo) |

---

## 4. PARKING LOT (open questions · owner · revisit trigger)

IDs use the **OQ-** prefix on purpose: `Q1–Q8` is the QA-CHECKLIST namespace (renamed out of the old B1–B8 collision — see ZERO-COMPROMISE-RULES
§Namespace); inventing new `Q-` ids here would recreate it.

Aggregated from the availability notes scattered through `SCREENS-SPEC.md`, plus findings of this audit.
Nothing here may be silently absorbed into v1.0.0 scope (B20).

| ID | Question | Owner | Revisit at |
|---|---|---|---|
| OQ-01 | `model.inspect`, `driver.import`, `company.archive_year` are catalogued in `API-SPEC.md` with no Rust handler: implement per spec, or move to v1.1 and update PRD + traceability? | architecture | start of the milestone that needs each command |
| OQ-02 | Source Vault: `source_files` stores metadata only; compressing source bytes into the encrypted payload + resealing the Company File is unbuilt. Which milestone owns the atomic reseal? | storage | before F-008 is marked DONE |
| OQ-03 | Import progress: `import:progress`/cancel do not exist, so screens must show no percentage. Add streaming progress, or lock the "no fabricated progress" rule permanently? | core | M2 close-out |
| OQ-04 | 500k-row import benchmark not run (native toolchain). Blocking for `PERFORMANCE-REQUIREMENTS.md` sign-off? | qa | before v1.0.0-rc1 |
| OQ-05 | Saved-mapping listing/history has no command in the catalog. Spec the command or retire the promise? | product | before M2 close-out |
| OQ-06 | `reconcile.run` (S-034) and `connector.*` runtime paths incomplete: which slice is v1.0.0-blocking (B19 says Manual Import must work alone)? | product | M5 planning |
| OQ-07 | Ratify `PRICING-AND-ENTITLEMENTS.md` D1–D5 (numbers, axis set, deny-path code, v1.1 module set, term shape). Interim rule already binds: no branching on `plan` | product + owner | before any plan-gated UI or external quote |
| OQ-08 | Working product name (ADR-019) is unresolved for public release. | human | before any external artifact |
| OQ-09 | Search backing store undecided (register #42) — needs an ADR before F-038. | architecture | start of F-038 |
| OQ-11 | **CLOSED (2026-09-05, ADR-027).** Classification found the catalog was already right: 7 of the 17 are validator message prefixes (documented in `ERROR-HANDLING.md` §2B, each bound to its governing code), 1 was a leaked Rust type name (`INVALID_ARGUMENT` → `VALUE_INVALID`, `API-SPEC.md` corrected), 9 are unbuilt and now sit in §2C as reserved-with-no-copy. The gate's hardcoded baseline is deleted and §2B is its only exemption source. Follow-on: `MAP_ACCOUNT_NOT_FOUND` (**KI-018**, needs cargo+vitest) | architecture | ~~before the next API-SPEC change~~ done; KI-018 open |
| OQ-10 | Native gates (cargo, clippy, tauri build, signing, notarization, multi-monitor/DPI, screenshot diffs) cannot run in the current sandbox; many TASKBOARD rows are `🚧 PARTIAL/NATIVE-UNVERIFIED` for this reason. Which environment is authoritative for DONE? | release | next CI-capable environment |

**Rules for this register:** every row is either (a) implemented with its spec updated, or (b) promoted into
`KNOWN-ISSUES.md` with an KI-id, or (c) closed as "wont-do" with a one-line reason here. No row may be deleted.

---

## 5. INTERIM GUARD FOR THE REVIEW-CHECKLIST HOLE (#61)

Until a hallucination section is added to `CODING-STANDARDS.md` §7, every reviewer treats these as blocking:

1. **Every new import** must resolve: `npm ls <pkg>` or `cargo tree -i <crate>` succeeds, and the exact symbol exists in
   the pinned version (`TECH-STACK.md`). New runtime technology needs an ADR and must keep the ≤15 budget (B13).
2. **Every API/field name** must be cited in a spec (`API-SPEC.md`, provider docs in `INTEGRATIONS.md`,
   `CONNECTOR-DATA-DICTIONARY.md`) or in the library's own types. No "plausible" endpoint, flag, option or
   crate feature is acceptable.
3. **Every numeric limit** (rows, days, percent, thresholds) must trace to a spec value, not to a model's memory.
4. **No invented screen, error code, table, column, or i18n key.** `docs:verify` and `schema-equality-check` catch
   most of this; if a gate has been widened instead of the docs fixed, that is a B8 violation — revert it.
   Since 2026-09-05 the error-code half is machine-enforced for `API-SPEC.md` (`docs-verify` 7b + its shrinking
   baseline, and its only exemption is the §2B prefix table). Codes cited in **other** docs are reviewer-enforced still:
   check a name against `ERROR-HANDLING.md` §2, then §2B (a prefix), then §2C (reserved, unbuilt). A name in none of the
   three is invented — write the row, do not bend the gate.
5. **No silent capability claim.** A button whose handler is absent is a defect, not a placeholder (B10/B18-3).

---

## 6. HOW THIS AUDIT WAS PRODUCED (reproducible)

1. Enumerate: `ls docs/*.md`, cross-check row count against `DOCS-INDEX.md` (`npm run docs:verify`).
2. Map each of the 101 checklist items to the doc that answers it, by reading the doc, not its filename —
   filename-level matching mis-states coverage in both directions.
3. Spot-check claims against enforcement, not intent: `docs:verify` (index/IDs/banned terms/placeholder words/counts),
   `docs-link-check.mjs --strict`, `money-ast.mjs`, `schema-equality-check.mjs`, `telemetry-scan.mjs`,
   `license-check.mjs`, plus `package.json` engines and `infra/ci.yml` stages.
4. Verify the product is what the docs say: `TASKBOARD.md` dashboard vs `git ls-files` reality
   (e.g. `e2e/` file count, `.github/` absence).
5. Re-run after any doc change: `npm run docs:verify`. Update §1, §2, §3 in the same PR that closes a row.

*Referenced by: DOCS-INDEX.md, TASKBOARD.md.*
