# SECURITY-CHECKLIST.md

> OneFP&A · v1.0.0 · **App-specific threat model + OWASP Top 10 (2021) mapped to our features + mitigation + verification.** Local-first changes the model: the biggest risks are local data theft, file exfiltration, tampering, and supply chain — not remote web attacks.

---

## 1. THREAT MODEL

| Asset | Threat | Likelihood | Impact |
|---|---|---|---|
| Company File (encrypted `.fpa`) | Disk theft, file exfiltration, backup theft | Medium | High (all financials) |
| Encryption keys | Key logged, left in memory/dump, weak PIN | Low–Med | High |
| OAuth tokens | Stored in wrong place, logged, leaked via webview | Low | High (ERP access) |
| Model numbers | Silent float corruption, wrong statement | Med | High (decisions) |
| Audit Trail | Tamper (hash recompute) | Low | High (trust) |
| License | Forgery (recompute key) | Med | Medium (revenue) |
| Exports | Formula injection, path traversal, unquoted `=` | Med | Medium |
| Dependencies | Known CVEs (npm/cargo), supply chain | Med | High |
| SQL injection | Dynamic SQL | Low (params/migrations only) | High |
| Local attacker / other processes | Reading WAL files, memory dumps | Med | Medium (encryption covers) |
| Support/diagnostics | Sensitive data in diagnostics | Low | Medium |

## 2. OWASP TOP 10 (2021) → MITIGATION → VERIFICATION

| OWASP | Our exposure | Mitigation | Verification (gate) |
|---|---|---|---|
| **A01 Broken Access Control** | Scenario/COA/Company-level gates in UI could be bypassed by crafted IPC | Authorization checked in Rust per command (AUTH-SPEC §3); read-only file lock at OS level; per-command audit | Rust authz tests; E2E attempts direct invoke from devtools (blocked) |
| **A02 Cryptographic Failures** | Money/sensitive data; "encrypted but weak" copies | AES-256-GCM; Argon2id params (AUTH-SPEC §6); no weak mode; encrypted backups; key never in DB | Crypto tests + key-location scan (`scripts/secret-scan.mjs`) |
| **A03 Injection** | Excel export `=` cells; CSV formulas; SQL; command strings | Parametrized SQL (no string concat); export quoting of `=`-text; no shell commands from file data; connector payloads typed | `EXPORT_FORMULA_INJECTION_GUARD` tests; SQL audit; sample malicious files in fixtures |
| **A04 Insecure Design** | "Trust the UI" gaps; single-user file ops | Threat model in this doc; ZC rules (B18); all mutations Snapshot + Audit; design review gate on new flows | QA-CHECKLIST B-items; design review in PR |
| **A05 Security Misconfiguration** | Broad Tauri capabilities (reference F-0005) | Least-privilege `capabilities/default.json`: no broad FS scope; only dialog/save; no shell plugin | Capability manifest test + CI JSON schema check |
| **A06 Vulnerable Components** | npm/cargo deps; Tauri, HyperFormula, AG Grid | Dependabot + `npm audit` + `cargo audit` HIGH=0; lockfiles; license gate (no GPL/AGPL) | CI audit jobs fail on HIGH; SBOM artifact (`scripts/sbom.mjs`) |
| **A07 Identification/Auth Failures** | PIN only; no rate limit on recovery | Argon2id; 5-fail lockout; recovery phrase entropy; lock screen; auto-lock | Auth tests incl. timing (min delay constant) |
| **A08 Integrity Failures** | Audit chain tamper; license forgery | HMAC-SHA256 chain w/ key in keyring; Ed25519 license verify; import batch hashes; source vault hashes | Chain-verify test; license invalid-sig test; tamper E2E |
| **A09 Logging Failures** | Sensitive data in logs/diagnostics | Redaction logger (no money>business context, no tokens, no paths w/ usernames); diagnostics opt-in export; audit logs excluded from diagnostics | Log redaction tests; diagnostics export tests |
| **A10 SSRF** | n/a (no server) — connectors fetch only provider host from allowlist | Allowlist per provider (`*.intuit.com`, `*.xero.com`, suite talk host per account, `*.sage.com`); no arbitrary URL | Connector URL tests (reject host mismatch) |

## 3. LOCAL-FIRST-SPECIFIC CONTROLS

| Control | Spec | Verification |
|---|---|---|
| File encryption | AES-256-GCM per Company, key wrapped by PIN-derived key; WAL in same encrypted container | open-with-wrong-PIN test; `strings` scan shows no plaintext financials |
| Memory hygiene | Session token + Company key dropped on lock/close; no keys in stack traces | Memory dump test (dev) — keys not present post-lock |
| OS keychain | OAuth tokens + HMAC key; Linux fallback encrypted + warned | Per-OS integration test (skip as ENV-BOUND in sandbox, still automated on CI runners) |
| File integrity | `integrity_check` at open; snapshot before mutations; vault hashes | Corruption injection test → recovery flow |
| Exports | Excel injection guard; PDF tagged; export allows only chosen path (SAVE dialog) | Malicious `.csv` fixture tests; path traversal tests |
| Diagnostics | Opt-in, no secrets, no raw GL amounts (round to 000s), user-reviewed before share | Redaction unit tests |
| Update integrity | Ed25519 signature; pinned host; rollback if signature invalid | Updater test with bad-sig fixture |
| Demo data | Separate Demo Company; production paths never load fixtures (B18-3) | `scripts/mock-data-audit` gate |

## 4. SECURITY REVIEWS & RESPONSE

| Activity | Cadence |
|---|---|
| `npm audit` / `cargo audit` (HIGH=0) | Every PR (CI) |
| Manual secret/config scan | Every PR (CI) |
| Dependency license scan | Weekly CI |
| Rust `cargo audit` + `cargo deny` | Weekly CI |
| Internal adversarial review (threat model refresh) | Every release |
| Incident response | Severity × SLA: Critical 24h, High 72h, Medium 14d (docs/security/INCIDENT.md) |
| Security advisories page | Public: SECURITY.md + GHSA advisories |

## 5. RELEASE SIGN-OFF (checkbox)

- [ ] OWASP matrix verified for changed surface
- [ ] No secrets in repo/history (`gitleaks` or `scripts/secret-scan`)
- [ ] Capability manifest least-privilege verified
- [ ] Audit chain + license crypto tests green
- [ ] Dependency audits clean (HIGH=0); SBOM generated
- [ ] Redaction logger tests green
- [ ] Threat model updated (if surface changed)

*Referenced by: AUTH-SPEC.md, INTEGRATIONS.md, QA-CHECKLIST.md, ENV-VARIABLES.md, MONITORING.md.*
