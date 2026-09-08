# WS-11 · Coverage gate in `check` + lift the thin margin

**Priority:** Phase C (do last — after new code from WS-04..07 has its own tests).
**Decision:** D10. **Finding:** Global branch coverage sits at ~80.07% vs an 80%
threshold (per HANDOVER), and `test:coverage` is **not** part of `npm run check`. So a
coverage regression won't fail the standard gate, and any new untested file tips it red.

## Objective

Coverage is enforced by the standard gate, and the margin is comfortable (not razor-thin),
with every new file from earlier workstreams properly tested.

## Why it matters (business terms)

Test coverage is the percentage of the code that automated tests actually exercise. A
margin of 0.07% means the next small change can drop below the required line and either
break the build or, worse, slip through untested. We want a healthy buffer and the check
to run every time.

## Read first

- `vitest.config.ts` (thresholds: lines 85 / functions 80 / branches 80 / statements 85).
- `vitest.critical.config.ts` and `scripts/coverage-gate.mjs` (the critical-files gate).
- `package.json` scripts (`check`, `test:coverage`, `test:coverage:critical`).
- `docs/CI-CD.md` §2.3 (coverage stage) and `docs/DEFINITION-OF-DONE.md`.

## Steps

1. Establish the current number:
   ```bash
   npm run test:coverage
   ```
   Read the summary; note which files pull branches down.
2. **Raise coverage with real tests** (not by lowering thresholds):
   - Ensure WS-04..WS-07 shipped their own tests (they should have). Re-run coverage.
   - Add focused tests for the lowest-covered files/branches until branches are
     comfortably above threshold (aim for a real buffer, e.g. ≥ 82–83% branches, not a
     hair over 80). Prioritize stores, bridge/error mapping, and page error/read-only
     states — those carry the most untested branches.
   - Do NOT add trivial assertion-free tests to game the number; test real behavior and
     the 5 UI states.
3. **Wire coverage into the standard gate.** Add the coverage run to `check` so it fails
   on regression. Prefer:
   ```json
   "check": "... && npm run test:coverage && npm run test:coverage:critical && ..."
   ```
   Note: `test:coverage` currently re-runs the suite with coverage; if running the suite
   twice in `check` is too slow, replace the plain `npm run test` in `check` with the
   coverage variant so the suite runs once _with_ coverage. Keep it honest — the gate must
   actually enforce the thresholds.
4. Ensure `scripts/coverage-gate.mjs` (main + critical) is invoked and passes.
5. Confirm CI (WS-01/02) runs the coverage gate too.

## Acceptance criteria

- `npm run check` now includes and enforces coverage (main + critical).
- Branch coverage is comfortably above 80% (real buffer), lines/statements ≥ 85.
- No thresholds were lowered; the buffer came from real tests.
- New WS-04..07 code is covered.

## Gates to run

```bash
npm run test:coverage
npm run test:coverage:critical
npm run check          # now includes coverage
npm run build
```

## Docs to sync

- `docs/CI-CD.md` §2.3 and `docs/DEFINITION-OF-DONE.md` — coverage now in `check`.
- `README.md` "Common scripts" table — note `check` includes coverage.
- `../audits/HANDOVER.md` — update the coverage note (was 80.07%).
