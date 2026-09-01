# tests/fixtures/calendar/

Calendar engine oracle fixtures (TEST-FIXTURES-SPEC §1; matrix F-003). Synthetic,
deterministic, data-only (no code) — B5/B18-3.

| File | Content |
|---|---|
| `nrf-454-2024-2028.json` | NRF 4-5-4, FY start anchor 2024-02-01 (sunday-nearest), 5 years: exact start/end/week counts (52/52/52/52/**53**), FY2028 53rd week absorbed into P12 (no W53 code); full-week variant W53 = 2029-01-28→2029-02-03; retail-2026 P06 spot check. Source: `core/calendar.rs::nrf_oracle_2024_2028` (published/derived NRF schedule). |
| `nrf-544-expected.json` | 5-4-4 **structural invariants** only (engine-documented): quarter week-pattern [5,4,4] over 12 periods (52w year); a 53w year appends an explicit **W53** (13 periods — the 4-day absorption rule is 4-5-4 exclusive, `CAL_53WEEK_CONFLICT`); day-sum/contiguity rules. No hand-computed dates — per-date values are engine outputs asserted in cargo. |
| `nrf-3334-expected.json` | 3-3-3-4 **structural invariants** only (engine-documented): 13 periods always (periods-per-quarter 3+3+3+4, 4 weeks each in a 52w year); 53w year absorbed into **P13** (5 weeks, flagged, no W53 code). Same honesty note. |

**Consumers:**
- `core/calendar.rs` cargo tests (CI): `fixture_nrf_454_2024_2028_matches_engine`,
  `fixture_nrf_544_satisfies_invariants`, `fixture_nrf_3334_satisfies_invariants` —
  bind the engine to these files (fixture edit or engine regression fails CI).
- `src/test/calendar-fixtures.test.ts` (sandbox-runnable): file integrity +
  internal consistency (consecutive years, day sums, pattern/code shape).

Regeneration: there is no generator — these files mirror the oracle assertions in
`core/calendar.rs` (which cite the published/derived NRF schedule). Update them
together when the engine's oracles change, and re-run both test suites.
