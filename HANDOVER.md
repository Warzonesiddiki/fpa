# OneFP&A — Session Handover Prompt

> Paste everything between the `--- PROMPT START ---` / `--- PROMPT END ---` markers into a
> fresh Arena.ai Agent session (or read this file and continue the task). It is written to be
> self-contained: context, state, gates, pitfalls, and the next milestone.

---

## PROMPT START

You are continuing work on **OneFP&A** — a native desktop (Tauri 2), local-first, encrypted-SQLite,
all-in-one FP&A suite for SMB→mid-market (up to 500k–2M GL lines, 50 BUs) and multi-industry
conglomerates. Repo: `Warzonesiddiki/fpa` (GitHub). Personal home-folder repo path: `/home/user/fpa`.

- **Working branch is fixed to `arena/01a05059-fpa`.** Never create/switch/push any other branch.
  Main is the target for PRs.
- **PR #1 is merged** (merge commit `1848697` → `main`). Branch `arena/01a05059-fpa` is ahead of
  main by the docs-hardening commits + M0 foundation commit; keep building on it.
- This is a **zero-compromise, specs-first** project: 54 docs in `docs/` are the locked, complete
  specification (start with `docs/DOCS-INDEX.md`, `docs/ARCHITECTURE.md`, `docs/API-SPEC.md`,
  `docs/ROADMAP.md`, `docs/ZERO-COMPROMISE-RULES.md`). Rules B1–B20 and invariants I1–I10 are
  canonical. **Do not re-open closed docs sweep issues (B20).** No TBDs, no generic advice, every
  screen needs 5 states (loading/empty/error/success/populated), every error code defined (97),
  money is exact integers/literals (`rust_decimal`; never REAL/float — B3/I1), 15 technologies
  locked (B13/B14), local-first with no network in shipped code (B18-9), UX must be production-grade.

### What is already DONE (merged to main, all verified)
- **Frontend scaffold (green):** Vite 8 + React 19 + TS 5.9 + Tailwind 4 + zod-4 IPC registry +
  i18next + zustand + react-router 7 + decimal.js + HyperFormula/AG-Grid/ECharts pinned in
  `package.json`. Screens: S-001 Unlock, S-002 5-step Wizard, S-004 Shell (8 nav sections),
  S-010 Dashboard. 5-state `StatePanel`/`MoneyCell`, typed `bridge.ts` (Tauri invoke + dev-only
  mock), `stores/session.ts`.
- **Rust core in `src-tauri/` (written to spec, NOT locally compiled — no Rust toolchain available):**
  `core/money.rs` (exact decimal, currency scales, HALF_UP, largest-remainder),
  `core/calendar.rs` (12mo/454/445/544/3334; NRF oracle 2024–2028 — 2028 = 53w, Q4 4-5-5; W53
  nrf4day vs fullweek variants), `core/audit.rs` (HMAC-SHA256 chain), `core/error.rs`
  (documented wire shape), `storage/db.rs` + `storage/keystore.rs` (OS keychain + 0600 fallback),
  commands: `session.status|unlock|lock`, `security.change_pin`, `company.list|create`,
  `calendar.preview`, `pack.list`. `tauri.conf.json`, `build.rs`, `capabilities/default.json`,
  full icon set, 56-table `migrations/001_initial.sql` (verified in SQLite: FK clean, 10
  currency_scales seeds, no REAL money).
- **Data:** `packs/schema/pack.schema.json` v1.0.0 + 12 data-only Industry Packs (saas,
  manufacturing, retail, healthcare, construction, professional-services, nonprofit, government,
  energy, financial-services, logistics, real-estate); `scripts/gen-packs.mjs`,
  `scripts/pack-validate.mjs`; sample GL dump fixtures generator (480 rows, tie-out 93,797,664).
- **Gates (all PASS locally):** `npm run typecheck`, `lint`, `fmt:check`, `test` (82 tests),
  `test:coverage` (92.9% lines / 90.4% branches) + `test:coverage:critical` (≥95 lines/90 branches),
  `build`, `node scripts/docs-verify.mjs` (53 docs / 42 screens / 96 command rows / 97 error codes),
  `scripts/money-ast.mjs`, `scripts/pack-validate.mjs`, `scripts/secret-scan.mjs`,
  `scripts/telemetry-scan.mjs`, `scripts/license-check.mjs`. Migration verified via an in-memory
  SQLite apply.
- **CI file** is at `infra/ci.yml` (12 stages × 3 OS) — **it was deliberately NOT placed in
  `.github/workflows/`** because the Arena GitHub App token lacks the `workflows` permission
  (git push and Contents API both reject workflow files). Re-enable CI with ONE of:
  1. Repo owner grants the GitHub App `Read and write` + `Workflows` permission, then
     `git mv infra/ci.yml .github/workflows/ci.yml && git commit && git push`.
  2. Manually copy `infra/ci.yml` into `.github/workflows/ci.yml` on the default branch.

