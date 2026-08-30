# CI-CD.md

> OneFP&A · v1.0.0 · **Pipeline stages, triggers, required checks before merge.** No `continue-on-error`, no skipped gates in release paths (B18-7). All jobs run on `ubuntu-latest`, `windows-latest`, `macos-latest` for parity (B18-8).

---

## 1. TRIGGERS

| Trigger | Job set |
|---|---|
| `push` to `main` | Fast gate (lint+type+unit RUST) — never deploy |
| `pull_request` | Full gate (below) |
| `release/vX.Y.Z` branch push | Full gate + release packaging/signing |
| `tag v*` (from release branch) | Release publish + SBOM + checksums |
| `schedule: nightly` (00:00 UTC) | Full suite + dependency audits + benchmarks |
| manual `workflow_dispatch` | Re-run or targeted (with explicit rationale in log) |

## 2. PIPELINE STAGES (every PR must pass all)

```text
PR → [1 Install cache] → [2 Lint/Type/Fmt] → [3 Unit TS] → [4 Unit Rust+Proptest]
   → [5 Coverage gate] → [6 Schema/Doc gates] → [7 A11y] → [8 E2E (3 OS, P0 flows)]
   → [9 Perf bench] → [10 Security audits] → [11 Docs/link/index] → [12 Release dry-run]
```

| Stage | Command | Gate (fail = block) |
|---|---|---|
| 1 Install | `npm ci && cargo fetch` | lockfile match |
| 2 Lint/Type | `tsc --noEmit` · `eslint src --max-warnings 0` · `prettier --check` · `cargo fmt --check` · `cargo clippy -- -D warnings` | 0 errors/warnings |
| 3 Unit TS | `vitest run` (sharded) | 0 failures; coverage ≥85/80 (≥95 critical) |
| 4 Unit Rust | `cargo test` (incl. proptest 10k, oracle fixtures) | 0 failures; engines ≥95 lines/90 branch |
| 5 Coverage | `scripts/coverage-gate.mjs` + `cargo llvm-cov` | threshold + no reduction without waiver |
| 6 Schema/Docs | `scripts/schema-equality-check.mjs` · `scripts/docs-link-check.mjs --strict` · `scripts/docs-index.mjs` · `money:ast` | 0 drift; index complete; no float |
| 7 A11y | `vitest-axe` all screens ×5 states; contrast token test | 0 violations |
| 8 E2E | `playwright test` on 3 OS (tauri-driver; P0 flows = full) | 0 failures; no flake-mask |
| 9 Perf | `vitest bench` + `cargo bench` | ≤10% regression vs baseline |
| 10 Security | `npm audit --audit-level=high` · `cargo audit` · `scripts/secret-scan.mjs` · `scripts/license-check.mjs` | HIGH = 0; no secrets; no GPL/AGPL |
| 11 Docs | link check + `docs:verify` + glossary scan (BANNED terms) | 0 |
| 12 Release dry-run | `tauri build --no-bundle` (per OS) | build success |

**Release addition:** packaging + signing per OS (DEPLOYMENT §3), update manifest generation, checksums, notarization, updater signature.

## 3. REQUIRED CHECKS BEFORE MERGE (branch protection)

- [ ] All 12 stages green on the PR's head commit.
- [ ] Review approval (≥1; author ≠ approver).
- [ ] PR size ≤ 500 changed lines (docs exempt) — GIT-STANDARDS §3.
- [ ] No `skip`/`xdescribe`/`it.only`/`describe.skip`/`#[ignore]` in diff (scanner).
- [ ] No debugger/console.log/TODO markers (scanner).
- [ ] Migration + test if DB changed; docs-index updated if docs changed.
- [ ] CHANGELOG entry for release-affecting changes.
- [ ] Manual verification note for UI changes (screenshot attached for E2E-able screens).

## 4. CACHING & RUNTIME BUDGET

| Job | Time budget |
|---|---|
| Full PR CI (3 OS) | ≤ 25 min (sharded; Vitest workers 4; no 80 GiB heap) |
| Release pipeline | ≤ 45 min |
| Nightly (all) | ≤ 30 min |
| Cache | `~/.npm`, `~/.cargo`, `target/release` (fingerprinted) |

## 5. ARTIFACTS & EVIDENCE

- Every PR: `reports/coverage-*.json`, `reports/bench-*.json`, `reports/a11y-*.json`, e2e trace (`trace.zip`), screenshot gallery.
- Release: `SHA256SUMS`, `SBOM.json` (CycloneDX), update manifest + signature, release notes draft.
- Artifacts retained 90 days (PR) / forever (release).

## 6. FAILURE POLICY

1. Red CI = blocked; no force-merge, no "re-run green" without root cause.
2. Flake: 2 occurrences → issue + owner; flaky test disabled only with tracking issue (never `retry:3` masking).
3. Infra failure (runner outage): documented re-run; report shows infra vs test failure.
4. Security scan HIGH → stop everything until triaged (no exceptions).

*Referenced by: GIT-STANDARDS.md, DEPLOYMENT.md, MONITORING.md, DEFINITION-OF-DONE.md.*
