# COMPLIANCE-DATA-SOVEREIGNTY.md

> OneFP&A · v1.0.0 · **The product's privacy/sovereignty/compliance posture** (self-host/enterprise positioning, A7/A18/B18-9). This is a spec of what the software guarantees — not legal advice; enterprise buyers confirm fit with counsel.

---

## 1. DATA FLOW GUARANTEES (what OneFP&A never does)

| Guarantee | Binding rule |
|---|---|
| No data leaves the machine | No network calls except: (a) user-initiated Connector sync (actuals to/from their ERP), (b) user-initiated update check. No telemetry, no analytics, no phone-home, no license ping (B18-9) |
| No financial metadata in diagnostics | `Local Diagnostics` export redacts amounts (replaces with `0`/`***`), strips paths with usernames where removable, never exports tokens |
| No secrets in DB/logs | OAuth tokens/HMAC key only in OS keychain; logs redact `token`, `secret`, `password`, `PIN` (regex redaction + unit tests) |
| No PHI/PII assumption | Healthcare Pack is financial-metric-only (payer mix, volumes — no patient identifiers, no charts); if a customer maps patient data, that is their control deployment, and the doc states OneFP&A is not a HIPAA-certified BAA product — configure access controls accordingly |
| No silent transmission | Any future "cloud sync" (FUT-002) requires an ADR + explicit user opt-in per Company (A6) |
| No vendor-side data | Offline license activation exchanges only company/machine fingerprints (no financial data) |

## 2. PRIVACY POSTURE (GDPR / India DPDP-aligned posture at product level)

| Requirement | Implementation |
|---|---|
| Lawful basis / purpose limitation | First-run consent screen for connectors; app docs state purpose (planning, not storage of personal data) |
| Data subject access rights | Product does not hold personal data of end-customers; for user's own bookkeeping data, **Data-Room Export** + full Model/Company export = access & portability path |
| Erasure | Company File deletion: cryptographic shred (delete key + purge WAL + overwrite vault references) — `company.delete` performs secure deletion with confirm + audit; backups retention configurable (default 30d, min 7d) |
| Storage limitation | retention settings per artifact (audit 7y default configurable, vault 12m, backups 30d) — documented in S-074 |
| Records of processing | vendor-side none by design (no telemetry) |
| Cross-border | none by design — data stays on user hardware (sovereignty win, documented for non-US/regulated buyers) |

## 3. ENTERPRISE/REGULATED BUYER DOCUMENTATION (what we ship)

| Artifact | Contents |
|---|---|
| `docs/SECURITY-CHECKLIST.md` | threat model + OWASP mapping (buyers' security teams) |
| `docs/AUTH-SPEC.md` | crypto parameters (Argon2id/AES-256-GCM/Ed25519/HMAC) — verifiable, not claims |
| SBOM (CycloneDX) | every release, generated in CI (`npm run sbom`) |
| `SHA256SUMS` | release integrity verification |
| Auditor Data-Room Package | evidence pack (EXPORT-FORMAT-SPEC §5) |
| Offline deployment bundle | air-gap install path (DEPLOYMENT §4) |
| No-telemetry statement | MONITORING.md §1/§2 |

## 4. COMPLIANCE CHECKS IN CI

| Check | Command / gate |
|---|---|
| Secret scan | `scripts/secret-scan.mjs` (PR) |
| License compatibility | `scripts/license-check.mjs` (no GPL/AGPL) — CI gate |
| SBOM generation | release job; SBOM attached to release |
| Dependency advisory | `npm audit` + `cargo audit` HIGH=0 (CI) |
| Docs policy scan | `docs:verify` (index + links + glossary terms) |
| Telemetry scan | `scripts/telemetry-scan.mjs` — grep for `fetch(`/`axios`/`sentry`/`analytics` outside `connectors/`/`updater/` (CI fail) |

## 5. DECLARED LIMITATIONS (honest, buyers need these)

1. **Not** the accounting system of record; actuals import only.
2. **Not HIPAA-certified**; healthcare Pack contains no PHI by design (A18).
3. **Not** an auditor's official working papers — it produces audit evidence, not sign-offs.
4. **Not** a cloud sync product; data sovereignty by design means no cross-device sync in v1.0.0 (users use encrypted Backup files).
5. **Recovery trade-off:** Lost PIN + lost Recovery Phrase = unrecoverable Company (KI-001) — mitigated by encrypted backups, never by vendor escrow.

*Referenced by: PROJECT-BRIEF (Sovereignty), SECURITY-CHECKLIST, MONITORING, DR-RECOVERY-RUNBOOK.*
