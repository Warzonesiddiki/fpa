# LICENSE-SPEC.md

> OneFP&A · v1.0.0 · **Offline Ed25519 licensing & activation (PRD F-035, SCREENS-SPEC S-073).** No network dependency (B18-9): activation is a signed file exchange, verified entirely on-device. Grace period 60 days (DECISIONS.md). Machine binding where the payload carries a fingerprint.

---

## 1. PROTOCOL (activation file exchange)

1. **Request.** S-073 → `license.request_file {company_path}` writes
   `<company_path>.license-request.json` next to the Company file:
   `{company_id, machine_fingerprint, license_pubkey_hex, app_version, created_at}`.
   The user hands this file to the vendor (any channel — it is data, not a secret).
2. **Signing.** The vendor signs the **response payload** (below) with the license
   private key and returns the signed JSON (file or pasted text).
3. **Apply.** S-073 → `license.apply_response {response_path_or_payload}` (file path or
   raw JSON string). The core verifies, binds, and persists. `license.verify
   {license_payload}` is the session-less preview variant (signature + expiry only —
   there is no active Company to bind to before unlock).

## 2. RESPONSE PAYLOAD

| Field | Type | Notes |
|---|---|---|
| `license_key_id` | string | Unique key id (persists as `licenses.license_key_id`, UNIQUE) |
| `licensed_company_hash` | string | **The licensed Company's UUID, verbatim** (see §Binding — the "hash" in the name is legacy) |
| `plan` | `pro` \| `enterprise` | `licenses.plan` CHECK constraint |
| `expires_at` | RFC3339 UTC string | e.g. `2099-12-31T23:59:59Z` |
| `machine_fingerprint` | string | Empty string = not machine-bound; otherwise must equal the local fingerprint (§Fingerprint) |
| `signature` | base64, 64 bytes | Ed25519 over the canonical bytes (§Canonical payload) |

## 3. CANONICAL PAYLOAD (the signed bytes)

Object keys **sorted byte-wise at every level**, no whitespace, JSON string escaping
(`\"` `\\` `\n` `\r` `\t`, control chars as `\uXXXX`), and the **`signature` key
ABSENT** (never null). Rust `canonical_payload` and
`scripts/gen-license-fixtures.mjs::canonicalize` are byte-identical oracles — the
fixture self-verify + Rust unit test `canonical_payload_matches_the_fixture_signature_bytes`
pin the parity.

## 4. VERIFICATION ORDER (`evaluate_license`)

Any step failing → `LICENSE_INVALID_SIGNATURE` (403, not retryable):

1. Ed25519 signature over the canonical bytes (public key §Key custody).
2. **Company binding:** `licensed_company_hash` equals the active Company's id —
   direct, constant-time comparison.
3. **Machine binding:** non-empty `machine_fingerprint` must equal the local one.
4. **Expiry:** `expires_at` → status (§Statuses). Past grace → `LICENSE_EXPIRED`
   (403, not retryable). Only `active`/`grace` are persisted.

## 5. BINDING (column contract)

`licenses.licensed_company_hash` stores the **Company UUID directly** — that is the
locked join of `company.list`
(`COALESCE((SELECT l.status FROM licenses l WHERE l.licensed_company_hash = c.id), 'invalid')`,
`company.rs`). Payload field, column, and join all carry the UUID; the "hash" naming
is legacy and must not be "fixed" without changing the join (would break the status
lookup).

## 6. STATUSES

| status | Meaning | UI (S-073) |
|---|---|---|
| `active` | `now < expires_at` | favourable badge "Valid" |
| `grace` | expired, `now < expires_at + 60d` (GRACE_DAYS, DECISIONS.md) | warning badge + countdown; still functional |
| `expired` | past the 60-day window | `LICENSE_EXPIRED`; Company read-only |
| `invalid` | no row, or a rejected payload | "Not activated" (empty state) |

`session.status.license` re-evaluates the persisted row against the **current clock**
(`license_status_json`), so grace → expired transitions happen without re-activation.
`expires_at` NULL = perpetual → `active`, `days_left` 0 (DATABASE-SCHEMA `licenses`).
MONITORING: grace < 30 days = warning banner.

**Known gap (tracked in TASKBOARD M1-4):** the AUTH-SPEC §2.5 capability matrix maps
"license grace/expired" → read-only, but the core write-gates do not yet enforce it —
`session.read_only` is derived from the audit-chain verdict only. S-073 displays the
read-only notice; enforcement across write commands is a follow-up unit.

## 7. FINGERPRINT

`sha256("fp:" + OS + ":" + user + ":" + hostname)` → `fp-<hex>`. Stable per machine;
deliberately no hardware serials (privacy, B18-9). S-073 shows it in the populated
state (it only exists inside the persisted license row).

## 8. KEY CUSTODY

- **Production:** the public key (raw 32 bytes) is embedded in `license.rs`
  (`PROD_LICENSE_PUBKEY_HEX`, deterministic seed
  `onefpa-prod-license-key-seed-00000000000001`). The matching private key is the
  licensor's secret and is **never committed**.
- **Dev/CI override:** `ONEFPA_LICENSE_PUBKEY` env var (raw 32-byte hex) selects the
  verification key — how the test fixture keypair (below) is exercised end-to-end.
  Explicit, documented affordance: without the matching private key nobody can mint a
  license for that public key.
- **Fixtures:** `tests/fixtures/license/keys.json` commits a clearly-marked
  TEST-ONLY keypair (deterministic seed
  `onefpa-test-license-key-seed-00000000000001`) — fixtures must be regenerable and
  verifiable in CI without external secrets.

## 9. AUDIT

`license.apply_response` upserts `licenses` **and** writes an HMAC-chained
`audit_events` row (`license.apply_response`, object `license`) in the **same
transaction** (B18-1). `license.request_file` and `license.verify` are read-only
(no DB mutation, no audit event).

## 10. FIXTURES

`npm run fixtures:gen:license` → `tests/fixtures/license/`:
`license-valid.json`, `license-grace.json`, `license-expired.json`,
`license-invalid-signature.json`, `license-machine-mismatch.json`, `keys.json`,
`expected.json` (SHA-256 of every file + expected statuses as of `2026-08-31`).
Byte-identical across runs (fixed seeds). Time pin: the grace fixture expires
`2026-07-20` → `grace` as of 2026-08-31 (42 days) and `expired` after 2026-09-18;
the core's status function is pure and tested at injected times, so CI stays
time-independent.

## 11. COMMANDS (API-SPEC catalog rows)

| Command | Session | Args | Returns | Errors |
|---|---|---|---|---|
| `license.verify` | none | `{license_payload}` | `{status, days_left}` | LICENSE_INVALID_SIGNATURE, LICENSE_EXPIRED |
| `license.request_file` | unlocked | `{company_path}` | `{file}` | VALUE_INVALID (unknown path) |
| `license.apply_response` | unlocked | `{response_path_or_payload}` | `{status, plan, days_left}` | LICENSE_INVALID_SIGNATURE, LICENSE_EXPIRED, IMPORT_FILE_UNREADABLE |

*Referenced by: PRD F-035, SCREENS-SPEC S-073, API-SPEC, DATABASE-SCHEMA (licenses), ERROR-HANDLING, DECISIONS, TEST-FIXTURES-SPEC, MONITORING.*
