# WS-02 · Rust core verification in CI

**Priority:** Phase A. **Decision:** D5. **Finding:** The ~27k-line Rust core has never
been compiled, tested, clippy'd, or fmt-checked in this environment (no toolchain).
That is ~30% of the codebase with zero automated verification.

## Objective

Ensure the Rust core is fully built, tested (`cargo test` + `proptest`), linted
(`cargo clippy -- -D warnings`), and format-checked (`cargo fmt --check`) automatically
in CI on Linux, macOS, and Windows (the three shipping targets).

## Why it matters (business terms)

All the money math, calendar logic, audit trail, and encryption live in Rust. Locally we
literally cannot run those tests here, so we are trusting them blind. CI on a real
machine is the only place this core gets proven correct on every change.

## Files

- `infra/ci.yml` and `.github/workflows/ci.yml` (from WS-01) — add/repair the Rust job.
- `src-tauri/Cargo.toml`, `Cargo.toml` (workspace) — dependency/toolchain reference.
- `rust-toolchain.toml` (create if absent) — pin the Rust version for reproducibility.

## Steps

1. Confirm the required toolchain from `README.md` (Rust ≥ 1.85) and Tauri prereqs.
2. Add a pinned `rust-toolchain.toml` at the repo root:
   ```toml
   [toolchain]
   channel = "1.85.0"           # match README / edition 2024 requirement
   components = ["clippy", "rustfmt"]
   ```
3. In the CI workflow, add a `rust-core` job (matrix: ubuntu-latest, macos-latest,
   windows-latest) that:
   - checks out, installs the toolchain (via `rust-toolchain.toml`),
   - installs Tauri system deps (Linux needs `libgtk`, `webkit2gtk`, etc. — see
     https://tauri.app/start/prerequisites/),
   - caches `~/.cargo` and `target/`,
   - runs, with **no `--skip`, no `continue-on-error`**:
     ```bash
     cargo fmt --all --check
     cargo clippy --all-targets --all-features -- -D warnings
     cargo test --all --all-features
     ```
4. Ensure the `panic = "abort"` release profile does not break `cargo test` (tests use
   the dev/test profile — verify the workflow does not force `--release` for tests).
5. If GitHub Actions cannot run yet (WS-01 blocked), still commit the job so it is ready,
   and mark this WS `🚧 BLOCKED (pending CI)`.

## Acceptance criteria

- A `rust-core` CI job exists across all three OS targets running fmt+clippy+test.
- `rust-toolchain.toml` pins the version.
- No escape hatches (`--skip`, `continue-on-error`, `|| true`) anywhere in the Rust job.
- If runnable: the Rust job is green. If not: committed and clearly reported as blocked.

## Gates to run

```bash
npm run check          # unchanged product code → stays green
# Rust: runs in CI. Locally: 🚧 UNVERIFIED (no toolchain in sandbox).
```

## Docs to sync

- `docs/CI-CD.md` — document the Rust job and OS matrix.
- `README.md` — confirm the Rust toolchain/version statement matches `rust-toolchain.toml`.
- `HANDOVER.md` / `TASKBOARD.md` — note Rust now verified in CI.
