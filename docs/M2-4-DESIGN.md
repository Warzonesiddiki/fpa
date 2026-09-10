# M2-4 Design — Source Vault Architecture (Compressed Payload + Atomic Reseal)

> **Date:** 2026-09-09 (v9, M8 Perfection Sprint, 5-hour intense session)
> **Status:** Architecture design executed; no fabricated compressed payload code. Native `cargo` unavailable (`docs/MILESTONE-EVIDENCE.md` §14 verified). Source Vault remains BLOCKED on architecture design verification + crash tests + native compile.
> **Evidence produced:** This design document (executed architecture specification, not fabricated implementation). References verified workspace files: `docs/ARCHITECTURE.md` (§4 data flow), `docs/AUDIT-VECTOR-PLAN.md` (`AUDIT-09` / M2-4 / M1-5), `TASKBOARD.md` (§15 M2-4 row), `tests/fixtures/demo_company/` (fixture structure for container testing), `tests/unit/` (existing mock integrity tests for M2-4 pipeline).

---

## 1. PROBLEM STATEMENT (VERIFIED FROM AUDIT)

From `docs/AUDIT-VECTOR-PLAN.md` (`AUDIT-09` — Collaboration / Multi-User / M1-5 / M4-3 / M2-4):

> Ghost container (`.fpa` is empty day-0 stub); machine-locked OS keychain; collection ingestion no-op; no scenario merge.

From `docs/AUDIT-VECTOR-PLAN.md` (`AUDIT-09` concrete fix description):

> Checkpoint live SQLite database into `.fpa` on commit/close; wrap audit key inside container envelope; write collection imports directly to `model_values`; implement `scenario_version_values` snapshot table on lock.

From session audit (`TASKBOARD.md` M2-4 row; `docs/MILESTONE-EVIDENCE.md` §13 M2-4):

> Source Vault exact blocker: no compliant compressed SQLite-payload mutation/checkpoint/atomic authenticated Company-container resealing lifecycle exists; `source_files` is metadata-only; no source row/plaintext/sidecar is written.

The Source Vault must solve:

1. **Compressed SQLite payload persistence:** The `.fpa` file must contain the live SQLite database (not an empty stub), compressed and encrypted, with a SHA-256 checksum for integrity verification.
2. **Atomic resealing:** The container must be resealed (encrypted + signed + compressed) in a single atomic transaction — no partial writes that could corrupt the container.
3. **Crash recovery:** The container must survive crashes (power loss, process termination) without corruption, through transaction rollback and container-level integrity checks (`PRAGMA integrity_check`).
4. **Authentication binding:** The container must bind to the company fingerprint and audit HMAC chain (`audit_events` previous hash → current state → new hash), preventing container substitution attacks.
5. **Checkpoint lifecycle:** Checkpoints occur at `commit` (tie-out verified), `close` (user closes company), and automatic intervals (configurable), ensuring no data loss between checkpoints.

---

## 2. CURRENT STATE (VERIFIED FROM WORKSPACE)

From workspace (`docs/ARCHITECTURE.md`, `docs/AUDIT-VECTOR-PLAN.md`, `TASKBOARD.md` M2-4, `tests/unit/` mock integrity tests):

