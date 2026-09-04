# AUTH-SPEC.md

> OneFP&A · v1.0.0 · **Local-first single-user** — there is no account server (B1). "Auth" = app unlock + Company encryption + offline license. Terms per GLOSSARY.md. This file replaces the template's web-auth flow with the exact local equivalents and defines the permission matrix.

---

## 1. IDENTITY MODEL

| Concept | Implementation |
|---|---|
| User | Exactly one local `owner` per install (no accounts, no emails, no network) |
| Session | In-memory unlocked state after PIN verification; `session.lock`/auto-lock (5 min default, configurable) |
| Company identity | Company File encrypted with its own AES-256-GCM key |
| Credentials | OAuth tokens/API keys in OS Keychain only (never DB, never logs, never UI) |
| License | Ed25519-signed offline payload bound to Company + optional machine |

## 2. FLOWS

### 2.1 Register (first run = create PIN + Recovery Phrase)
```
1. Onboarding → D-007 Recovery setup
2. User enters PIN (≥8 chars, ≥2 classes; policy: letters+digits+symbol optional, no sequential runs ≥4)
   - weak → PIN_POLICY_WEAK with exact rules shown
3. App derives Argon2id key: salt(16B random), m=19456 KiB, t=2, p=1, hash stored in pin_metadata (never the PIN)
4. Generate 12-word Recovery Phrase (BIP39-style, offline CSPRNG); user confirms by re-entering 3 words
   - decline path → 2nd explicit warning, logged; recovery impossible (KNOWN-ISSUES: accepted design trade-off)
5. AES-256-GCM Company key is wrapped with derived key; wrapped key stored; plaintext key never persisted
6. Success → session unlocked, Audit event `security.pin_setup`
```

### 2.2 Login (unlock)
```
1. session.status → unlocked=false → S-001
2. PIN input → invoke session.unlock
   - correct → decrypt Company key → open file → session token (random 256-bit, in-memory)
   - wrong → AUTH_PIN_INVALID (generic; never reveals whether PIN vs file issue)
   - 5 fails → AUTH_LOCKED: 30s countdown, then reset counter
3. Auto-lock on idle (default 5 min; app-level setting) requires re-unlock — data stays encrypted
```

### 2.3 Logout (lock)
`session.lock` → session token invalidated, Company key dropped from memory, DB connection closed, UI returns to S-001. Nothing is written to disk unencrypted on lock.

### 2.4 Reset (forgot PIN)
```
1. S-001 → "Use Recovery Phrase" → security.recovery_reset(phrase, new_pin)
2. Verify phrase via Argon2id against recovery_phrase_hash
   - invalid → RECOVERY_PHRASE_INVALID; 2 fails → 30s lockout
   - valid → re-wrap Company key with new PIN-derived key; reset pin_metadata; Audit event
3. Old PIN never recoverable; data intact (key re-wrap only)
```
No email/phone verification exists (offline by design). Lost phrase + lost PIN = unrecoverable by design; setup screen states this explicitly once (no nagging).

### 2.5 Verify (integrity)
- On every unlock: `integrity_check` + audit chain verification (`AUDIT_CHAIN_BREAK` → read-only + restore offer).
- License verify on unlock and at startup: offline signature check (Ed25519), grace countdown shown.

## 3. PERMISSION MATRIX (local `owner` + object-level gates)

