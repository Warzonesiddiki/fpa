# OneFP&A — Project Analysis & Audit (2026-09-06)

Hands-on audit of branch `arena/01a0760c-fpa` (HEAD `67b1af9`). Unlike the earlier
`AUDIT-FINDINGS-2026-09-06.md` (a 20-subagent research sweep), this pass actually
**installed dependencies and executed every runnable gate**, built the app, and
diffed the API surface. Findings below are reproducible from the commands shown.

---

## 1. What this project is

**OneFP&A** — a local-first, offline, single-user desktop FP&A (financial planning
& analysis) suite. Architecture:

- **Shell/UI:** Tauri 2 + React 19 + TypeScript (Vite 8), AG Grid, ECharts,
  HyperFormula, Zustand, Zod, i18next. 42 screens in `src/pages/`.
- **Core:** Rust (`src-tauri/`) owns all math — money, calendar, formula engine,
  ingestion, export, security. SQLite via `rusqlite` (bundled). 80 Tauri command
  handlers registered in `src-tauri/src/lib.rs`.
- **Money:** exact arithmetic via `rust_decimal` / i64 minor units — no floats.
- **Industry behavior = Pack data** (`packs/`), 12 packs, no per-industry code.
- **No server, no telemetry, no cloud, no runtime `.env`.**

Size: ~27k lines Rust, ~70k lines TS/TSX, 570 tracked files, 1,167 passing JS tests.

The repo is unusually disciplined: extensive docs (`docs/`, 63 indexed), a written
rulebook (`docs/CLAUDE.md` + `docs/ZERO-COMPROMISE-RULES.md`), and 15 custom CI
gates. This audit is graded against those self-imposed standards.

---

## 2. Gate results (executed this session)

| Gate                                       | Result                  | Notes                                        |
| ------------------------------------------ | ----------------------- | -------------------------------------------- |
| `npm run lint` (eslint, max-warnings 0)    | ✅ PASS                 |                                              |
| `npm run typecheck` (tsc --noEmit)         | ✅ PASS                 |                                              |
| `npm run fmt:check` (prettier)             | ✅ PASS                 |                                              |
| `npm run test` (vitest)                    | ✅ PASS                 | **98 files / 1,167 tests**                   |
| `schema-equality-check`                    | ✅ PASS                 | 56 tables, no float money cols               |
| `docs-link-check --strict`                 | ✅ PASS                 | 175 cross-refs / 73 docs                     |
| `docs:verify`                              | ✅ PASS                 | 63 docs, 42 screens, 102 cmd rows, 99 errors |
| `packs:validate`                           | ⚠️ PASS w/ 132 warnings | 12/12 valid; "legacy" warnings — see §4      |
| `money:ast`                                | ✅ PASS                 | no float money paths                         |
| `security:scan` (secret+telemetry+license) | ✅ PASS                 | no secrets/telemetry/GPL                     |
| `npm run build` (production bundle)        | ✅ PASS                 | built in ~3s                                 |
| **Rust: `cargo test`/`clippy`/`fmt`**      | ❌ NOT RUN              | **no Rust toolchain in sandbox**             |
| **`cargo`-dependent desktop preflight**    | ❌ NOT RUN              | blocked by toolchain                         |

**Bottom line:** every JS/TS/docs/security gate is green on a clean tree. The
critical caveat is that **the entire Rust core (~27k lines) cannot be compiled,
tested, clippy'd, or fmt-checked here** — so all Rust correctness claims are
_unverified in this environment_. This is a structural blind spot, not a defect,
but it means "green" covers only ~70% of the codebase.

---

## 3. Notable improvements since the previous audit

Several items flagged in `AUDIT-FINDINGS-2026-09-06.md` are **already fixed**:

- **Money negative-residual allocation** (was "missing", money.rs:110-121) is now
  implemented with an explicit ascending re-sort and documented HALF_EVEN tie-rule
  (`src-tauri/src/core/money.rs`).
- **`docs-link-check --strict`** now passes (was failing 2× on `file:///` refs).
- **API drift shrank drastically:** the old audit reported 23 catalog commands with
  no Rust handler; today only 3 remain mock-backed (§4).
- **Tree is clean & committed** (old audit flagged a 2,642-line uncommitted tree).
- Docs/screens/error counters in `docs:verify` are now internally consistent.

---

## 4. Real findings (current)

### P1 — API surface: 3 documented commands are mock-only (no Rust handler)

Frontend schema (`src/api/schema.ts`) + mock (`src/api/mock.ts`) define and answer
these, but no handler is registered in `src-tauri/src/lib.rs`:

- `company.archive_year`
- `driver.import`
- `model.inspect`

In the browser dev preview they "work" (mock answers); in the real Tauri shell they
would fail — `invoke()` has no target. Either implement the native handlers or mark
them explicitly V2 in `docs/API-SPEC.md` and remove/guard the schema bindings.

### P1 — Orphan native handler: `assumption_waive` — ✅ RESOLVED (WS-04, 2026-09-06)

~~`assumption_waive` is registered in `lib.rs` (line 122) but has **no schema binding,
no bridge case, and no frontend caller**.~~ Wired end-to-end: `AssumptionWaiveArgs`
schema binding + `assumption.waive` mock case (session/read-only/scope/blank-reason
gates + hash-chained audit event mirror) + the store now awaits the audited native
command (local map is a display cache). S-044 surfaces typed bridge errors inline with
a pending state. Un-waive remains display-local (no native un-waive exists — recorded
as a follow-up, not invented).