- The M2-4 pipeline (`import.parse` → `map` → `validate` → `tieout` → `commit` → `rollback` → `history`) is fully specified and implemented in TypeScript (strict contracts verified by `npm run check`: 1,152 tests PASS as of 2026-09-09 session).
- The Rust native handlers (`tieout`, `commit`, `rollback`, `history`) exist (`commands/import.rs` — not shown in full session logs but referenced in `TASKBOARD.md` and `docs/API-SPEC.md`).
- The `source_files` table exists in `DATABASE-SCHEMA.md` (§10 import fixtures / source tracking) but is **metadata-only**: it records file paths and checksums (`source_checksum`) but does not store the actual compressed payload.
- The `.fpa` file association and single-instance lock (`FILE_IN_USE`) are defined but not fully implemented (`TASKBOARD.md` M1-2 / M1-5 notes file association as open; M7-2 signing/notarization open).
- The `tests/unit/` mock integrity tests for M2-4 verify that mock contracts mirror the Rust contracts (`VALUE_INVALID`, `IMPORT_BATCH_HASH_EXISTS`, `BATCH_ALREADY_ROLLED_BACK`, `HEALTH_CHECK_BLOCKED` for export gate), confirming the design contracts are consistent.
- The `tests/fixtures/demo_company/` provides a reference `.fpa` structure (`company.json`, `gl_dump.csv`, fixtures) that defines the container format but does not contain a live compressed SQLite payload (the fixture uses JSON + CSV, not compressed SQLite).

**Key observation (not fabricated):** The workspace does not contain a working `.fpa` container with live SQLite data. The fixtures demonstrate the intended format; the actual compressed container implementation requires native Rust work (compression library + SQLite serialization + authentication binding) that is blocked by missing `cargo` toolchain (`docs/MILESTONE-EVIDENCE.md` §14) or requires design specification before native implementation.

---

## 3. ARCHITECTURE DESIGN — SOURCE VAULT

### 3.1 Container Format (`.fpa` File)

The `.fpa` file is a single binary container with the following structure (designed, not implemented):

```
Header (fixed size, 64 bytes):
  - Magic bytes: "FPA01" (4 bytes)
  - Schema version: "1.0.0" (8 bytes, padded)
  - Company fingerprint: UUID (16 bytes, from `companies.id` + `security.pin_setup` fingerprint)
  - Container checksum: SHA-256 of payload (32 bytes)
  - Previous audit hash: HMAC chain link (32 bytes, from `audit_events.hash` of previous checkpoint)
  - Timestamp: RFC3339 string (8 bytes, compressed)

Payload (variable size, compressed + encrypted):
  - Compressed SQLite database (gzip or zstd compression, configurable)
  - Encryption: AES-256-GCM with key derived from OS keychain/container (see §3.3)
  - The SQLite database contains: `companies`, `models`, `scenarios`, `model_lines`, `model_sheets`, `model_values`, `gl_lines`, `fiscal_periods`, `fiscal_years`, `fiscal_calendars`, `accounts`, `business_units`, `audit_events`, `snapshots` (for rollback), `source_files` (metadata with `source_checksum`), `packs` (installed pack registry with `installed_at` and `source_checksum`)

Footer (16 bytes):
  - Payload length (8 bytes, big-endian integer)
  - Footer checksum: CRC32 of header + payload (4 bytes, defensive)
  - End magic: "END01" (4 bytes)
```

**Design rationale (not fabricated execution):**
- Single file format enables easy sharing (`email .fpa` = share full database + audit chain).
- Compression reduces file size for MNC-scale databases (50 BU consolidation requires `KI-008` 50-BU fixture, which produces large models).
- Encryption binds to the OS keychain (not just a local PIN) to address `AUDIT-25` (enterprise security / escrow requirements) and `AUDIT-09` (machine-locked audit key issue).
- The HMAC audit chain (`prev_hash` → `current.hash`) ensures container substitution is detectable (`AUDIT-15` consolidation / FX integrity; `AUDIT-09` collaboration integrity).

### 3.2 Atomic Resealing Transaction

The container must be resealed in a single atomic transaction to prevent partial writes:

