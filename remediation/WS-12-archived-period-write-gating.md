# WS-12 · Write-gate mutations into archived periods

**Priority:** Phase B (follow-up to WS-07, named at ADR-032). **Decision:** D1.
**Status:** 🚧 NOT STARTED (design recorded; deliberate deferral, not an oversight).

**Finding.** `company.archive_year` (WS-07) detaches a Fiscal Year by stamping
`fiscal_years.archived_at`. Commands that resolve a period and mutate through it
(`model.cell.set.v1`, `driver.set_value`, `import.commit` line posting, scenario writes)
do not yet consult the mark: an archived year can still be written into through the
back door of a stale model/import mapping. Archive without write-gating is a label, not
a lock.

## Objective

One shared guard — `assert_periods_active(tx, period_ids) -> AppResult<()>` in
`commands/company.rs` next to `archived_fy_count` — refusing with `ARCHIVE_IN_USE`
(any-write variant, user text: "This Fiscal Year is archived. Restore it before
writing to it.") when a mutation targets a period under an archived FY. Applied at
every period-resolution point in the mutation path.

## Why it was deferred

It touches every writing command (a wide, risk-heavy sweep across model/driver/import/
scenario modules) and MUST be developed with local `cargo test` verification, not
blind CI round-trips. Shipped instead in the 2026-09-08 batch: the user-visible gaps
(restore, clone guard) and the machine guard that makes the next sweep safe
(`command:parity`, migration-equality test).

## Read first

- `remediation/WS-07-company-archive-year.md` (the mark's semantics),
  `docs/API-SPEC.md` §2.1 archive notes, `docs/ERROR-HANDLING.md` §D.
- `src-tauri/src/commands/company.rs` — `archived_fy_count` (the clone guard's COUNT
  pattern to mirror for period sets), `require_company_write` (session-level gate —
  this card is the object-level complement, AUTH-SPEC §3 rule 2).

## Definition of done

- Guard + wiring in every mutating command that resolves periods; unit tests per
  command (write to active FY ✓ / archived FY → `ARCHIVE_IN_USE` / restore → write ✓);
  API-SPEC + ERROR-HANDLING rows updated; `command:parity`, `docs:verify`, full
  `npm run check`, CI green on all three OS.
