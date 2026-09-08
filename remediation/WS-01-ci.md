# WS-01 · Stand up Continuous Integration

**Priority:** Phase A (do first). **Decision:** D9. **Finding:** CI pipeline
(`infra/ci.yml`) is complete but never runs — `.github/` is git-ignored, so GitHub
Actions never sees it. Every gate is currently local/manual (biggest process risk).

## Objective

Make the gate suite run automatically on every push and pull request to
`arena/01a0760c-fpa` and `main`, so no change can silently regress.

## Why it matters (business terms)

Right now "all tests pass" depends on someone remembering to run them. CI is the robot
that checks every single change, forever, without being asked. Without it, a mistake can
slip into the product unnoticed.

## Files

- `infra/ci.yml` — existing, complete pipeline (source of truth for the workflow).
- `.github/workflows/ci.yml` — **target location GitHub actually reads** (currently
  absent because `.github/` is ignored).
- `.gitignore` — line `.github/` is what blocks the workflow from being tracked.

## Steps

1. Read `infra/ci.yml` end to end and `docs/CI-CD.md`. Confirm the job stages match the
   local gates in `package.json` `check`.
2. Determine the real blocker. The docs say the token "lacks Workflows permission"
   (`docs/DOCUMENTATION-GAP-ANALYSIS.md` row 76, `../audits/HANDOVER.md §3`, `TASKBOARD.md M7-1`).
   Verify by attempting the correct setup:
   - Un-ignore the workflows path: change `.gitignore` so `.github/` is no longer fully
     ignored. Prefer a **narrow** ignore (keep ignoring anything sensitive) while
     **allowing** `.github/workflows/`. Example:
     ```
     .github/*
     !.github/workflows/
     !.github/workflows/**
     ```
   - Copy `infra/ci.yml` to `.github/workflows/ci.yml` (keep `infra/ci.yml` as the
     documented source, or make one a pointer — do not silently diverge them).
   - `git add .github/workflows/ci.yml && git commit && git push origin arena/01a0760c-fpa`.
3. If the push is **rejected for lack of `workflow` scope**, that is the known blocker.
   Do NOT fake success. Instead:
   - Leave the workflow file staged/committed so it is ready.
   - Tell the owner, in plain language: "GitHub is refusing to accept the automated-test
     file because the current connection doesn't have permission to manage GitHub
     Actions. Please reconnect GitHub in Arena with Workflows permission enabled, or add
     the file once via the GitHub website." Provide the exact file path.
   - Record this under **Risks** and mark WS-01 `🚧 BLOCKED (needs Workflows permission)`.
4. If the push **succeeds**, confirm the workflow appears under the repo's Actions tab
   (`gh run list` / `gh workflow list`) and that a run starts. Fix any YAML/setup errors
   until the run is green (Rust job may be added in WS-02).

## Acceptance criteria

- `.github/workflows/ci.yml` exists, tracked, and identical in intent to `infra/ci.yml`.
- The pipeline triggers on push/PR to `arena/**` and `main`.
- Either: a green CI run is visible (`gh run list`), OR the exact permission blocker is
  documented for the owner with the file already committed and ready.
- `.gitignore` still protects sensitive `.git*` files (never un-ignore secrets).

## Gates to run

```bash
npm run check          # must stay green (you changed no product code)
```

Report Rust gates as UNVERIFIED locally (WS-02 wires them into CI).

## Docs to sync

- `TASKBOARD.md` M7-1 → update status.
- `../audits/HANDOVER.md §3` and `docs/DOCUMENTATION-GAP-ANALYSIS.md` row 76 → reflect CI live/blocked.
