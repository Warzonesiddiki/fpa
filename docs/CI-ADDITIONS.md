# CI-ADDITIONS — owner runbook for changes an agent cannot land

> **Why this file exists:** the CI workflow (`.github/workflows/ci.yml`) and repository
> settings are owner-controlled (an agent session holds no `workflows:` permission and
> branch-protection is a 403 for non-admins). This is the curated list of CI changes the
> 2026-09-07/08 audits recommend, in priority order, with exact diffs to apply. Each is
> copy-paste ready for a PR from a branch with the `workflows` permission granted
> (GitHub → Settings → Actions → General → Workflow permissions).

## 1. Upload clippy output as a job artifact (P0 — unblocks remote diagnosis)

**Problem.** Three consecutive pushes (36dc515 → cf61fb0) failed `cargo clippy -D warnings
(Stage 2)` on all three OSes with no annotation surface: cargo suppresses `::error::`
annotations for lint denials and the Actions log-download endpoint is not reachable from
restricted networks. The failure text was invisible outside the browser UI.

**Fix.** Capture compiler diagnostics to a file and upload it even on failure:

```yaml
      - name: cargo clippy -D warnings (Stage 2)
        working-directory: src-tauri
        run: cargo clippy --all-targets --message-format=json 2>&1 | tee ../clippy.jsonl | cargo clippy --all-targets -- -D warnings
```

```yaml
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: clippy-diagnostics-${{ matrix.os }}
          path: clippy.jsonl
```

(The double invocation costs one warm-cache re-run; alternatively pipe through
`cargo clippy -- -D warnings` first and a second `--message-format=short` pass only on
failure. The JSONL artifact makes every future clippy failure diagnosable from the API
alone — including by agents without browser log access.)

## 2. Branch protection on `main` (P0)

Settings → Branches → Add rule for `main`:
- ✅ Require a pull request before merging (1 approval)
- ✅ Require status checks: `lint-type-docs`, `unit-ts`, `rust (ubuntu-latest)`,
  `rust (windows-latest)`, `rust (macos-latest)`, `security-audit`
- ✅ Require branches to be up to date before merging
- ✅ Block force pushes / deletions

Today `main` accepts direct pushes — the merge queue that CI greenness implies
("never merge red") is convention, not enforcement.

## 3. Dependabot (P1)

`.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule: { interval: "weekly" }
  - package-ecosystem: "cargo"
    directory: "/src-tauri"
    schedule: { interval: "weekly" }
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule: { interval: "monthly" }
```

(The Node 20 deprecation warnings on `actions/checkout@v4` /
`actions/upload-artifact@v4` fall out of the github-actions feed.)

## 4. `cargo deny` in security-audit (P2)

The audit job currently runs `cargo audit` (RustSec advisories). Add licence/ban policy:

```yaml
      - run: cargo install cargo-deny && cargo deny check advisories bans licenses sources
        working-directory: src-tauri
```

## 5. Release signing + notarization (P2 — DEPLOYMENT/DESKTOP-PACKAGING)

Code-signing certificates and Apple notarization credentials are owner assets; the
CI job `build-dry-run` deliberately stops at `--no-bundle` until they exist. When they
do: add `TAURI_SIGNING_PRIVATE_KEY` + `APPLE_*` secrets, switch to a full
`npx tauri build`, and publish updater artifacts per DESKTOP-PACKAGING §signing.

## 6. Scheduled rust-toolchain probe (P3)

A weekly `workflow_dispatch`-able job that runs `cargo clippy` on the **nightly**
toolchain (non-blocking, `continue-on-error`) gives early warning when a future clippy
edition starts denying existing code — the class of failure that cost three blind CI
round-trips in September 2026.

---

**History note (2026-09-08).** The clippy Stage-2 failure on `arena/01a07ce7-fpa`
(36dc515→cf61fb0, all OS, fmt green, `--all-targets`) was diagnosed to exhaustion:
every changed Rust line re-linted clean under a real clippy 1.88 probe; the new/enhanced
lint tables for 1.89–1.98 swept with no match; toolchain pinned `stable`; the committed
root `Cargo.lock` rules out dependency drift. Item 1 exists so the next occurrence is
a one-API-call diagnosis instead of a week of blind refactors.
