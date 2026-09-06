# 08 · Testing playbook

Tests are part of the feature, not an afterthought. New behavior ships with tests in the
**same** commit, and coverage must not drop.

## Read first

- `docs/TESTING-STRATEGY.md`, `docs/E2E-TESTING.md`, `docs/TEST-FIXTURES-SPEC.md`,
  `docs/DEFINITION-OF-DONE.md`, `docs/QA-CHECKLIST.md` (Q1–Q8).

## The test layers

| Layer                | Tool                        | Where                           |
| -------------------- | --------------------------- | ------------------------------- |
| Unit (TS)            | Vitest                      | `src/**/*.test.ts`              |
| Component (React)    | Vitest + Testing Library    | `src/**/*.test.tsx`             |
| Accessibility        | `vitest-axe`                | inside component tests          |
| Property/oracle (TS) | Vitest                      | e.g. money/statement invariants |
| Rust unit + property | `cargo test` + `proptest`   | `#[cfg(test)]` in `src-tauri/`  |
| E2E user flows       | Playwright (+ tauri-driver) | `e2e/*.spec.ts` (UF-001…UF-014) |
| Benchmarks           | Vitest bench                | `benchmarks/*.bench.ts`         |

## What every change must add

- **A command:** Rust unit tests for happy + each error branch + audit-row-written;
  a store/page test for the UI path.
- **A screen:** tests for the relevant states, an axe-clean populated state, and the
  primary action calling the command.
- **Money/statement/allocation logic:** property tests asserting totals tie, no rounding
  drift, sign handling.
- **A user journey change:** the matching Playwright flow (UF-0NN).

## Commands

```bash
npm run test                     # full vitest suite (currently ~1,167 tests)
npm run test:coverage            # + coverage gate (see remediation WS-11)
npm run test:coverage:critical   # critical-files coverage gate
npm run test:e2e                 # Playwright (needs tauri-driver for the shell)
cargo test                       # (CI) Rust unit + proptest
```

## Coverage rules

- Thresholds live in `vitest.config.ts` (lines 85 / branches 80 / functions 80 /
  statements 85) and `vitest.critical.config.ts` + `scripts/coverage-gate.mjs`.
- **Never lower a threshold to pass.** Raise coverage with real tests.
- Keep a real buffer above 80% branches (see WS-11) — a hair-thin margin regresses on the
  next file.

## Writing good tests (quality bar)

- Test **behavior and the 5 states**, not implementation details.
- No assertion-free tests, no `skip`, no `.only`, no snapshot-only "coverage".
- Deterministic: no real clock/network/random — use fixtures from `TEST-FIXTURES-SPEC`.
- Mirror an existing strong test (e.g. `src/pages/s047-production/index.test.tsx`,
  `src/utils/money.test.ts`).

## Anti-patterns (banned)

- Shipping code with no test.
- `it.skip` / `describe.only` / commented-out assertions left in.
- Lowering coverage thresholds instead of testing.
- Tests that pass by mocking away the thing under test.
- Relying on the dev mock for correctness of a native path (mock is preview-only).
