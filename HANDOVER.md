# OneFP&A — Session Handover

> Read this file first, then continue the next M1 task. It is written to be self-contained:
> state, design decisions, gates, and pitfalls. Last updated by the session that shipped the
> **encrypted `.fpa` container (SECURITY-CHECKLIST A02)** on branch `arena/01a053dd-fpa`.

---

## 0. START HERE (do this exact order, then STOP and read §1–§4)

1. `cd /home/user/fpa && git status --short && git log --oneline -1`
   Clean tree expected. If refs reset (see §6 Recovery), recover before any edit.
2. `ls node_modules | wc -l` — if `0`, run `npm install`. **The sandbox wipes `node_modules`
   mid-session** (it is excluded from snapshots). This is normal, not an error. Expect it to
   happen again *during* your session: if `npx vitest` suddenly reports `eslint: not found`,
   reinstall first and re-run the gates — do not chase phantom code failures.
3. Baseline gates (~3 min) — all must PASS before you edit:
   `npx vitest run && npm run lint && npx tsc --noEmit && npx prettier --check .`
   Expect **26 files / 137 tests**.

---

## 1. STATE OF THE WORK

Merged to `main`: **M0** (`902af9d`), **PR #4** (Rust core: company/coa/calendar/session, 12
commands, `rust_decimal`, HMAC audit chains, `src/api/schema.ts` + `mock.ts`), **PR #5**
(`5733c6b`) = F-004 first-run PIN (`security.pin_setup`, `validate_pin_policy`, PIN gate on
`company.create`, `/welcome` + `/wizard` routes).

**This session (branch `arena/01a053dd-fpa`, 3 commits) — A02 encrypted `.fpa` container:
NOT YET MERGED at the time of writing (open PR).** Commits:

| Commit | Scope |
|---|---|
| `edfe833` | `storage/keys.rs` (new), `storage/container.rs` (new), `storage/mod.rs`, `storage/db.rs`, `storage/keystore.rs`, `core/error.rs`, `Cargo.toml` |
| `e7a35d0` | `commands/session.rs`, `commands/security.rs`, `commands/company.rs`, `lib.rs` |
| `0fc51b1` | `src/api/mock.ts`, `src/api/mock.test.ts` (mock ↔ core status alignment) |

### What A02 changed (do not re-derive)

- **Key hierarchy — two tiers, deliberately:**
  `PIN ──Argon2id(salt)──▶ KEK ──AES-256-GCM──▶ vault key (VK) ──AES-256-GCM──▶ Company key (CEK) ──▶ .fpa payload`
  The PIN-derived key wraps **one** random vault key; the vault key wraps each Company's file
  key. `security.change_pin` therefore re-wraps a single key instead of every Company file
  (AUTH-SPEC §2.4). The KEK is zeroised immediately after each use; the VK lives only in the
  in-memory `KeyVault` between unlock and lock.
- **`pin_metadata.argon2_params_json` is now a JSON record**, not a bare PHC string:
  `{phc, m, t, p, salt, nonce, wrappedVaultKey}` (camelCase, base64url). Both readers
  (`session.rs::load_pin_row`, `security.rs::security_change_pin`) go through
  `PinRecord::from_json`. A record whose `m/t/p` were weakened is rejected outright
  (`params_are_spec`) — A02 "no weak mode".
- **`.fpa` format v1** (`storage/container.rs`, documented in the module header):
  `magic "ONEFPA01" | version 1 | cek_nonce 12B | cek_sealed 48B (AAD = 0..21) |
  payload_nonce 12B | payload (AAD = 0..69)`. Every header byte is either inside a GCM tag or
  used as that tag's AAD.
- **WAL decision (SECURITY-CHECKLIST §3 "WAL in same encrypted container"): checkpoint-then-seal,
  single file.** The image is built from a `PRAGMA wal_checkpoint(TRUNCATE)`-ed database, so
  journal bytes live inside the one sealed file; no `-wal`/`-shm` sidecar is ever stored beside
  it, and no plaintext database is written next to the container — `session.lock` has nothing to
  scrub (AUTH-SPEC §2.3). **M1 boundary:** `company.create` seals the image, `company.open`
  authenticates it; nothing writes Company data into the image yet (that is M2 ingestion).
- **Command wiring:** `session.unlock` unwraps the VK and proves the container opens with it
  (`container::read_key`) before caching anything → a Company file sealed under another PIN is
  `STORAGE_DECRYPT_FAILED` and nothing is cached. `company.create` seals **inside** the Company
  transaction (row and file can never diverge) and refuses to overwrite (`STORAGE_FILE_EXISTS`).
  `company.open` decrypts + checks the SQLite magic (`STORAGE_FILE_CORRUPT`). `company.delete`
  removes the sealed file. `session.lock` clears + zeroises the vault.
