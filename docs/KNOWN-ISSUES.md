# KNOWN-ISSUES.md

> OneFP&A · v1.0.0 · **Format:** `KI-###` | severity (Critical/High/Medium/Low) | status (Open/Workaround/Mitigated/Accepted-by-design) | affected area | detail | plan.
> Sources: Stage 0 risk assessment (R1–R8) + sweep findings + reference-project lessons (W1–W8). New issues go here first; resolved → DECISIONS.md.

---

## CURRENT REGISTER

### KI-001 · PIN/Recovery Phrase loss = unrecoverable Company · High · Accepted-by-design
- **Affected:** F-034 security (S-072, D-007)
- **Detail:** Local-first encryption means if both PIN and Recovery Phrase are lost, the Company cannot be opened. There is no server-side escrow (by design — B18-9, no data off machine). Reference project's unverified-unlock flaw (reference issue #0006) is avoided, but this trade-off is inherent.
- **Plan:** Setup shows the Warning once; suggest writing phrase to paper + storing a passphrase-protected Backup in a second location (F-037 mitigates). Future V2: optional customer-managed escrow (never vendor).

### KI-002 · Connector API surface varies by region/plan · High · Workaround
- **Affected:** F-009 (QBO/Xero/NetSuite/Sage)
- **Detail:** Provider endpoints/fields differ by subscription tier and region (e.g., Xero advanced vs basic scopes; NetSuite SuiteTalk permission sets). Discovery handles only documented common fields.
- **Plan:** Adapters log unsupported fields as WARNING (never fail the batch); docs/`INTEGRATIONS.md` table lists supported scope per provider; customers with niche fields use Manual Import. Regression contract tests per provider fixture.

### KI-003 · Apple/iOS-style notarization + EV signing require paid certs · Medium · Workaround
- **Affected:** DEPLOYMENT §3 (R1)
- **Detail:** Developer ID (macOS) and EV code-signing (Windows) cost money/time; unsigned builds are blocked from distribution policy.
- **Plan:** CI job enforces signed release (never publishes unsigned); rollout uses developer certs in CI secrets; enterprise offline bundles can ship without store distribution.

### KI-004 · HyperFormula Excel parity is ~100% for supported functions, not every exotic function · Medium · Accepted-by-design
- **Affected:** F-012
- **Detail:** The formula engine covers the Excel core + declared Analysis Functions; exotic/legacy macro functions (UDFs, XLM) are not supported.
- **Plan:** Documented supported-function list in HELP (S-076); unsupported functions fail validation with `FORMULA_UNSUPPORTED_FUNCTION` (never silent wrong math). UDF support evaluated V2.

### KI-005 · 500k+ row GL dumps in encrypted vault increase file size ~15–30% · Medium · Accepted-by-design
- **Affected:** F-010, PERFORMANCE §5
- **Detail:** Source Vault stores compressed originals; overhead tracked (≤ 30% budget).
- **Plan:** Retention policy (default 12 months) + storage gauge in S-074; users can archive years (F-037).

### KI-006 · OAuth refresh expiry window (QBO 100d / Xero 60d) can disconnect long-idle users · Low · Workaround
- **Affected:** F-009
- **Detail:** If a connector isn't used past token lifetime, authorization must be redone (a 60-second flow).
- **Plan:** Health card shows expiry date + reminder 14d before; `CONNECTOR_AUTH_EXPIRED` UX has one-click reconnect; no data loss.

### KI-007 · Linux keychain (Secret Service) may be absent on minimal distros · Medium · Mitigated
- **Affected:** F-034/INTEGRATIONS §1.5
- **Detail:** keyring crate needs Secret Service; fallback is an encrypted local credential file with a user passphrase (never plaintext).
- **Plan:** Detection at first run (S-072) with explicit warning + recommendation to install gnome-keyring; automated per-OS test on CI runner (ENV-BOUND in dev sandbox).

### KI-008 · Multi-BU consolidation performance vs 50-BU ceiling needs constant benchmarking · Medium · Open
- **Affected:** F-028, PERFORMANCE §3
- **Detail:** Ceiling targets set at 50 BU/10s; worst-case IC cube (50×50) must be validated with benchmark data.
- **Plan:** CI bench suite includes 50-BU fixture + matrix; regressions >10% block release (PERFORMANCE §7).

### KI-009 · Audit chain growth on very active models (10M+ events) · Low · Workaround
- **Affected:** F-033
- **Detail:** Chain is append-only; archiving keeps verifiability while compressing.
- **Plan:** Auto-archive per fiscal year (verify-on-demand); documented retention (default 7 years, configurable via settings).

