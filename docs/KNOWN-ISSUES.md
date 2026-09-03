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

### KI-013 · Auth error copy + lockout countdown unit drift (code vs ERROR-HANDLING §A / AUTH-SPEC §2) · Low · Open
- **Affected:** S-001 unlock (`src/pages/s001-unlock`), `core/error.rs` user texts, `src/i18n/en.json` (`unlock.error.locked`), `e2e/unlock.spec.ts`, `src/App.test.tsx`
- **Detail:** Retry flags were reconciled in Unit W-2 (2026-09-03), but two cosmetic drifts remain: (1) user texts — code says "Incorrect PIN. Please try again." / "Too many attempts. Try again later." / "The session is locked. Unlock first." while ERROR-HANDLING §A locks "Incorrect PIN." / "Too many attempts. Try again in {countdown}s." / "Session locked. Unlock to continue."; the code strings are asserted verbatim by e2e + page tests, so the fix touches six files at once. (2) Units — the core locks for `LOCKOUT_MS = 30_000` (AUTH-SPEC §2.2: "30s countdown") but S-001 renders `retryAfterMs` as whole minutes with a floor of 1 ("Try again in 1 min"), overstating a 30 s lock; a live seconds countdown is what the spec describes. No security impact (server-side lock is authoritative; the flag/status fields are correct).
- **Plan:** One bounded UI/i18n unit: switch `unlock.error.locked` to a seconds countdown driven by `retryAfterMs`, align the three user strings in `core/error.rs` + mock + e2e/page fixtures to §A, and add an i18n test for the key. Target: next M1-2 pass (S-001 hardening), before M7-5 E2E is enabled on CI.

### KI-014 · `core/money.rs` Largest-Remainder tie order was ascending (spec §4 says descending) · Medium · Mitigated
- **Affected:** MONEY-ROUNDING-SPEC §4 (F-027 statement/report exact totals); `src-tauri/src/core/money.rs::largest_remainder_allocate`; its two unit tests
- **Detail:** The Rust allocator sorts candidates by fractional remainder **ascending** (`ri.cmp(&rj)`) and then adds the residual units to the first entries, i.e. to the *smallest* remainders — the spec (step 4b) says *largest remainder first*. Totals still tie (Σ children == parent), but the unit lands on the wrong line: the spec vector `12.4 / 3.7 / 7.9 @ 1` yields `13 / 4 / 7` instead of the documented `12 / 4 / 8`, and the `displayed_unit_allocation_is_exact` assertion `displayed[1] > 2665.5` is false under the coded order (the test comment says `12 + 4 + 8 = 24`, so the intent matches the spec). Found 2026-09-03 while writing the TS mirror (`src/workers/spreading.ts`, which implements the spec order and pins both vectors). Not fixed in Unit W-3: the Rust change cannot be compiled/tested in this sandbox (no cargo) and touches the money owner (B14).
- **Plan:** **Fixed in code 2026-09-03 (Unit W-3b):** sort reversed to `rj.cmp(&ri)` with the deterministic lowest-index tie-break kept; the two spec vectors are now asserted exactly (`[12, 4, 8]`, `[1234.4, 2665.6, 100.0]`) plus a tie-break test. Status stays *Mitigated* (not Closed) until `cargo test core::money` runs green on a Rust-equipped CI runner — the sandbox has no cargo, so the edit is hand-reviewed (brace-balanced, 3-line logic change). The TS mirror in `src/workers/spreading.ts` already implements the spec order.

---

## ISSUE TEMPLATE (for new entries)

```markdown
### KI-### · <Title> · <Severity> · <Status>
- **Affected:** <feature/screen>
- **Detail:** <one paragraph, exact>
- **Plan:** <action + target version>
```

*Referenced by: DECISIONS.md, ROADMAP.md, DOCS-INDEX.md.*