### P2 — Mock core (~4,600 lines) ships in the production bundle — ✅ RESOLVED (WS-08, 2026-09-06)

`src/api/mock.ts` is _statically_ imported by `src/api/bridge.ts` and only gated at
_runtime_ by `isTauriRuntime()`. ~~Grep confirms mock strings ("Demo Company",
"Standard costing") are present in `dist/assets/bridge-*.js` and `index-*.js`.~~
RESOLVED (WS-08): dev-only dynamic import behind a static `import.meta.env.DEV` guard;
`dist/` verified free of `mockInvoke`/mock sample strings; E2E now runs against the
dev server (where the mock legitimately answers).

### P2 — Updater is configured but unusable (empty pubkey) — ✅ RESOLVED (WS-09, 2026-09-06: removed, ADR-028)

`src-tauri/tauri.conf.json`: updater `endpoints` points at
`github.com/Warzonesiddiki/fpa/releases/...` but `"pubkey": ""`. A Tauri updater with
an empty pubkey cannot verify signatures — either finish the signing setup or disable
the updater until release (M7). CSP itself is sound (`default-src 'self'`).

### P2 — Pack data is thin: 132 validator warnings — ✅ RESOLVED (WS-10, 2026-09-06)

~~`packs:validate` passes but emits 132 "legacy" warnings~~ → **0 warnings**. All 12
packs re-issued at v2.1.1: every KPI carries an engine-line-key `formula` + numeric
`bands {good, watch}` (alerts no longer target-only); every driver template declares
non-empty `links` (Federation/attribution restored). Data-only change.

### P2 — Repo hygiene: duplicate + contradictory lockfiles — ✅ RESOLVED (WS-03, 2026-09-06)

Both `package-lock.json` **and** `pnpm-lock.yaml` are tracked (154KB) despite
`packageManager: npm@10.9.0`. Pick one package manager and delete the other lockfile
to avoid drift. Also `skills-lock.json` is tracked but listed under `.gitignore`
(it's not actually ignored because it was committed before the ignore rule) — decide
and reconcile.

### P2 — CI exists but does not execute (`.github/` git-ignored)

`infra/ci.yml` is a complete, well-structured pipeline, but `.github/` is in
`.gitignore` (documented: token lacks Workflows permission). So **no gate runs
automatically** — every check is local/manual. Until CI is live, "green" depends on
whoever remembers to run `npm run check`. This is the single biggest process risk.

### P3 — Coverage gate is razor-thin and not in `check`

Global branch coverage sits at ~80.07% vs an 80% threshold (per HANDOVER). The
`test:coverage` gate is **not** part of `npm run check`, so a coverage regression
won't fail the standard gate. Any new page/store without tests will tip it red.

### P3 — Bundle size: `s041-model-grid` chunk is 1.13 MB (316 KB gzip)

Largest chunk by far; `model` chunk is 796 KB. Acceptable for a desktop app but worth
code-splitting/lazy-loading review if startup perf matters.

### P3 — TASKBOARD is mostly non-DONE

Status tokens across `TASKBOARD.md`: ~75 DONE, ~83 PARTIAL, ~33 TODO, 6 BLOCKED, 3
IN PROGRESS. Consistent with a mid-build product. Many PARTIALs are "native-unverified
because no Rust toolchain," not missing code — but the board should distinguish
"code-complete, unverified" from "not built."

---

## 5. Strengths worth preserving

- **Money discipline is real** — `money:ast` + `schema-equality-check` enforce no
  float money in code _and_ schema; the Rust core uses `rust_decimal` throughout.
- **1,167 tests, all green**, including axe accessibility assertions per screen.
- **Docs are a genuine source of truth** and machine-checked (link + index + verify).
- **Security posture is clean** — no secrets, no telemetry, no GPL/AGPL deps, keychain
  for secrets, Ed25519 offline licensing, tight CSP, least-privilege Tauri setup.
- **Very low ambient debt** — only 3 TODO-ish comments in `src/`, 0 real TODO/FIXME in
  Rust, no `unimplemented!`/`todo!` macros.

---

## 6. Recommended priorities

1. **Stand up CI** (resolve the Workflows-permission/`.github` issue) so gates run on
   every push — this de-risks everything else. _(process)_
2. **Get a Rust toolchain into the verification loop** — the untested 27k-line core is
   the biggest correctness unknown. Run `cargo test/clippy/fmt` somewhere real.
3. Resolve the **API surface mismatches**: implement or defer the 3 mock-only
   commands; wire or delete `assumption_waive` (and fix the audit/persistence gap).
4. **Exclude the mock core from production builds** (dev-only dynamic import).
5. Finish the **updater pubkey** or disable the updater until M7.
6. Re-issue **packs** with formulas/bands/links; drop the 132 warnings.
7. Collapse to **one lockfile**; reconcile `skills-lock.json` ignore state.

---

_Method: `npm install` then each gate run individually; `npm run build`; API diff via
`grep` of `lib.rs` handlers vs `schema.ts` command bindings; bundle inspection of
`dist/`. Rust gates could not be executed (no `cargo`/`rustc` in sandbox)._
