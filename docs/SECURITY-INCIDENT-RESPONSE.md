# SECURITY-INCIDENT-RESPONSE.md

> OneFP&A · v1.0.0 · **Incident tiers, SLAs, roles, runbook, and post-incident requirements.** Vendor-side process (the app is local-first; incidents are: user-reported app issues, release-binary compromise, dependency CVE, license forgery attempt, key exposure).

---

## 1. INCIDENT TIERS & SLA

| Tier | Definition | Examples | SLA (first response) | Fix window |
|---|---|---|---|---|
| **Critical** | Silent financial misstatement, data loss, credential theft, release compromise, audit-chain bypass | float money shipped, backup restore corruption, valid-looking forged license use, signed update serving wrong binary | 24 h | 72 h (hotfix) |
| **High** | Import/data integrity bug for common path, crypto weakness, OAuth token exposure path | tie-out gate bypass, wrong period mapping, keychain plaintext fallback bug, CVE HIGH in runtime dep | 72 h | 14 d |
| **Medium** | Functional regression, a11y blocker, doc/claim mismatch | variance attribution wrong for a niche case, contrast regression | 14 d | next minor |
| **Low** | Cosmetic, perf regression ≤ 10% | tooltip text wrong | 30 d | next release |

## 2. ROLES & CHANNEL

| Role | Responsibility |
|---|---|
| Incident Commander (vendor) | triage, coordination, status updates (Customer triage is by vendor support; no on-call for user data) |
| Owner (engineer) | reproduce, fix, regression test |
| Security Owner | threat-model impact, CVE triage, key rotation if relevant |
| Release Owner | hotfix release path, signed build, rollback |

**Channel:** GitHub Issues (security template) + vendor email for private disclosure. No in-app telemetry channel (B18-9) — that is a product decision, and incident reporting is done via the user exporting Local Diagnostics (sanitized).

## 3. RUNBOOK (per incident — exact steps)

### Critical
1. Reproduce on fixture (fixtures must be deterministic — TEST-FIXTURES-SPEC).
2. Confirm scope: affected Company types (single/group), OS, version.
3. If data risk: instruct affected users to **stop editing + make an encrypted backup immediately**; for audit-chain-break, app already enters read-only + restore (AUTH-SPEC §2.5).
4. Fix + failing regression test BEFORE release.
5. Release hotfix: bump patch version, signed, update manifest; users' auto-update pulls it.
6. Publish advisory (GHSA) + CHANGELOG.
7. Post-incident (within 7d): timeline, root cause, prevent-item; update DECISIONS.md + TEST-FIXTURES with the regression.
8. If compromised key (signing/license/HMAC): rotate key, revoke licenses with the old key (offline revocation list shipped in next update), re-sign assets.

### High / Medium / Low
Same skeleton; post-incident only for High (Medium/Low → backlog item with owner).

## 4. INCIDENT CONTENT RULES

- Never include user financial values in public issues (redaction).
- Never include tokens/keys; secrets are rotated, not disclosed.
- Reproducible artifacts: fixture path + version + OS + steps (not user data).

## 5. SECURITY CONTACTS & DISCLOSURE

- `docs/SECURITY.md` (root-level pointer) lists: private disclosure email, PGP fingerprint (rotated annually), `security.txt` for hosted releases (GitHub).
- Vulnerability disclosure acknowledgment SLA: 48 h ack, 30 d to remediation plan; coordinated disclosure allowed after fix release (per common-practice 90 d).

## 6. RELEASE-DAY INCIDENT (stop conditions)

Stop a release if: any Critical open · signing/notarization incomplete · audit/security scans not green · update manifest checksum mismatch. Resume only with documented resolution (CI-CD.md §6).

*Referenced by: SECURITY-CHECKLIST §4, MONITORING §5, RELEASE-CHECKLIST.*