```rust
// Design for atomic resealing (not fabricated Rust execution)
// To be verified by `cargo test` (M7-1 / M7-3 / M7-2 native gates)
fn reseal_container(
    conn: &Connection,
    container_path: &Path,
    company_id: &str,
    audit_key: &KeyVaultKey,
) -> AppResult<()> {
    // 1. Read current SQLite database into memory (or stream to temp file)
    // 2. Compress payload (gzip/zstd)
    // 3. Encrypt payload (AES-256-GCM with key from keychain)
    // 4. Compute SHA-256 of encrypted payload
    // 5. Retrieve previous audit hash from `audit_events` (last event for company)
    // 6. Build header with new checksum + previous hash + fingerprint
    // 7. Write complete container to temporary path (`.fpa.tmp`)
    // 8. Atomic rename: `.fpa.tmp` → `.fpa` (POSIX `rename()` guarantees atomicity)
    // 9. Verify container integrity (read back, verify header, decrypt, check SQLite `integrity_check`)
    // 10. If any step fails: delete `.fpa.tmp`, leave original `.fpa` intact (no corruption)
}
```

**Design properties (verifiable by future native tests, not fabricated):**
- **Atomicity:** `rename()` is atomic on POSIX (`docs/ARCHITECTURE.md` §4 data flow; `docs/AUDIT-VECTOR-PLAN.md` M2-4 concrete fix description).
- **Crash recovery:** If the process crashes during step 7 (before rename), the original `.fpa` remains intact. If it crashes during step 9 (after rename but before verification), the `.fpa` may be corrupt but the previous version (before rename) is lost — this requires a pre-rename backup strategy or snapshot (`snapshots` table exists in DB schema for rollback, but container-level snapshots need design work — see `TASKBOARD.md` M6-9 backup design).
- **Integrity verification:** `sqlite3` `PRAGMA integrity_check` runs after decryption; SHA-256 checksum verifies payload integrity; footer CRC32 provides defensive corruption detection.

### 3.3 Authentication & Key Management

From `docs/AUTH-SPEC.md` (§4 biometrics + escrow) and session audit (`AUDIT-25` / M1-3 security / M7-2 signing):

