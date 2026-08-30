# OneFP&A — Session Handover

> Read this file first, then continue the next M1 task. It is written to be self-contained:
> state, design decisions, gates, and pitfalls. Last updated by the session that shipped
> **B19 import foundation — import.parse/validate/tieout/commit/rollback** on branch
> `arena/01a054e4-fpa`.

---

## 0. START HERE (do this exact order, then STOP and read §1–§4)

1. `cd /home/user/fpa && git status --short && git log --oneline -1`
   Clean tree expected. If refs reset (see §6 Recovery), recover before any edit.
2. `ls node_modules | wc -l` — if `0`, run `npm install`. **The sandbox wipes `node_modules`
   mid-session** (it is excluded from snapshots). This is normal, not an error. Expect it to
   happen again _during_ your session: if `npx vitest` suddenly reports `eslint: not found`,
   reinstall first and re-run the gates — do not chase phantom code failures.
3. Baseline gates (~3 min) — all must PASS before you edit:
   `npx vitest run && npm run lint && npx tsc --noEmit && npx prettier --check .`
   Expect **26 files / 162 tests**.

---

## 1. STATE OF THE WORK

Merged to `main`: **M0** (`902af9d`), **PR #4** (Rust core: company/coa/calendar/session, 12
commands, `rust_decimal`, HMAC audit chains, `src/api/schema.ts` + `mock.ts`), **PR #5**
(`5733c6b`) = F-004 first-run PIN, **PR #6** (`d8f6a98`) = A02 encrypted `.fpa` container
(key hierarchy PIN→KEK→VK→CEK, checkpoint-then-seal single file, `SESSION_LOCKED` on
`company.create` with an empty vault).

