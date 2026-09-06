# WS-03 · Repository hygiene: one lockfile, untrack tooling

**Priority:** Phase A. **Decisions:** D3, D4. **Findings:** (a) both
`package-lock.json` and `pnpm-lock.yaml` are tracked though `packageManager` is
`npm@10.9.0`; (b) `skills-lock.json` is tracked yet listed in `.gitignore` (agent
tooling, not product source).

## Objective

Exactly one package manager and one lockfile (npm). Agent-tooling artifacts untracked.

## Why it matters (business terms)

Two lockfiles can describe two different sets of dependency versions — the app could
behave differently depending on which tool someone uses. One lockfile = one truth.

## Files

- `pnpm-lock.yaml` — **delete** (git rm).
- `package-lock.json` — keep (the single source of truth).
- `skills-lock.json` — **untrack** (`git rm --cached`), it stays on disk but leaves git.
- `.gitignore` — already ignores `skills-lock.json`; confirm.
- `README.md`, `AGENTS.md`, `docs/CLAUDE.md`, `infra/ci.yml` — confirm all say npm only.

## Steps

1. Verify the intended manager: `grep packageManager package.json` → `npm@10.9.0`.
2. Remove the stray lockfile:
   ```bash
   git rm pnpm-lock.yaml
   ```
3. Untrack the tooling lock (keep the file locally, remove from git):
   ```bash
   git rm --cached skills-lock.json
   ```
   Confirm `.gitignore` contains `skills-lock.json` (it does) so it stays out.
4. Grep the repo for any remaining pnpm references and fix docs/scripts:
   ```bash
   grep -rniE "pnpm" --include=*.md --include=*.json --include=*.yml --include=*.mjs .
   ```
   Update any instruction that says `pnpm install` → `npm ci` / `npm install`.
5. Re-install cleanly to prove the npm lockfile is complete:
   ```bash
   rm -rf node_modules && npm ci
   ```
   If `npm ci` fails because the lock is out of date, run `npm install` once, review the
   diff, and commit the corrected `package-lock.json` (only if the change is legitimate,
   not `dev`→`devOptional` churn — see README sandbox note).

## Acceptance criteria

- `git ls-files | grep -E 'lock'` shows `package-lock.json` (and `Cargo.lock`) but **not**
  `pnpm-lock.yaml` or `skills-lock.json`.
- `npm ci` succeeds from a clean `node_modules`.
- No `pnpm` references remain in tracked docs/scripts/CI.

## Gates to run

```bash
npm ci
npm run check
npm run build
```

## Docs to sync

- `README.md` Quickstart — ensure it says `npm ci` (it does; verify).
- Any doc mentioning pnpm — remove the mention.
