# WS-07 · Implement `company.archive_year` natively

**Priority:** Phase B. **Decision:** D1. **Finding:** `company.archive_year` has a Zod
schema (`src/api/schema.ts:2640`), an API-SPEC row (§2.1: `{company_id, fy_label}` →
`{affected_periods}`, error `ARCHIVE_IN_USE`), and a note at `docs/API-SPEC.md:325` that
"no Fiscal Year can be archived yet (`company.archive_year` lands with the archive
schema)", but **no Rust handler**. MVP scope (PRD F-001 "archive years"; also F-037
"archive years (compress, restorable)").

## Objective

A native `company.archive_year` handler that detaches/archives a Fiscal Year once nothing
references it, returning the count of affected periods — and refuses with `ARCHIVE_IN_USE`
when the year is still referenced.

## Why it matters (business terms)

Closing and archiving a fiscal year keeps the working file lean while preserving history.
The contract is designed but the engine isn't built — so the button would fail. This
completes a promised MVP capability.

## Read first

- `docs/API-SPEC.md` §2.1 `company.archive_year` and line ~325 (the "not yet" note to
  update).
- `docs/DATABASE-SCHEMA.md` — **the archive schema.** The API-SPEC note says the command
  "lands with the archive schema", implying tables/columns may need to exist. Verify what
  archive storage exists; if a migration is required, add it per the schema doc and the
  `schema-equality-check` gate (blocking).
- PRD F-001 and F-037 (archive = compress, restorable).
- **One owner per concern:** company lifecycle lives in
  `src-tauri/src/commands/company.rs` (`company_create/open/clone_sandbox/delete`).
  Extend it. Calendar/fiscal-year truth lives in the calendar core — use it to resolve
  `fy_label` → periods; do not re-derive the calendar.

## Files

- `src-tauri/src/commands/company.rs` — add `pub fn company_archive_year(app, company_id,
fy_label, state) -> AppResult<Value>`:
  1. session write gate + ownership,
  2. resolve the Fiscal Year's periods via the calendar owner,
  3. **reference check**: if any model value / driver value / scenario / statement / audit
     dependency still points at those periods, return `ARCHIVE_IN_USE` (verbatim copy),
  4. inside a transaction, move/mark the year's data as archived per the archive schema
     (compress/restorable per F-037 — follow DATABASE-SCHEMA; if full compression is a
     larger effort, implement the archive-detach that the contract promises and record any
     restore-compression follow-up in Risks, but do NOT ship a stub that claims more than
     it does),
  5. **write an audit event** (this is a mutation, B7),
  6. return `{ data: { affected_periods: <count> } }`.
- Migration file under `src-tauri/migrations/` (or wherever migrations live) if the
  archive schema is not fully present — must match `docs/DATABASE-SCHEMA.md` so
  `schema-equality-check` passes.
- `src-tauri/src/lib.rs` — register `company_archive_year`.
- Tests: archive a clean year → returns affected count + audit row; archive a referenced
  year → `ARCHIVE_IN_USE`, no partial write.
- `src/api/schema.ts` / `src/api/mock.ts` — align shapes (add a mock case if missing).
- Frontend: wire the archive action in the Company/Companies screen (S-020) with all 5
  states and the `ARCHIVE_IN_USE` error surfaced.

## Contract

Input: `{ company_id: string, fy_label: string }`.
Output: `{ affected_periods: number }`. Error: `ARCHIVE_IN_USE` (verbatim).

## Acceptance criteria

- `company_archive_year` registered; refuses referenced years with `ARCHIVE_IN_USE`.
- Uses the calendar owner for period resolution (no re-derivation).
- Archive is restorable per F-037 (or the exact delivered scope is documented; no
  over-claiming).
- Mutation writes an audit event; transactional (no partial archive).
- If schema changed: migration added, `schema-equality-check` green, DATABASE-SCHEMA
  updated.
- API-SPEC line ~325 "not yet" note updated to reflect it now works.

## Gates to run

```bash
npm run check          # schema-equality-check must pass (blocking if you touch schema)
npm run build
# Rust: cargo test/clippy/fmt in CI.
```

## Docs to sync

- `docs/API-SPEC.md` §2.1 + line ~325.
- `docs/DATABASE-SCHEMA.md` (+ migration) if schema changed.
- `docs/ERROR-HANDLING.md` — `ARCHIVE_IN_USE` present.
- PRD F-001/F-037 status in `TASKBOARD.md`; traceability; `docs/DOCS-INDEX.md`.