- **`company.create` now needs an unlocked vault** → returns `SESSION_LOCKED` when the vault is
  empty. This is spec-correct (API-SPEC row 33 requires a session) and works in the real
  first-run flow because `security.pin_setup` puts the VK in the vault for that process run.

### Three latent defects fixed along the way (the crate had never been compiled)

1. `db.rs::open_at/open_in_memory` returned `Result<_, String>`; there is no
   `From<String> for AppError`, so **all 12 `db::open_at(...).map_err(AppError::from)?` call
   sites failed to compile**. The openers now return `AppResult<Connection>`; the existing call
   sites compile unchanged via the reflexive `From<T> for T`.
2. `storage/keystore.rs` used `OsRng` without `use rand::rngs::OsRng;`.
3. `AppError::DecryptFailed` emitted `STORAGE_DECRYPT_FAILED` as **500** with the wrong text.
   ERROR-HANDLING.md §B (locked) says **401** and `"The Company file cannot be decrypted with
   this PIN."` — both Rust and the dev mock now match, and `mock.test.ts` asserts all four
   envelope fields so they cannot drift again.

Added `AppError::FileExists` → `STORAGE_FILE_EXISTS` (409) — a pre-defined code, reused.

### Known gap (pre-existing, now with a second symptom)

Restarting the app **after** `security.pin_setup` but **before** any Company exists lands on
S-001 with no companies → "first run" → `/welcome` → `security.pin_setup` → `PIN_ALREADY_SET`.
With A02 this path also cannot reach `company.create` (vault empty after restart →
`SESSION_LOCKED`). Both symptoms have one root cause: there is no app-scope (pre-Company)
unlock command. Fixing it needs `session.unlock` to accept an empty `company_id` (its
API-SPEC arg list is `pin` only) **plus** an S-001 affordance to enter the PIN when the company
list is empty. Not done here — out of A02's scope.

---

## 2. NEXT TASKS (M1, in order; one commit + PR each)

1. **AUTH-SPEC §2.5 on unlock** — `integrity_check` + audit-chain verification
   (`AUDIT_CHAIN_BREAK` → read-only + restore offer). Small now that unlock is centralised.
2. **Import foundation (B19)** — `import.parse / validate / tieout / commit / rollback`,
   GL-Dump-first pipeline. `gl_lines` + `import_batches` exist in `migrations/001_initial.sql`;
   codes exist (`IMPORT_FILE_UNREADABLE` 422 …). New `commands/import.rs`.
3. **Model grid** — `model.cell.set.v1`, `model.recalc`; `FORMULA_CYCLE` + `REFERENCE_BROKEN`
   already in ERROR-HANDLING. HyperFormula is pinned; define the contract in `schema.ts`, then a
   thin Rust echo/validate, then the grid UI (S-041).
4. **M1 acceptance sweep** (ROADMAP §M1): unlock → create company → wizard → calendar preview →
   grid opens E2E; money/calendar property tests (`proptest` 1.5 is already in dev-deps: 12mo /
   454 / 445 / 544 / 3334, NRF 2024–2028, W53); a11y gates on 4 screens; migration suite green.

---

## 3. GATES (all must pass; run in `/home/user/fpa`)

```bash
npx vitest run                                     # 26 files / 137 tests
npx vitest run --coverage                          # ≥85/80/80/85  (now 92.25/85.82/87.78/94.39)
npx vitest run --config vitest.critical.config.ts --coverage   # ≥95/90/90/95 (now 98.68/97.19/100/99.27)
npm run lint                                       # eslint --max-warnings 0
npx tsc --noEmit
npm run build
npx prettier --check .
node scripts/docs-verify.mjs                        # 53 docs / 42 screens / 96 commands / 97 codes
node scripts/money-ast.mjs
node scripts/secret-scan.mjs
node scripts/pack-validate.mjs                      # 12/12
node scripts/license-check.mjs
```

Rust: **there is no Rust toolchain in the sandbox and the network blocks rustup
(`sh.rustup.rs` and `static.rust-lang.org` both fail; only the npm registry is reachable), and
CI never runs for this repo (Actions disabled; `infra/ci.yml` stays put — never push
`.github/workflows/`). Your hand-review IS the compile gate.**

Brace/balance check after **every** Rust edit (note: strip only string literals and comments —
stripping `'…'` breaks Rust lifetimes like `State<'_>` and produces false failures):

