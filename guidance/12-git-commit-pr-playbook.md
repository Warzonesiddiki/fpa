# 12 · Git, commits, PRs & the report

## Read first

- `docs/GIT-STANDARDS.md`, `docs/CI-CD.md`, `docs/RELEASE-CHECKLIST.md`, `docs/CLAUDE.md §7`.

## Branch discipline (absolute)

- Work **only** on `arena/01a0760c-fpa`. Never create, switch to, or push another branch.
- Push with `git push origin arena/01a0760c-fpa`.
- If `git`/`gh` fails with an auth error, tell the owner: "the GitHub connection needs
  attention — please reconnect GitHub in Arena." Never ask for tokens/passwords, never
  store credentials.

## Commit discipline

- **One concern per commit.** One workstream/feature = one focused, gate-green commit.
- **Conventional Commits:**
  - `feat(api): implement model.inspect native handler + wire UI`
  - `fix(governance): persist and audit assumption waivers`
  - `chore(ci): enable GitHub Actions with Rust build/test/clippy/fmt`
  - `docs(api): add company.archive_year contract + traceability`
- The commit body: what changed, why (cite doc IDs / WS number), and which gates passed.
- **Docs move with code** in the same commit (B8) — never a follow-up "docs later" commit.

## Before you commit — the gate ritual

```bash
git status --short           # know exactly what you're committing
npm run check                # all JS/TS/docs/security gates
npm run build                # production bundle
# cargo test/clippy/fmt runs in CI; locally report 🚧 UNVERIFIED
git checkout -- package-lock.json   # ONLY if npm churned it to dev→devOptional noise
```

Never commit: `node_modules/`, `dist/`, coverage output, secrets, private keys, `.env`,
`.fpa` data files, or a stray second lockfile.

## Opening a PR (when asked)

- From `arena/01a0760c-fpa` via `gh pr create`.
- PR description = the `docs/CLAUDE.md §7` report (below) + a checklist of the Definition
  of Done (`13-definition-of-done.md`).
- Ensure CI is green (once WS-01/02 land). Never merge over a red or skipped gate.

## The report format (paste after every workstream — docs/CLAUDE.md §7)

```
## Summary       — 2–4 sentences: what changed and why (cite doc IDs / WS)
## Files         — each changed/added file, one-line purpose
## Tests         — added/updated + exact command + result/counts
## Gates         — lint / tsc / fmt / unit / build / cargo / e2e — PASS/FAIL/UNVERIFIED + evidence
## Docs synced   — which docs updated (or "no changes needed" and why)
## Risks         — deviations, open questions, waivers (with reason)
```

Rules: paste **real** command output. A gate you didn't run is `🚧 UNVERIFIED`, never ✅.
A Rust change you couldn't compile is UNVERIFIED, not passing.

## Anti-patterns (banned)

- Pushing to any branch but `arena/01a0760c-fpa`.
- Batching unrelated changes into one commit.
- "Docs in a later commit."
- Committing build output/secrets.
- Claiming green without evidence.
