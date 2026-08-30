# KNOWN-ISSUES.md

> OneFP&A · v1.0.0 · **Format:** `KI-###` | severity (Critical/High/Medium/Low) | status (Open/Workaround/Mitigated/Accepted-by-design) | affected area | detail | plan.
> Sources: Stage 0 risk assessment (R1–R8) + sweep findings + reference-project lessons (W1–W8). New issues go here first; resolved → DECISIONS.md.

---

## CURRENT REGISTER

### KI-001 · PIN/Recovery Phrase loss = unrecoverable Company · High · Accepted-by-design
- **Affected:** F-034 security (S-072, D-007)
- **Detail:** Local-first encryption means if both PIN and Recovery Phrase are lost, the Company cannot be opened. There is no server-side escrow (by design — B18-9, no data off machine). Reference project's unverified-unlock flaw (F-0006) is avoided, but this trade-off is inherent.
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

---

## ISSUE TEMPLATE (for new entries)

```markdown
### KI-### · <Title> · <Severity> · <Status>
- **Affected:** <feature/screen>
- **Detail:** <one paragraph, exact>
- **Plan:** <action + target version>
```

*Referenced by: DECISIONS.md, ROADMAP.md, DOCS-INDEX.md.*
