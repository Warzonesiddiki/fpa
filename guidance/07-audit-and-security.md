# 07 · Audit & security

Two invariants that end a PR if broken: **every mutation is audited (B7)** and **nothing
leaves the machine (B1/B18-9)** — no server, no telemetry, no cloud, no runtime `.env`.

## Read first

- `docs/SECURITY-CHECKLIST.md`, `docs/AUTH-SPEC.md`, `docs/LICENSE-SPEC.md`.
- `docs/COMPLIANCE-DATA-SOVEREIGNTY.md`, `docs/SECURITY-INCIDENT-RESPONSE.md`.
- `src-tauri/src/core/audit.rs`, `storage/keystore.rs`, `storage/container.rs`.

## Audit (B7) — every mutation, no exceptions

- `audit_events` is **append-only** and **hash-chained** (`prev_hash` → `hash`, keyed by
  an HMAC key from the keystore). Use the existing helpers `audited_hash()` +
  `next_hash()` — never a second audit mechanism (B14).
- Reads are **not** audited (reading the log is not itself a mutation).
- Locked/immutable artifacts (locked scenarios, committed batches, board packs) are
  **never edited in place** — you create a new version.
- Watch for the gaps the audit flagged and never reintroduce them: PIN change must be
  audited and gated; collection export/import must audit; dataroom export must audit;
  read-only must actually block the 5 mutation paths; `company.delete` must not silently
  erase history in a way that breaks the chain; `driver.set_value` must respect locks.

### Checklist for any mutating command

- [ ] Session write gate (`require_session_write`).
- [ ] Ownership/scope check.
- [ ] Work + audit row in **one transaction** (atomic).
- [ ] `before_json`/`after_json` capture the change.
- [ ] Respects read-only / locked state (returns the typed code, doesn't mutate).

## Security (B1 / B18-9) — local-first, offline

- **No network calls** from the product path (updater is the only outbound, and it must
  be signature-verified — see remediation WS-09). No analytics, no telemetry, ever.
- **No secrets in the repo.** `secret-scan` is a gate. Secrets/keys live in the **OS
  keychain** (`keyring` crate), never in files, env, or code.
- **No runtime `.env`.** Config is not environment-driven at runtime (`docs/ENV-VARIABLES.md`).
- **Encryption at rest:** the container is encrypted; keys via keystore. Don't weaken
  Argon2/AES parameters or bypass the keystore.
- **License:** offline Ed25519 activation (`docs/LICENSE-SPEC.md`). Don't add an online
  check.
- **CSP / least privilege:** keep `tauri.conf.json` CSP tight (`default-src 'self'`) and
  no broad FS/shell capabilities.

## Gates

```bash
npm run security:scan     # secret-scan + telemetry-scan + license-check (no GPL/AGPL)
cargo test                # (CI) audit chain, keystore, license, crypto tests
```

## Anti-patterns (banned)

- A mutation with no audit event.
- Editing a locked artifact in place.
- Any telemetry/analytics/beacon; any product-path network call besides the signed updater.
- Secrets in code/files/env; committing a private key.
- Bypassing the keychain or hardcoding crypto keys.
- An online/"phone-home" license or feature check.