### Known pitfalls (do not retry / do not repeat)
- **No Rust toolchain in the sandbox** (rustup/apt/crates.io network-blocked). Never attempt
  `cargo build` locally; write Rust per spec and let CI verify. Every Rust change is therefore
  hand-reviewed — keep files small and review `cargo fmt --check` + `clippy -D warnings` + tests
  mentally (2024 edition, `#![deny]`-free but CI is strict).
- **npm installs require `--legacy-peer-deps`** (npm arborist peer crash). Registry is reachable
  via npm (binaries via playwright are NOT — do not retry `npx playwright install`; the e2e spec
  runs only in CI).
- **Gitignored files may not survive a sandbox reset** (node_modules, icons, coverage already
  happened once). Anything needed by CI must be committed: `src-tauri/icons/*` are now tracked;
  remember this for future generated artifacts.
- Local git history may reset to the base commit while the working tree keeps untracked changes —
  before pushing, run `git fetch origin arena/01a05059-fpa && git reset --soft origin/arena/01a05059-fpa`
  to rebase your new work onto the true remote tip, then `git add -A && git commit`.
- `docs-verify.mjs` has a deliberate allowlist of false-positive contexts (rust/Cargo,
  "financial-metric", Entity/Workspace/Tenant lists, TBD-in-CLAUDE) — do not re-narrow.
- Zod v4: `z.record(z.string(), z.unknown())` (two args), no `z.discriminatedUnion` without the
  discriminator present in every branch. `@testing-library/dom` must stay explicitly installed.
- Money/calendar logic has exactly ONE owner: the Rust core. UI formats only; never computes.
  `scripts/money-ast.mjs` treats `Math.round`/`parseFloat`/`Number()` in `src/` as violations.
- `src/pages/s002-wizard/error.test.tsx` exists because Vitest mis-reports async rejections when
  several userEvent/act flows share a file — keep error-path and flow-path tests in separate files.

### IMMEDIATE NEXT WORK — Milestone M1 (acceptance in docs/ROADMAP.md)
1. Merge/fix any CI findings on PR #1 (first real `cargo test` + clippy run).
2. Wire the frontend to the real Rust commands: `company.list/create` already exist; add
   `calendar.preview` UI (Wizard step 3 currently previews via mock), S-023 Pack Studio
   (`pack.list` exists), S-020/021/022/023 routes, S-003 global search stub.
3. F-001 Company Manager (CRUD + archive/delete with `COMPANY_IN_USE_RECENT`), F-003 `calendar.apply`
   (persists preview → fiscal_calendars/years/periods; `CAL_TRANSIT_AMBIGUOUS`,
   `CAL_PERIOD_MAPPING_CONFLICT`), F-004 wizard PIN step (currently `session.unlock` self-bootstraps
   `pin_metadata` from the first typed PIN — replace with an explicit wizard PIN–setup command per
   AUTH-SPEC §2; keep attempt/lockout counters).
4. Encrypted Company container: AES-256-GCM `.fpa` wrapping the per-company SQLite DB
   (SECURITY-CHECKLIST A02, `STORAGE_DECRYPT_FAILED` already in the error contract), WAL inside the
   container, `open-with-wrong-PIN` test, key derivation Argon2id (params in `pin_metadata`).
5. Import foundation: `import.parse/validate/tieout/commit/rollback` commands + GL-Dump-first
   pipeline (B19), `gl_lines` + `import_batches` already in schema.
6. Model grid: hyperformula integration contract (`model.cell.set.v1`, `model.recalc`; FORMULA_CYCLE,
   REFERENCE_BROKEN codes exist in ERROR-HANDLING).
7. Keep all gates green after every change; commit to `arena/01a05059-fpa`, open PRs against `main`.

---

## PROMPT END

### Verification one-liners (run in `/home/user/fpa`)
```bash
npm run typecheck && npm run lint && npm run fmt:check
npm run test && npm run test:coverage && npm run test:coverage:critical
npm run build
node scripts/docs-verify.mjs && node scripts/money-ast.mjs && node scripts/pack-validate.mjs \
  && node scripts/secret-scan.mjs && node scripts/telemetry-scan.mjs && node scripts/license-check.mjs
npm run fixtures:gen   # regenerates GL dump samples + asserts tie-out
```

### Live preview (browser, mock core)
`npm run dev` → http://localhost:5173 — Unlock with `1234` (or `wrong` to see the error state),
then Shell + Dashboard; Wizard at `/welcome`.

### Useful counts (keep exact in any new docs/scans)
- 12 Industry Packs · 56 DB tables · 10 currency seeds · 53 docs · 42 screens (`S-***`) ·
  96 command rows in API-SPEC · 97 error codes · 38 MVP features (F-001…F-038) ·
  20 V2 (V-001…V-020) · 8 FUTURE · 12-item NOT-BUILDING list · B1–B20 · Q1–Q8 · I1–I10.