### KI-010 · E2E in the dev sandbox cannot run real browsers/tauri-driver (network-off) · Low · Workaround
- **Affected:** CI/CD §2 (reference project's F-02 reproduced as a constraint)
- **Detail:** Browser CDN egress + GUI runners unavailable in sandbox; E2E is executed on CI runners (GitHub-hosted) with `CI_SANDBOX_MODE` marking skipped-by-environment (explicit, never silent).
- **Plan:** Sandbox development relies on unit/integration/property tests; full E2E evidence produced by GitHub Actions on PR (mandatory before merge).

### KI-011 · Reference-project debts explicitly NOT carried over · High · Mitigated
- **Affected:** product-wide (W1–W8)
- **Detail:** Float money (0.85% adoption), 4 competing fiscal calendars, unverified password storage, silent per-gate skips, docs theater (145 docs vs 37), scope explosion (202 engines), no license activation — all designed out: rules B1–B20.
- **Plan:** Guardrails: `money:ast` AST gate; single engine owners (B14); a11y/CI blocking (B18-7); GLOSSARY + DOCS-INDEX (B8); license (F-035). No carry-over.

### KI-012 · Fiscal-period id contract gap (UUID v4 in core vs `fp-YYYY-pNN` everywhere else) · High · Open
- **Affected:** F-013 drivers (`driver.set_value`), F-012/F-014 assumptions (`assumption.upsert` → `validate_periods` → `PERIOD_NOT_FOUND` 404), S-043/S-044, API-SPEC §examples, DATABASE-SCHEMA `fiscal_periods` example row
- **Detail:** `company.create` mints `fiscal_periods.id` as `Uuid::new_v4()` (`src-tauri/src/commands/company.rs`), while every other layer assumes the documented deterministic shape `fp-YYYY-pNN`: DATABASE-SCHEMA/API-SPEC examples, `src/stores/assumptions.ts` (`fp-(\d+)-p(\d+)` chronological compare), the model-engine worker, the dev mock and the S-044 period pickers. No command returns the persisted ids (`calendar.preview` yields period_no/code/dates only; `calendar.apply` returns `{applied:true}`); only the import commit path maps dates → ids internally. Consequence: against the native core, a period-scoped write from the shell fails `PERIOD_NOT_FOUND` for any period the UI can name — the browser preview masks it because the mock uses the documented ids. Found 2026-09-03 (APD-v4 takeover, Unit W-1); **not fixed** because either remedy changes a locked contract (Tier 3).
- **Plan:** Human decision required (RFC in DECISIONS.md): (a) mint deterministic ids `fp-<fy_label>-p<NN>` in `company.create`/`calendar.apply` (DB-only change, matches the docs verbatim; needs a migration note for existing `.fpa` files), or (b) add a read command (`calendar.list` / extend `model.list`) that exposes persisted period ids and make the stores consume it (API-SPEC extension → 98 commands, catalog is locked at 97). Until decided, TASKBOARD §12 carries the item and native driver/assumption writes stay unverified.

### KI-013 · Auth error copy + lockout countdown unit drift (code vs ERROR-HANDLING §A / AUTH-SPEC §2) · Low · Fixed (TS) / Mitigated (Rust, pending cargo)
- **Affected:** S-001 unlock (`src/pages/s001-unlock`), `core/error.rs` user texts, `src/i18n/en.json` (`unlock.error.locked`), `e2e/unlock.spec.ts`, `src/App.test.tsx`
- **Detail:** Retry flags were reconciled in Unit W-2 (2026-09-03), but two cosmetic drifts remain: (1) user texts — code says "Incorrect PIN. Please try again." / "Too many attempts. Try again later." / "The session is locked. Unlock first." while ERROR-HANDLING §A locks "Incorrect PIN." / "Too many attempts. Try again in {countdown}s." / "Session locked. Unlock to continue."; the code strings are asserted verbatim by e2e + page tests, so the fix touches six files at once. (2) Units — the core locks for `LOCKOUT_MS = 30_000` (AUTH-SPEC §2.2: "30s countdown") but S-001 renders `retryAfterMs` as whole minutes with a floor of 1 ("Try again in 1 min"), overstating a 30 s lock; a live seconds countdown is what the spec describes. No security impact (server-side lock is authoritative; the flag/status fields are correct).
- **Plan:** ~~One bounded UI/i18n unit: switch `unlock.error.locked` to a seconds countdown driven by `retryAfterMs`, align the three user strings in `core/error.rs` + mock + e2e/page fixtures to §A, and add an i18n test for the key.~~ **Done 2026-09-04 (M1-2 pass):** S-001 now renders a live seconds countdown from `retryAfterMs` (1 s interval, cleared on unmount/at 0; submit disabled until expiry, AUTH-SPEC 30 s fallback when `retryAfterMs` is absent); `unlock.error.locked` → `"Too many attempts. Try again in {{seconds}}s."`; the three §A user texts are aligned verbatim in `mock.ts` (TS) and `core/error.rs` (string literals only — **NATIVE-UNVERIFIED**, no cargo in the sandbox), plus `e2e/unlock.spec.ts` / `App.test.tsx`; i18n key test added (`i18n.test.ts`). New S-001 page tests pin the countdown (4 tests incl. axe). Rust status stays *Mitigated* until `cargo test` runs green on a Rust-equipped runner.

### KI-014 · `core/money.rs` Largest-Remainder tie order was ascending (spec §4 says descending) · Medium · Mitigated
- **Affected:** MONEY-ROUNDING-SPEC §4 (F-027 statement/report exact totals); `src-tauri/src/core/money.rs::largest_remainder_allocate`; its two unit tests
- **Detail:** The Rust allocator sorts candidates by fractional remainder **ascending** (`ri.cmp(&rj)`) and then adds the residual units to the first entries, i.e. to the *smallest* remainders — the spec (step 4b) says *largest remainder first*. Totals still tie (Σ children == parent), but the unit lands on the wrong line: the spec vector `12.4 / 3.7 / 7.9 @ 1` yields `13 / 4 / 7` instead of the documented `12 / 4 / 8`, and the `displayed_unit_allocation_is_exact` assertion `displayed[1] > 2665.5` is false under the coded order (the test comment says `12 + 4 + 8 = 24`, so the intent matches the spec). Found 2026-09-03 while writing the TS mirror (`src/workers/spreading.ts`, which implements the spec order and pins both vectors). Not fixed in Unit W-3: the Rust change cannot be compiled/tested in this sandbox (no cargo) and touches the money owner (B14).
- **Plan:** **Fixed in code 2026-09-03 (Unit W-3b):** sort reversed to `rj.cmp(&ri)` with the deterministic lowest-index tie-break kept; the two spec vectors are now asserted exactly (`[12, 4, 8]`, `[1234.4, 2665.6, 100.0]`) plus a tie-break test. Status stays *Mitigated* (not Closed) until `cargo test core::money` runs green on a Rust-equipped CI runner — the sandbox has no cargo, so the edit is hand-reviewed (brace-balanced, 3-line logic change). The TS mirror in `src/workers/spreading.ts` already implements the spec order.

### KI-015 · `docs:verify` rule §7 could not detect an invented error code (unsatisfiable condition) · High · Fixed (guard) / Open (drift)
- **Affected:** `scripts/docs-verify.mjs` §7 — the check the suite relies on for B12 ("every error is a typed code") — plus `API-SPEC.md`, `SCREENS-SPEC.md`, `GL-TEMPLATE-SPEC.md`, `MODELING-METHODS-SPEC.md`, `STATE-MANAGEMENT.md`, `CONNECTOR-DATA-DICTIONARY.md`, and the AI-hallucination half of checklist item #61
- **Detail:** The guard is `if (!errDefs.has(c) && !["AUTH_PIN_INVALID","AUTH_LOCKED"].every((x) => x !== c))`. The second clause evaluates true only when `c` **is** one of those two codes, and both are defined in `ERROR-HANDLING.md` — so `!errDefs.has(c)` is false for them and the conjunction can never hold. **The rule is unreachable.** Proved 2026-09-04: appending a row containing `BO DEFINITELY_FAKE_CODE_XYZ` to `API-SPEC.md` made `docs:verify` print PASS (and count the injected row); removing it printed PASS again. Any hallucinated or renamed code in the API catalog therefore ships silently — precisely the failure class B18-7 forbids ("no gate that silently passes").
- **Evidence of live drift (measured, not estimated):** `ERROR-HANDLING.md` defines **99** codes while **17 distinct** codes are referenced elsewhere and defined nowhere — `API-SPEC.md` 6 (`OPENING_ACCOUNT_DUPLICATE`, `OPENING_PERIOD_MIXED`, `IMPORT_KIND_DESTINATION_UNAVAILABLE`, `INVALID_ARGUMENT`, and `ACCOUNT_MISSING`/`POSTING_REF_DUPLICATE` inside JSON example messages), `SCREENS-SPEC.md` 6 (`DASHBOARD_QUERY_FAILED`, `FORMULA_OUT_OF_SCOPE`, `COVENANT_BREACH`, `DEBT_SCHEDULE_OVERDRAWN`, `POC_ESTIMATE_INVALID`, `REVREC_POLICY_MIX`), `GL-TEMPLATE-SPEC.md` 3 (`ACCOUNT_MISSING`, `CURRENCY_UNKNOWN`, `PERIOD_OUT_OF_RANGE`), `MODELING-METHODS-SPEC.md` 1 (`LINE_MAPPING_INCOMPLETE`), `STATE-MANAGEMENT.md` 1 (`RECALC_IN_FLIGHT`), `CONNECTOR-DATA-DICTIONARY.md` 1 (`CONNECTOR_SCOPE_UNAVAILABLE`). Only the 4 `API-SPEC.md` refs are even in the rule's scope — and they would fail it the moment the boolean is corrected. (`SCENARIO_LOCKED` is excluded: superseded name, recorded in DECISIONS ADR-025.)
- **Why a boolean patch was not enough:** the original regex scanned every line for any all-caps word, so correcting only the condition would have failed the run on **55 tokens** in `API-SPEC.md` — `NULL`, `JSON`, `HMAC` and section titles, not just the real orphans. A usable rule had to define what a *citation* is.
- **Fixed 2026-09-05:** `docs-verify` §7b now collects codes only from the three shapes the suite actually uses (Errors cell of a catalog row, backticked SCREAMING_SNAKE token, `"CODE: "` prefix in a JSON example) and reports any that `ERROR-HANDLING.md` §2 does not define. Drift predating the fix is parked in `UNDEFINED_CODE_BASELINE` (6 entries, each commented with its OQ) and the baseline **may only shrink**: an entry that becomes defined, or stops being cited, fails the run — so the exemption list cannot fossilise into a new blind spot. A mutation self-test (`ZZ_GUARD_PROBE_CODE` through the same parser) aborts the gate if it ever stops firing. Verified with three probes: invented code → FAIL, baseline entry deleted → FAIL, defined code added to the baseline → FAIL.
- **Remaining (Open):** the 6 baseline entries and the 11 outside the guard's scope are now **classified with a recommended disposition per code** — see KI-016, which owns that decision sheet. Admitting any code changes the 99-code ground truth, so it stays a spec decision (OQ-11), never a script edit. Widening §7b beyond `API-SPEC.md` waits for the same sweep, because most other all-caps tokens are not codes at all (`SENTRY_DSN`, `HALF_EVEN`, `VITE_API`).


### KI-016 · 7 error codes shipped in the Rust core are absent from the canonical catalog · Medium · Open
- **Affected:** `ERROR-HANDLING.md` §2 (the B12 source of truth), `src-tauri/src/commands/import.rs`, `src/api/mock.ts`, `API-SPEC.md`, `GL-TEMPLATE-SPEC.md`, `MONEY-ROUNDING-SPEC.md`, and the `TASKBOARD.md` M1-5 note
- **Detail:** `docs-verify` 7b made the undefined-code question answerable for the first time, so the 17 orphans were classified against the actual binary rather than guessed. **Seven are real, shipped behaviour that the catalog never admitted:** `OPENING_ACCOUNT_DUPLICATE`, `OPENING_PERIOD_MIXED`, `IMPORT_KIND_DESTINATION_UNAVAILABLE`, `ACCOUNT_MISSING`, `POSTING_REF_DUPLICATE`, `CURRENCY_UNKNOWN`, `PERIOD_OUT_OF_RANGE` — all minted in `import.rs` during GL/opening-balance validation and mirrored in the dev mock, each carrying its copy **inline as a message prefix** (e.g. `import.rs:1773` `"OPENING_ACCOUNT_DUPLICATE: account/period already carries an opening balance on row {}"`) instead of as a catalog `userMessage`. Consequence is not a broken UI (`bridge.ts:24` forwards the core's `userMessage` verbatim, so a user sees copy) — it is that the copy for 7 codes has **no owner document**: no `httpStatus`, no `retry`, no `userMessage` text to translate, nothing for LOCALIZATION-SPEC §5 or QA-CHECKLIST to test against, and no way to know a rename is breaking. **One is a phantom:** `INVALID_ARGUMENT` (cited in `API-SPEC.md` and in the M1-5 tracker note) is not a wire code at all — it is the Rust *variant* `AppError::InvalidArgument`, which `core/error.rs:168` serializes as **`VALUE_INVALID`, 422, not retryable**. Both citations should read `VALUE_INVALID`. **Nine are forward references** to capability that is specced but unbuilt: `LINE_MAPPING_INCOMPLETE`, `RECALC_IN_FLIGHT`, `CONNECTOR_SCOPE_UNAVAILABLE`, `COVENANT_BREACH`, `DEBT_SCHEDULE_OVERDRAWN`, `POC_ESTIMATE_INVALID`, `REVREC_POLICY_MIX`, `DASHBOARD_QUERY_FAILED`, `FORMULA_OUT_OF_SCOPE` (zero occurrences in `src-tauri/` or `src/`).
- **Plan:** owner decision, three edits at once. (1) Admit the 7 to `ERROR-HANDLING.md` §2 with `httpStatus`/`retry`/`userMessage`, lifting the catalog **99 → 106** — which moves the claim in `DOCS-INDEX.md`, `FEATURE-TRACEABILITY-MATRIX.md`, `HANDOVER.md`, `TASKBOARD.md` and the `docs:verify` 7b ground-truth line **in the same PR**, then delete the 5 matching `UNDEFINED_CODE_BASELINE` entries (the ratchet fails the run if they linger). (2) Repoint `INVALID_ARGUMENT` → `VALUE_INVALID` in `API-SPEC.md` and the M1-5 note; drop the last baseline entry. (3) For the 9 forward references, either add a *Reserved* section to `ERROR-HANDLING.md` (so build-time copy work is tracked) or delete the citation at the screen that first ships — a reserved code that never appears in a catalog row is how KI-015 stayed hidden. Not done here deliberately: admitting codes writes product copy, and this repo's rule is that copy comes from the catalog, not from a script PR.


### KI-017 · `money:ast` fails at HEAD in a clean checkout — percent/ratio vs money scope · Medium · Open (locator: Fixed)
- **Affected:** `scripts/money-ast.mjs`, `src/pages/s051-compare/index.tsx`, `src-tauri/src/commands/model.rs`, CI job `lint-type-docs`
- **Detail:** On commit `9b56d91` with no local source edits, `npm run money:ast` reports **4 violations** while `TASKBOARD.md` records the gate green ("verified 2026-09-04, Windows 11 Desktop"). Both flagged sites are **ratio/percent formatting, not money**: `index.tsx:33` `pctVal.toFixed(1)` and `:133` `(r.delta_pct * 100).toFixed(1)`, and `model.rs:429-430` `as f64` over `minor / |minor|` to produce `delta_pct` — the comment on `:427` states the float exists precisely so the ratio cannot truncate to 0 and never yields Infinity/NaN. B3 guards **money exactness**; whether a percentage is in scope is therefore the open question. Second defect, independent of that: the `toFixed` finding printed `(${m.index})`, an **unlabelled character offset that reads like a line number** — `(4147)` in a 429-line file — while float ops and `REAL` columns carried **no location at all**, so a CI failure could not be opened by hand.
- **Locator half FIXED 2026-09-05:** `money-ast.mjs` gained `makeLocator` (offset → `line:col`, binary search over line starts) and every finding now appends the trimmed source line: `src/pages/s051-compare/index.tsx:33:44: toFixed outside money display formatter (B3)  [return \`\${pctVal >= 0 ? "+" : ""}\${pctVal.toFixed(1)}%\`;]`. Proved **report-only**: the previous revision and this one return the same 4 findings with RC=1, and offsets 1421/4147 map exactly onto `33:44` / `133:49` — the two flagged lines really do hold those calls. No pattern, exclusion or threshold was touched.
- **Plan (scope half, still the owner's):** pick one: (a) *ratios are in scope* → route percent display through the shared formatter (`COMPONENT-LIBRARY.md`) and return a `Decimal`/scaled integer ratio from the core, which is a real behaviour change with tests; or (b) *ratios are out of scope* → narrow the gate's `toFixed` rule to money-typed values only, and record the carve-out in ZERO-COMPROMISE-RULES so the intent is not re-litigated per PR. Not decided here: (a) touches money code owned by B14 and (b) narrows a guard, which B18-7 forbids doing silently. Still owed regardless of the choice: re-confirm **which tree** the `TASKBOARD.md` "money:ast PASS (verified 2026-09-04, Windows 11 Desktop)" line was measured on — this checkout is byte-identical to `9b56d91` under `src/` and `src-tauri/` and the gate is red, so either the fixes were never committed or the gate is environment-sensitive.

---

## ISSUE TEMPLATE (for new entries)

```markdown
### KI-### · <Title> · <Severity> · <Status>
- **Affected:** <feature/screen>
- **Detail:** <one paragraph, exact>
- **Plan:** <action + target version>
```

*Referenced by: DECISIONS.md, ROADMAP.md, DOCS-INDEX.md.*
