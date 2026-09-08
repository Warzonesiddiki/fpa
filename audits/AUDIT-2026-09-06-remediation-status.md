# OneFP&A — Remediation Status (2026-09-06, session on branch `arena/01a078fe-fpa`)

Follow-up to `AUDIT-2026-09-06-fresh.md` + `REMEDIATION-PLAN.md`. Every claim below was
verified by running the gates in-session (`npm run check` = 101 files / 1,223 tests +
both coverage gates + schema/docs/packs/money/security, `npm run build`).

## Done this session (7 commits, one workstream each)

| WS       | Commit    | What changed                                                                                                                                                                                                                                                          | Evidence                                                                          |
| -------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| WS-03    | `5e4dcfd` | npm-only lockfile (pnpm-lock.yaml deleted, skills-lock.json untracked), docs de-pnpm'd                                                                                                                                                                                | `git ls-files \| grep lock` → package-lock.json + Cargo.lock only; `npm ci` clean |
| WS-01/02 | `d16e50a` | CI pipeline designed & ready at `.github/workflows/ci.yml` (js-gates = full `check` + coverage ×2 + cargo fmt/clippy/test ×3 OS + tauri dry-run + audits). **BLOCKED on push**: Arena App token lacks `workflows` permission (git push and Contents API both refused) | File on disk, ready to commit; `infra/ci.yml` now a pointer                       |
| WS-09    | `d4ad897` | Unsigned auto-updater **removed** (ADR-028): config block, crate + registration, capability, lockfile entries; S-075 copy honest                                                                                                                                      | `grep '"pubkey": ""'` → nothing; security:scan green                              |
| WS-08    | `bbf7b2a` | Mock core (4.6k lines) tree-shaken from production: dev-only dynamic import behind static `import.meta.env.DEV`; prod browser launch now refuses instead of faking; E2E moved to dev server                                                                           | `dist/assets` contains zero `mockInvoke`/mock sample strings                      |
| WS-04    | `c5c7d10` | Assumption waivers persist via the audited native `assumption.waive` (schema + mock parity incl. hash-chained audit event + store + S-044 async UI with typed errors)                                                                                                 | +4 tests; mock contract asserted in `mock.test.ts`                                |
| WS-11    | `82ae4d4` | Coverage wired into `check` (main ≥85/80, critical ≥95/90); **real regression found & fixed**: gate wasn't enforced and sat at 84.12/76.71. Also fixed a real S-023 bug (pack key froze at the first character of the name)                                           | `coverage-gate PASS (main) 87.49/81.82`, `PASS (critical) 98.29/95.37`            |
| WS-10    | `0676f0c` | All 12 Industry Packs re-issued at v2.1.1 with KPI formulas + bands + driver links                                                                                                                                                                                    | `packs:validate PASS — 12/12 … (0 legacy warnings)` (was 132)                     |

## Not done, and why

- **WS-05 `model.inspect`, WS-06 `driver.import`, WS-07 `company.archive_year` (native Rust
  handlers).** Sequencing per D5: Rust is verified in CI, and CI is not yet running (WS-01
  permission blocker). No Rust toolchain exists in this sandbox and none can be installed
  (rustup CDN unreachable). Writing ~1,500 lines of compile-unverified Rust would risk
  breaking the owner's build — the opposite of zero-compromise. **Do these immediately
  after CI is live.**
- **CI activation + branch protection.** Needs the owner (below).

## Owner actions required (in order)

1. **Reconnect GitHub in Arena** — the session token expired mid-session (pushes now fail
   with `could not read Username`). All commits are safe on the local branch.
2. **Get the CI workflow committed** — either reconnect with **Workflows permission**
   enabled, or add `.github/workflows/ci.yml` (it is ready on disk in the repo root of
   this branch's checkout) via the GitHub web UI. Then confirm a run starts under Actions.
3. **After CI is green**: add branch protection on `main` requiring the CI checks
   (CI-CD.md §3), then execute WS-05/06/07 on a branch with CI verification.

## Post-session baseline (all verified green)

`npm run check`: lint · typecheck · fmt · vitest 101 files/1,223 tests · coverage main
87.49/81.82 · critical 98.29/95.37 · schema-equality (56 tables) · docs-links (175 strict)
· docs:verify (63 docs/42 screens/102 commands/86 errors + 21 reserved — truth-up 2026-09-07, see ERROR-HANDLING §2C) · packs:validate (12/12, **0
warnings**) · money:ast · security:scan — **all PASS**. `npm run build`: PASS, production
bundle contains no mock core. Rust: 🚧 UNVERIFIED locally (unchanged; CI will close this).