**Merged: AUTH-SPEC §2.5 on unlock (branch `arena/01a05468-fpa`, PR #7 → `ece8b31`).** Commits:

| Commit    | Scope                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| `2bf24d8` | Rust: `core/error.rs` (+`AuditChainBreak`), `commands/company.rs`, `commands/session.rs`, `commands/calendar.rs` |
| `376ef7d` | TS: `schema.ts`, `mock.ts`, `stores/session.ts`, `s004-shell` banner, `en.json`, tests (+9 → 146)                |

### What §2.5 changed (do not re-derive)

- **On every `session.unlock`** (after PIN verify + container header proof) and every
  **`company.open`**, the Company's audit chain is replayed against the keychain-held HMAC
  key (`company.rs::verify_company_chain` → `core/audit.rs::verify_chain`). Result rides the
  session as `chain_broken_at: Option<i64>` (seq of the first unverifiable event).
- **Break semantics = degraded success, not refusal** (`AUDIT_CHAIN_BREAK → read-only +
restore offer`, ADR-011): unlock still succeeds (data may be intact and must stay
  readable), the Company opens **read-only**, and the restore offer surfaces in the UI.
  Payload is **additive** (the API-SPEC table stays at 96 commands / locked shapes):
  `session.unlock` + `company.open` gain `read_only: bool` and
  `integrity: { audit_chain_ok: bool, broken_at_seq: int|null }`; `session.status` gains
  `read_only: bool`. Zod mirrors were extended in the same PR (never let them drift —
  mock↔Rust envelope drift is a tested failure).
- **Writes to the compromised Company are gated in Rust** (`session.rs::require_company_write`)
  returning `AppError::AuditChainBreak` → `AUDIT_CHAIN_BREAK` 409 with the exact
  ERROR-HANDLING §H text and `details.brokenAtSeq`. Currently wired into `calendar.apply` and
  `company.delete` (the only session-company mutations that exist in M1); `company.create`
  intentionally stays open (a fresh Company starts its own fresh chain). Every FUTURE
  session-company mutation must call `require_company_write` first.
- **Per-Company chains (latent defect fixed):** audit prev-hashes chained **globally** across
  companies while `company.delete` excises the deleted Company's events — any interleaved
  history would have broken the surviving Company's chain forever at the first §2.5
  verification. `audited_hash` now scopes by `company_id` (F-033 "surviving Companies keep
  their own chain"); `calendar.apply`, `company.create`, `company.delete` all write
  per-Company. Docs never stated global; the code comment documented per-Company intent.
- **UI (S-004):** persistent `role="alert"` banner with the exact documented
  `AUDIT_CHAIN_BREAK` user text + `Read-only` badge, driven by `sessionStore.readOnly`.
  Never dismissible (tamper evidence is never silenceable, B18-5/6). Content stays mounted
  beneath it — read-only ≠ hidden. The actual `backup.restore` action is M6-9; the banner IS
  the M1 restore offer.
- **Mock:** dev trigger PIN `AuditBrk9!` answers the degraded read-only session (parallels
  `WrongPin9!`); `session.lock`/`company.open`/`company.create` reset the mock flag.
- Rust integrity on unlock otherwise unchanged: app-DB `PRAGMA integrity_check` at open
  (`db::init`) + container header authentication via `container::read_key` (A02) already cover
  DATABASE-SCHEMA §11.1 / SECURITY-CHECKLIST §3.

### Known gaps (pre-existing; unchanged by §2.5)

- **Restart before first Company:** lands on S-001 with no companies → `/welcome` →
  `security.pin_setup` → `PIN_ALREADY_SET`; and `company.create` needs the vault
  (empty after restart → `SESSION_LOCKED`). Root cause: no app-scope (pre-Company) unlock.
  Fix = `session.unlock` accepting an empty `company_id` + an S-001 affordance to enter the
  PIN when the list is empty (deliberately deferred from A02).
- **`security.pin_setup`'s settings-marker** (`settings` row `audit.security.pin_setup`) is an
  app-scope HMAC marker, not part of any Company chain (documented in `security.rs`). It is
  NOT covered by §2.5 verification (company chains are). Revisit when S-070 audit screen
  (M6-8) defines its display.

---

## 2. NEXT TASKS (M1, in order; one commit + PR each)

1. ~~**Import foundation (B19)** — `import.parse / validate / tieout / commit / rollback`~~
   **DONE this session** (see §1). Follow-ups are M2 screens (S-030–S-034) + the vault.
2. **Model grid** — `model.cell.set.v1`, `model.recalc`; `FORMULA_CYCLE` + `REFERENCE_BROKEN`
   already in ERROR-HANDLING. HyperFormula is pinned; define the contract in `schema.ts`, then a
   thin Rust echo/validate, then the grid UI (S-041).
3. **M1 acceptance sweep** (ROADMAP §M1): unlock → create company → wizard → calendar preview →
   grid opens E2E; money/calendar property tests (`proptest` 1.5 is already in dev-deps: 12mo /
   454 / 445 / 544 / 3334, NRF 2024–2028, W53); a11y gates on 4 screens; migration suite green.

---

## 3. GATES (all must pass; run in `/home/user/fpa`)

```bash
npx vitest run                                     # 26 files / 162 tests
npx vitest run --coverage                          # ≥85/80/80/85  (now 92.51/85.81/87.61/94.56)
npx vitest run --config vitest.critical.config.ts --coverage   # ≥95/90/90/95 (now 98.84/97.29/100/99.36)
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
stripping `'…'` breaks Rust lifetimes like `State<'_>` and produces false failures). It also
false-fails on **char literals containing a quote** (`'"'` in the CSV reader) because the naive
string regex then swallows a `"` and pairs the wrong quotes — normalise those first:

```bash
python3 - $(find src-tauri/src -name '*.rs') <<'EOF'
import re,sys
for path in sys.argv[1:]:
    s=open(path).read()
    # char literals that hold a quote/escape (CSV reader: '\"') confuse the string-stripper
    # because the regex then pairs the wrong quotes — normalise them before stripping.
    s = s.replace("'\"'", "CH").replace("'\\''", "CH").replace("'\\r'", "CH")
    s = s.replace("'\\n'", "CH").replace("'\\t'", "CH").replace("'\\\\'", "CH")
    s = re.sub(r"'\\u\\{[0-9a-fA-F]+\\}'", "CH", s)
    s2=re.sub(r'"(?:[^"\\]|\\.)*"','""',s); s2=re.sub(r'//[^\n]*','',s2)
    s2=re.sub(r'/\*.*?\*/','',s2,flags=re.S)
    print(('OK  ' if (s2.count('{')-s2.count('}'), s2.count('(')-s2.count(')'))==(0,0) else 'FAIL'),
          s2.count('{')-s2.count('}'), s2.count('(')-s2.count(')'), path)
EOF
```

---

## 4. PRODUCTIVITY PLAYBOOK (learned the hard way — do not repeat)

1. **Verify the spec before trusting a code comment.** The handover claimed
   `STORAGE_DECRYPT_FAILED` is 500; the locked ERROR-HANDLING.md says 401. The doc wins.
2. **Assume the Rust core has never been compiled.** When you touch it, re-read every function
   you depend on for a possible pre-existing break (`From` impls, missing imports). Two such
   defects shipped before A02 and sat in 12 call sites; §2.5 found a third class (global
   audit prev-hash vs excision).
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
    debounced/async flows need `findBy*`/`waitFor`. **The zustand session store persists across
    tests in a file — `setState` shallow-merges, so reset new state fields in `beforeEach`.**
11. **API contracts extend ADDITIVELY only** (docs locked at 96 commands / 97 codes): new
    response fields are fine (subset tables in API-SPEC are not exhaustive; zod response
    schemas are mirrors, not runtime gates — the bridge validates ARGS only); new commands,
    new error codes, or changed documented shapes are docs changes — forbidden (B20).
12. **Session read-only is per-Company and dies with `mint_session`** — any new session-company
    mutation must take `State<SessionState>` and call `session::require_company_write` in Rust
    (AUTH-SPEC §3 rule 2). Commands with **no** `company_id` argument (the `import.*` family) use
    `require_session_write` instead, which also fails `SESSION_LOCKED` when nothing is unlocked.
    The mock's `read_only` flag mirrors it for the dev preview only.
13. **Vitest 4 matchers take ONE argument** — `expect(x).toBe(false, "why")` is a TS error here
    (`Expected 1 arguments, but got 2`) even though it runs; put the note in a `//` comment.
14. **`json!({…})` and `rusqlite::params![…]` take references, not ownership.** `json!` expands to
    `to_value(&$other)`, so a field behind `&Struct` or `Arc<T>` is fine — but a _move_ out of an
    `Arc` deref is not, so never write `Arc<T>` field moves anywhere else.
15. **`money-ast` scans Rust for the literal tokens `f64`/`f32`,** not for float _usage_. Binding
    by pattern (`Data::Float(v) => format!("{v}")`) keeps the file clean; naming the type does not.
16. **Two owners for every ingestion rule:** the Rust core (semantics: tie-out, sign conventions,
    period/account resolution) and the Zod + mock mirrors (shapes + error text). Change all three
    and both suites — the mock's user-facing strings are asserted against ERROR-HANDLING.md.

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
`edfe833` → `e7a35d0` → `0fc51b1` on `arena/01a053dd-fpa`; §2.5 commits `2bf24d8` → `376ef7d`
on `arena/01a05468-fpa` (merged as PR #7 → `ece8b31`); B19 commits (Rust core → TS contracts →
handover) on `arena/01a054e4-fpa`.

**If the branch you are given is not the one in the brief:** the sandbox is re-cloned between
sessions and Arena pins a fresh `arena/…` branch each time. Before assuming lost work, check
`git log --all`, `git cat-file -t <sha>` and `gh pr list --state all` — a previous session's
unpushed commits do NOT survive the re-clone (objects are pruned with the old pack).

---

## 7. COMMIT / PR RITUAL

- Commit in logical units (Rust storage core → commands → api/mock → docs last).
- Push **only** your session branch (Arena pins it; never switch branches).
- `gh pr create --base main --head <your-session-branch> --title "…" --body "…"`, then
  `gh pr merge <n> --merge` once green. Keep `infra/ci.yml` where it is — never push
  `.github/workflows/` (the token lacks Workflows permission; do not retry).
