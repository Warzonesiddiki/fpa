# TESTING-STRATEGY.md

> OneFP&A · v1.0.0 · **What gets unit vs integration vs E2E, tools, numeric coverage targets.** Gates are blocking; no `skip`/`continue-on-error` in release paths (B18-7).

---

## 1. TEST PYRAMID & OWNERSHIP

| Layer | What | Tool | Location | Who owns |
|---|---|---|---|---|
| **Unit — Rust** | money math, calendar, rounding, tie-out, license verify, audit chain, adapters | `cargo test` + `proptest` | `src-tauri/src/core/**/mod.rs` tests | Engine owner |
| **Unit — TS** | components (5 states), stores, hooks, zod schemas, utils | Vitest + Testing Library | co-located `*.test.tsx` | UI owner |
| **Integration — Rust↔DB** | repos, migrations, transactions, engine↔DB | `cargo test` w/ in-memory SQLite (`:memory:` + migrations) | `storage/tests/` | Storage owner |
| **Integration — IPC** | command handlers: serde in/out, error mapping, audit write, authz gates | Vitest mocks? **No** — Rust `#[cfg(test)]` + specta type check; TS side: zod contract tests against generated types | `api/tests/` | Boundary owner |
| **E2E** | 14 user flows (UF-001…UF-014), keyboard/a11y, 3 OS | Playwright + tauri-driver | `e2e/` | QA |
| **Property** | invariants (money round-trip, calendar periods, consolidation IC sum=0, statement tie, rounding exactness) | `proptest` (Rust) | `core/**/proptest/` | Engine owner |
| **Oracle** | hardcoded known-answer fixtures: real 4-5-4 calendars (2024–2028), published P&L examples, 2-BU consolidation | `cargo test` fixtures + JSON | `tests/fixtures/` | QA + Engine |
| **Visual/a11y** | axe (0 violations), contrast computation, screenshot diff at scales | vitest-axe + Playwright | `e2e/a11y/` | QA |

## 2. COVERAGE TARGETS (numeric, enforced in CI)

| Measurement | Target | Enforcement |
|---|---|---|
| Rust core engine coverage (money, calendar, statements, consolidation, variance) | **≥ 95% lines, ≥ 90% branches** | `cargo llvm-cov` gate |
| Rust storage/migration coverage | ≥ 85% lines | same |
| TS app coverage (src/, excluding generated) | **≥ 85% lines, ≥ 80% branches** | Vitest coverage gate |
| Critical modules (grid store, import store, moneyFormat, scenario store) | ≥ 95% | coverage gate per-file |
| E2E critical flows covered of 14 (UF-001, 002, 003, 005, 006, 010, 011, 012) | 100% of the 8 P0 flows | Playwright list |
| Accessibility | 0 axe violations on all screens × 5 states | blocking |
| Property tests passing | 10,000 cases/run | CI |
| Oracle fixtures | 1 per engine (calendar, statements, consolidation, rounding, FVA) | CI |

**Coverage reduction is not allowed** without PR + `coverage-waiver.md` entry (audited, max 2 per release).

## 3. UNIT TEST SPECIFICS (what each layer must assert)

**Rust unit:** exact decimal results (e.g., `sumMoney(["1.10","2.20"]) == "3.30"`); rounding modes (HALF_UP, largest-remainder); calendar week counts (2026 NRF = 52 weeks; 2030 or next 53rd — fixtures); leap-year; Transit Period mapping; FX translation math (average/closing); IC elimination net=0; license signature accept/reject vectors; HMAC chain order + tamper detection.

**TS unit:** every component's 5 states render correctly (loading/empty/error/success/populated); aria/roles; MoneyCell formats (`1,234,567.89`, `000s`, `(1,234.00)`); store invalidation rules (STATE-MANAGEMENT table); zod schemas reject bad IPC payloads; debounce/fill interactions.

## 4. INTEGRATION TEST SPECIFICS

- Migration suite: `001` → latest applies; forward test on fixture Company; rollback test (failure injection).
- Import: real fixture files `tests/fixtures/*.xlsx/.csv` (SAP-style, Tally-style, EU locale, duplicate, 2M-row synthetic) → parse → map → validate → tie-out → commit → rollback.
- Connectors: mock HTTP (WireMock-style via `httpmock`) with recorded provider payloads — OAuth refresh, 429 backoff, cursor pagination, malformed payloads; contract tests per provider (CI network-off).
- IPC: every command has at least: happy path, validation error, permission/authz path, unexpected error → `INTERNAL` shape (never raw panic).
- Consolidation: fixture group (2 BU, mixed currency/calendar, 1 IC pair, NCI 80%) → known-answer totals (oracle).

## 5. E2E SPECIFICS (Playwright + tauri-driver)

- `e2e/smoke.spec.ts` — every screen loads (S-001…S-076) in all 5 states where applicable.
- `e2e/flows/*.spec.ts` — UF-001…UF-014 full journeys incl. failure branches (wrong PIN ×5, tie-out fail + exclude, IC unmatched, locked scenario, backup restore, license invalid).
- `e2e/a11y/keyboard.spec.ts` — keyboard-only versions of flows; focus-order assertions; no traps.
- OS matrix: run on `windows-latest`, `macos-latest`, `ubuntu-latest` with identical reports (B18-8). Sandbox limitations documented (reference project's F-02 — we test in CI runners, not the dev sandbox).

## 6. TEST DATA RULES

- Fixtures are **synthetic** (Demo Company): names like "Acme Manufacturing", amounts seeded, no real client data ever in repo.
- Production paths never use fixtures (B18-3) — fixture data only in `tests/fixtures/` and explicit Demo Company pack.
- Fixture generators: Python (dev-only, B13) for synthetic GL dumps + Rust property generators.

## 7. RULES

1. Red-green: every bug fix ships with a failing-first test (regression). 
2. No test written to pass on implementation details (react-test-renderer banned; use testing-library by role).
3. Time-sensitive tests use injected clock (fiscal engine takes `now: Instant`).
4. CI runs the full suite in < 10 min (sharded; no 80GB heap hacks — reference mistake).
5. Flaky-test policy: 2 flakes = disable + issue + owner; no `retry: 3` masking in release PRs.

*Referenced by: QA-CHECKLIST.md, CI-CD.md, DEFINITION-OF-DONE.md.*
