# 18 · Troubleshooting the sandbox & gates

Common environment quirks and how to react — so you don't chase phantom failures.

## `node_modules` vanished mid-session

The sandbox **excludes `node_modules` from snapshots**, so it can disappear between
sessions or mid-session. Symptom: `eslint: not found`, `vitest: not found`, or a gate
failing to even start.

**Fix:** just reinstall — this is normal, not a code bug.

```bash
ls node_modules >/dev/null 2>&1 || npm install
```

Then re-run the gate. Do **not** start "fixing" code for an error that is really a missing
dependency tree.

## `npm install` rewrote `package-lock.json`

Newer npm can churn `dev` → `devOptional` in the lockfile with no real dependency change.
If the diff is only that noise and you didn't intend a lockfile change:

```bash
git checkout -- package-lock.json
```

Only keep a lockfile change if you actually intended to add/upgrade a dependency.

## No Rust toolchain (`cargo: command not found`)

The sandbox has **no `cargo`/`rustc`**. You cannot compile/test/clippy/fmt the Rust core
here. This is expected.

- Report all Rust gates as `🚧 UNVERIFIED (no toolchain in sandbox; runs in CI)`.
- **Never** mark a Rust change ✅ locally.
- Rust verification happens in CI (remediation WS-01/WS-02). Ensure your Rust code is
  written to compile (types, imports, `?` error handling) even though you can't run it.

## A gate is red — triage order

1. Is it really missing deps? → reinstall (above).
2. Read the actual error output — don't guess.
3. Fix the root cause. **Never** silence a gate with `skip`, `continue-on-error`,
   `|| true`, `--skip`, `.only`, or by lowering a threshold.
4. Re-run the single gate, then `npm run check` as a whole.

## Useful one-liners

```bash
git status --short                       # what's changed
npm run check                            # all JS/TS/docs/security gates
npm run build                            # production bundle
node scripts/schema-equality-check.mjs   # schema docs vs SQL
npm run docs:verify                      # docs index/links/taxonomy
npm run money:ast                        # float-in-money scan
npm run packs:validate                   # packs (target 0 warnings)
npm run security:scan                    # secrets/telemetry/licenses
```

## Preview / dev server (if you must run the web preview)

- The web preview is **tooling, not a product surface** (B18-3). It runs on the mock core.
- Bind to `0.0.0.0` and accept the preview host if you start Vite for the user's browser
  preview; never point browser code at `localhost` to reach another service.
- Correctness of a **native** path is never proven by the mock preview — only by
  `cargo test` in CI.

## If GitHub auth fails

Tell the owner: "the GitHub connection needs attention — please reconnect GitHub in
Arena." Never ask for or store tokens/passwords.