```bash
python3 - <<'EOF'
import re,sys
for path in sys.argv[1:]:
    s=open(path).read()
    s2=re.sub(r'"(?:[^"\\]|\\.)*"','""',s); s2=re.sub(r'//[^\n]*','',s2)
    s2=re.sub(r'/\*.*?\*/','',s2,flags=re.S)
    print(('OK  ' if (s2.count('{')-s2.count('}'), s2.count('(')-s2.count(')'))==(0,0) else 'FAIL'),
          s2.count('{')-s2.count('}'), s2.count('(')-s2.count(')'), path)
EOF
$(find src-tauri/src -name '*.rs')
```

---

## 4. PRODUCTIVITY PLAYBOOK (learned the hard way — do not repeat)

1. **Verify the spec before trusting a code comment.** The handover claimed
   `STORAGE_DECRYPT_FAILED` is 500; the locked ERROR-HANDLING.md says 401. The doc wins.
2. **Assume the Rust core has never been compiled.** When you touch it, re-read every function
   you depend on for a possible pre-existing break (`From` impls, missing imports). Two such
   defects shipped before A02 and sat in 12 call sites.
3. **`node_modules` wipes mid-session.** Reinstall and re-run; don't debug ghosts.
4. **`npm install` rewrites `package-lock.json`** (`dev` → `devOptional` churn from newer npm).
   `git checkout -- package-lock.json` before committing if you did not intend a lockfile change.
5. **Read the component + i18n keys BEFORE writing tests** — enumerate real roles/text from the
   JSX and `src/i18n/en.json` first.
6. **`mockRejectedValue` (non-`Once`) spuriously fails Vitest as an "unhandled rejection"** even
   when the component catches it — use `mockRejectedValueOnce`.
7. **Pin policy has TWO mirrored owners:** Rust `validate_pin_policy` (`commands/session.rs`)
   and TS `validatePinPolicy`/`pinPolicyChecks` (`src/api/schema.ts`). Change both + both suites.
   Same rule now applies to **key material**: `storage/keys.rs` is the only place secrets may be
   handled — do not hand-roll crypto or a second key cache anywhere else (B14).
8. **Route taxonomy:** `/welcome` = first-run PIN, `/wizard` = S-002 wizard, `/` = S-001 unlock.
   Never point "New Company" at `/welcome`.
9. **money-ast:** `Number(` banned in `src/` (use `parseInt(x, 10)`); `f64`/`f32` banned in
   `src-tauri/src/`; `.toFixed(` only in `utils/money.ts`.
10. **Vitest quirks:** keep error-path and flow-path tests in separate files; the first pack
    auto-selects in S-023 (scope by role+regex); multiple companies → `getAllByRole(...)[0]`;
    debounced/async flows need `findBy*`/`waitFor`.

---

## 5. STANDING RULES

Zero-compromise, specs-first: the 54 docs in `docs/` are locked (start DOCS-INDEX →
ARCHITECTURE → API-SPEC → ROADMAP → ZERO-COMPROMISE-RULES). Never re-open closed doc issues
(B20). Money/calendar logic has exactly one owner: the Rust core; the UI formats only. Every
screen needs 5 states (loading/empty/error/success/populated). All 97 error codes are defined —
reuse them, never invent. Money = exact integers/Decimal strings via `rust_decimal` (never
REAL/float — B3/I1). PIN policy = ≥8 chars, ≥2 classes, no sequential run ≥4, enforced in Rust
AND the zod gate. 15 technologies locked (B13/B14) — **do not add a dependency that is not in
TECH-STACK.md** (this is why A02 hand-rolls `zeroize()` instead of adding the crate). Local-first,
no network in shipped code (B18-9). UX production-grade.

---

## 6. SANDBOX RECOVERY

Symptom: `git status` shows already-committed changes as modified/untracked, `git log` shows an
old HEAD, reflog only has clone/checkout, `node_modules` empty. Files and git **objects**
persist; only refs/index/node_modules reset.

```bash
git reflog -8                                  # confirm reset
git cat-file -t <known-last-commit-sha>        # objects usually still exist
git reset --hard <known-last-commit-sha>       # restores ref + index
git merge origin/main                          # fast-forward to merged-PR state
git push origin <your-session-branch>
npm install
```

Known anchors: `085359b` (pre-PR#4) → merge → `902af9d`; F-004 ended at `5733c6b`; A02 commits
`edfe833` → `e7a35d0` → `0fc51b1` on `arena/01a053dd-fpa`.

---

## 7. COMMIT / PR RITUAL

- Commit in logical units (Rust storage core → commands → api/mock → docs last).
- Push **only** your session branch (Arena pins it; never switch branches).
- `gh pr create --base main --head <your-session-branch> --title "…" --body "…"`, then
  `gh pr merge <n> --merge` once green. Keep `infra/ci.yml` where it is — never push
  `.github/workflows/` (the token lacks Workflows permission; do not retry).