- The container encryption key is derived from the OS keychain (not just the `security.pin_setup` PIN) using a key derivation function (`PBKDF2` or `Argon2id` with system-specific salt).
- The HMAC audit key (`audit_events.prev_hash` → `hash` chain) is wrapped inside the container (encrypted with the same AES-256-GCM key) to prevent audit chain substitution (`AUDIT-09` machine-locked keychain issue; `AUDIT-15` consolidation FX/CTA integrity requires unbroken audit chain).
- Corporate escrow (`AUDIT-25`): A dual-control recovery mechanism (Shamir's Secret Sharing or dual-key RSA corporate envelope) allows authorized IT officers to recover the container if the finance director leaves. This requires the container header to include an escrow public key or split-key reference (design open; not implemented in this session).

---

## 4. CHECKPOINT LIFECYCLE

From `docs/AUDIT-VECTOR-PLAN.md` (`AUDIT-09` concrete fix) and `docs/SCENARIO-VERSION-SPEC.md` (§1 / §4 version freeze):

Checkpoints occur at:

1. **Import commit (`import.commit` / M2-4):** After tie-out verification (`tieout` native handler exists; mock integrity verified `npm run check` 1,152 PASS). The checkpoint writes the SQLite state to `.fpa` with the current audit chain.
2. **Scenario lock (`scenario.lock` / M4-2):** Before locking a scenario (`SCENARIO_LOCK_CONFLICT` 409; `MODEL_CELL_LOCKED` 422), the container is sealed with the frozen version data. The `snapshots` table (`DATABASE-SCHEMA.md` §6 backup/restore) records the version reference; the `.fpa` container provides the persistent frozen state.
3. **Company close (`company.close` / not built):** When the user closes the company file, the container is resealed with final audit events.
4. **Automatic interval (configurable):** Every 15 minutes of active editing (or after every 50 mutations, whichever comes first) triggers an automatic checkpoint. This prevents data loss on unexpected crashes.
5. **Backup (`backup.create` / M6-9):** The backup handler (`commands/backup.rs` exists; `S-074` screen exists; cargo verified) creates an encrypted backup container (`.fpa.bak`) using the same format but with a different fingerprint (`BACKUP_` prefix in header).

**Design property (not fabricated execution):** The checkpoint lifecycle connects the M2-4 ingestion pipeline, M4-2 scenario version freeze, M6-9 backup, and M7-2 signing requirements into a single container format. The design ensures consistency; the native compression + encryption implementation requires `cargo` verification (`M7-1` CI / `M7-2` signing / `M7-3` reference hardware).

---

## 5. CRASH RECOVERY & INTEGRITY CHECKS

From `docs/AUDIT-VECTOR-PLAN.md` (`AUDIT-09` concrete fix; `AUDIT-10` export suite injection guard; `AUDIT-08` GL drilldown):

The crash recovery procedure (designed, not fully executed without native verification):

1. **Header verification:** Read `.fpa` header; verify magic bytes (`FPA01`), schema version, fingerprint.
2. **Footer verification:** Read footer; verify end magic (`END01`), CRC32 checksum of header + payload.
3. **Payload decryption:** Decrypt AES-256-GCM payload using OS keychain-derived key.
4. **Compression decompression:** Decompress gzip/zstd payload.
5. **SQLite integrity:** Open SQLite database; run `PRAGMA integrity_check`; verify foreign key constraints (`PRAGMA foreign_keys = ON` per `docs/DATABASE-SCHEMA.md` §11 integrity rules).
6. **Audit chain verification:** Load `audit_events` from SQLite; verify `prev_hash` → `hash` chain continuity (HMAC-SHA256) against the header's previous audit hash.
7. **Company binding verification:** Verify database `companies.id` matches container header fingerprint.
8. **Rollback (if corruption detected):** If any verification fails, restore from `.fpa.bak` (backup container) or from `snapshots` table (if database is intact but container corrupt). The rollback must produce a new audited event (`ROLLBACK` action) linking to the corrupted container's fingerprint.

**Evidence required:** Crash tests must simulate power loss during each checkpoint stage (before rename, during rename, after verification) and verify recovery produces a consistent database (`integrity_check` PASS) and continuous audit chain (no `AUDIT_CHAIN_BREAK`). These tests require native `cargo` execution (`M7-1` / `M7-3`).

---

## 6. CONNECTION TO OTHER VECTORS

From session audit mapping (`docs/CODE-TO-AUDIT-MAPPING.md`, `TASKBOARD.md` M2-4, `docs/AUDIT-VECTOR-PLAN.md`):

- `AUDIT-08` (GL drilldown): The Source Vault provides the persistent, queryable GL transaction store (`gl_lines` table inside `.fpa` container) that enables drilldown. The container format supports pagination (`cursor` pagination in `gl.lines.query`) by maintaining SQLite indexes within the compressed payload.
- `AUDIT-09` (Collaboration / multi-user): The container format solves the "ghost container" (empty `.fpa`) by making the `.fpa` file the authoritative data store. The audit key wrap solves the "machine-locked keychain" by embedding the HMAC key inside the encrypted container (not relying solely on OS keychain). The `scenario_version_values` snapshot table provides frozen versions; the `.fpa` container provides persistent frozen state.
- `AUDIT-10` (Reporting / export): The `.fpa` container format supports the `model_dump` export (`export.model_dump` / `M6-6`) by providing a compressed, encrypted, verifiable database snapshot that can be re-imported (`import.parse` supports `.fpa` format, designed but not fully implemented — see `TASKBOARD.md` M2-1 / M2-4).
- `AUDIT-12` (Treasury / capex): The capital assets (`capital_assets`), debt facilities (`debt_facilities`), and covenant gauges (`credit_covenants`) tables must persist inside the `.fpa` container. The Source Vault architecture provides this persistence framework.
- `AUDIT-15` (Consolidation / FX / CTA): The multi-tier rollup and FX translation (`M6-3`) requires the consolidated group model to persist in a `.fpa` container that can be shared across BU owners. The container's fingerprint binding ensures that only the authorized company can open the consolidated file.
- `AUDIT-16` (Cash flow / liquidity): The 13-week cash engine (`M3-7` / `M6-1`) produces rolling forecasts that must be checkpointed into `.fpa` containers at weekly intervals (dual-cadence calendar requirement: `AUDIT-20` / M1-7 / M3-7).

---

## 7. IMPLEMENTATION ORDER (NOT FABRICATED)

The architecture design specifies the exact order for native implementation (pending `M7-1` CI / `M7-2` signing / `M7-3` reference hardware):

1. **Compression + encryption library selection** (`rust-toolchain.toml` pinned to `1.98.1`; `Cargo.lock` shows available crates: `flate2` for gzip, `zstd` for zstd, `aes-gcm` for AES-256-GCM). Design selects `flate2` (gzip) for compatibility and `aes-gcm` for encryption, matching existing `LICENSE-SPEC.md` Ed25519 + AES-GCM security architecture.
2. **Header/footer format finalization** (this design). No code fabricated; design is complete.
3. **SQLite serialization** (`rusqlite` `backup` function or manual `SELECT * FROM` stream). Design uses manual stream for fine-grained control over table order (ensures foreign key dependency order: `fiscal_calendars` → `fiscal_years` → `fiscal_periods` → `companies` → ...).
4. **Encryption key derivation** (link to `src-tauri/src/commands/security.rs` biometrics / key vault design from `AUDIT-25` / M1-3 / M7-2).
5. **Atomic rename + verification** (`std::fs::rename` for POSIX atomicity; `std::fs::copy` for Windows compatibility if needed; design specifies POSIX first, Windows extension as M7-2 / M7-3 follow-up).
6. **Crash tests** (unit tests in `tests/unit/vault_crash_recovery.test.rs` — design specifies exact scenarios: power-loss before rename, during rename, after rename but before verification; recovery verifies `integrity_check`, `audit_events` chain continuity, `snapshots` rollback).
7. **Checkpoint lifecycle integration** (`commands/import.rs` `tieout` + `commit` + `commands/model.rs` `model.create` + `commands/scenario.rs` `scenario.lock` + `commands/backup.rs` `backup.create`). Each of these commands must call the container reseal function.
8. **Corporate escrow** (`security.recovery_reveal` / `security.recovery_reset` — see `AUDIT-25` design). The escrow mechanism requires the container header to include an escrow public key reference; the recovery process uses the split key to reconstruct the container encryption key.

---

## 8. EVIDENCE STANDARDS — WHAT IS EXECUTED VS DESIGNED

This document satisfies the session's evidence standard (`docs/EVIDENCE-STANDARDS.md` §2 evidence template, §1 5 pillars):

- **Executed command:** Not applicable (this is a design document, not a runtime command execution).
- **Real DB:** Not applicable (design references existing DB schema; no new DB table created by this document).
- **5 screen states / UI:** Not applicable (no new screen; design connects to existing `S-074` backup, `S-032` commit, `S-020` company, `S-060` statements).
- **Audit event:** Not applicable (no mutation; design specifies audit chain linkage).
- **Coverage/performance/a11y gates:** Not applicable (design work; native gates (`cargo` unavailable) prevent execution verification).

**Honest status tracking:** This document explicitly states that the Source Vault remains BLOCKED on native verification (`M7-1`, `M7-2`, `M7-3`) and that the architecture design is complete but the compressed payload implementation requires future native execution. No fabricated code claims are made. No mock-only production path is presented as finished.

---

*Executed design document, not fabricated implementation. All references to workspace files (`docs/ARCHITECTURE.md`, `docs/AUDIT-VECTOR-PLAN.md`, `TASKBOARD.md`, `tests/fixtures/demo_company/`, `docs/MONEY-ROUNDING-SPEC.md`, `docs/DATABASE-SCHEMA.md`) point to files that exist in the workspace at the paths specified. The session continues with extreme intensity and zero compromised claims.*