| Capability | owner (unlocked) | owner but ScenarioState = Locked | second instance (read-only) | license grace/expired | no session |
|---|---|---|---|---|---|
| View Company data | ✅ | ✅ | ✅ | ✅ (never in no-session) | ❌ |
| Edit Model cells (scenario Draft/Review/Approved) | ✅ | ❌ (must create Version) | ❌ | ✅ (read-only after expiry) | ❌ |
| Edit locked scenario | ❌ | ❌ (MODEL_CELL_LOCKED) | ❌ | ❌ | ❌ |
| Import / commit / rollback | ✅ | ✅ (creates new Actuals batch) | ❌ | ❌ | ❌ |
| Approve / Lock / Baseline | ✅ | ❌ (already locked) | ❌ | ❌ | ❌ |
| Export Excel/PDF/Data Room | ✅ | ✅ (version-stamped) | ❌ | ✅ (stamped) | ❌ |
| Backup / Restore | ✅ | ✅ | ❌ | ❌ | ❌ |
| Change PIN / Recovery Phrase | ✅ | ✅ | ❌ | ❌ | ❌ |
| License re-activation | ✅ | ✅ | ✅ | ✅ (except when requirement) | ✅ |
| Settings (app scope) | ✅ | ✅ | ❌ (app-level still allowed; company-level read-only) | ✅ | ❌ |
| Delete Company / Archive | ✅ (+reason) | ✅ | ❌ | ❌ | ❌ |

**Rules:** (1) every mutation writes an Audit event; (2) object-level gates checked in Rust, not UI (UI gate is cosmetic); (3) read-only second instance is enforced at the file-lock level (`FILE_IN_USE`); (4) no capability is ever granted based on UI flags alone.

## 4. LICENSE & ACTIVATION (offline)

```
1. Install → company.create → license.verify(payload) → not activated → S-073
2. Generate request file (company fingerprint: company_uuid + version + optional machine id)
3. Vendor signs (Ed25519): {company_hash, plan, expires_at?, machine_fingerprint?, issued_at}
4. security: verify signature + company_hash match + machine binding if present
   - invalid sig → LICENSE_INVALID_SIGNATURE (no partial rights)
   - expired → LICENSE_EXPIRED → read-only + activation CTA
   - machine changed → re-request file (data intact, no loss)
5. Grace: 60 days default after first expiry → read-only with clear messaging (configurable by vendor)
```

## 5. CONNECTOR AUTHORIZATION (third-party OAuth)

| Provider | Flow | Token storage | Refresh | Failure mode → UI |
|---|---|---|---|---|
| QuickBooks Online | OAuth 2.0 `authorization_code` + PKCE, scopes `com.intuit.quickbooks.accounting` | Keychain `com.onefpa.conn.qbo` | automatic w/ refresh token (100-day) | `CONNECTOR_AUTH_EXPIRED` → re-auth; previous data intact |
| Xero | OAuth 2.0 + PKCE, scopes `accounting.transactions accounting.settings` | Keychain `com.onefpa.conn.xero` | automatic (60-day) | same |
| NetSuite | OAuth 1.0a TBA (consumer key/secret + token/secret, HMAC-SHA256) | Keychain `com.onefpa.conn.netsuite` | if expired, re-issue via UI | `CONNECTOR_AUTH_EXPIRED` |
| Sage | OAuth 2.0 client-credentials/public, scopes per API | Keychain `com.onefpa.conn.sage` | automatic | same |

Security invariants: tokens never cross IPC to webview; no token in logs (Redaction logger); refresh failures surface as actionable errors, never silent.

## 6. SECURITY PARAMETERS (exact)

| Param | Value |
|---|---|
| Argon2id | m=19456 KiB, t=2, p=1, out=32B (OWASP minimum+) |
| AES-256-GCM | 12-byte IV (random per encrypt), 128-bit tag; key wrapped by PIN-derived key |
| Recovery phrase | 12 words (2048-word list), 128-bit entropy, CSPRNG |
| Session token | 256-bit random, in-memory, invalidated on lock/close |
| Auto-lock | 5 min idle (default; 1–60 min configurable) |
| Failed attempts | 5 → 30s lockout (recovery resets) |
| License | Ed25519 (Ed25519-dalek, verify-only in app, sign in vendor tooling) |
| HMAC audit | HMAC-SHA256, key in Rust (never DB); chain verified on unlock |

*Referenced by: SECURITY-CHECKLIST.md, API-SPEC.md, INTEGRATIONS.md, ENV-VARIABLES.md.*
