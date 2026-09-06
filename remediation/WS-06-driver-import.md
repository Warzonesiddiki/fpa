# WS-06 · Implement `driver.import` natively

**Priority:** Phase B. **Decision:** D1. **Finding:** `driver.import` has a Zod schema
(`src/api/schema.ts:1343`), a mock case (`src/api/mock.ts:2990`), and an API-SPEC row
(`{file_path, mapping_id}` → `{batch_id}`, errors `IMPORT_*`), but **no Rust handler**.
MVP scope (PRD F-023, Input Collection Loop: export driver sheets → fill in Excel →
re-import → merge with audit).

## Objective

A native `driver.import` handler that reads a filled-in driver workbook, maps it via the
saved mapping, validates it, and loads driver period values into the model — writing an
audit trail — returning a `batch_id`.

## Why it matters (business terms)

This is the "send a spreadsheet to a colleague, they fill in the driver numbers, you
import it back" loop. Without a native handler it works only in the dev preview and fails
in the real app — breaking a core planning workflow.

## Read first

- `docs/API-SPEC.md` `driver.import` row and §2 import pipeline.
- `docs/MODELING-METHODS-SPEC.md` (driver semantics) and PRD F-023.
- **One owner per concern (B14):** ingestion has a single owner —
  `src-tauri/src/commands/import.rs` (`import_parse`, `import_map_save_v1`,
  `import_validate`, `import_commit`, `import_rollback`, `import_history`). Reuse this
  pipeline; do NOT write a second parser/mapper. `driver.import` is "the import pipeline
  targeting driver values" (the mock comment even says so: "`import.parse` pipeline").
- Driver write owner: `src-tauri/src/commands/driver.rs` (`driver_upsert`,
  `driver_set_value`). Driver values must go through the driver owner with bounds checks
  (`DRIVER_OUT_OF_BOUNDS`).
- Mock error contract to mirror: `IMPORT_FILE_LOCKED` (password-protected),
  `IMPORT_FILE_UNREADABLE` (unreadable), returns `{ batch_id }`.

## Files

- `src-tauri/src/commands/driver.rs` (or `import.rs` — place with whichever owner is most
  natural; prefer extending `import.rs` since it is the ingestion owner, and have it call
  the driver writer). Add `pub fn driver_import(app, file_path, mapping_id, state) ->
AppResult<Value>`.
- Pipeline: session write gate → resolve saved mapping (`mapping_id`) → parse workbook
  via the **existing** calamine-based parser → map columns → validate each value
  (bounds, types) → write driver period values through the driver owner → record an
  `import_batches` row and **audit events** → return `{ data: { batch_id } }`.
- Money/number safety: any numeric parsing uses the exact-decimal path, never `f64`.
- `src-tauri/src/lib.rs` — register `driver_import`.
- Tests (`#[cfg(test)]`): happy path returns a batch id and writes values + audit;
  locked file → `IMPORT_FILE_LOCKED`; unreadable → `IMPORT_FILE_UNREADABLE`;
  out-of-bounds value → `DRIVER_OUT_OF_BOUNDS`.
- `src/api/schema.ts` / `src/api/mock.ts` — keep the shapes aligned with native.
- Frontend caller: confirm which screen triggers driver import (S-043 Drivers /
  Collection loop). If a UI entry point is missing, either wire it (preferred, keeps the
  feature usable) or confirm it already calls `call("driver.import", ...)`.

## Contract

Input: `{ file_path: string, mapping_id: string }`.
Output: `{ batch_id: string }`. Errors: `IMPORT_FILE_LOCKED`, `IMPORT_FILE_UNREADABLE`,
plus validation codes (`DRIVER_OUT_OF_BOUNDS`, `MAP_TARGET_INVALID`, etc.) per
ERROR-HANDLING — all verbatim.

## Acceptance criteria

- `driver_import` registered; reuses the ingestion pipeline and the driver owner (no
  second implementation).
- Rollback-safe: a failed import does not partially write (transaction).
- Every write path produces audit events (B7).
- No float in numeric parsing (`money:ast` stays green; decimals via `rust_decimal`).
- Rust tests cover happy + locked + unreadable + bounds paths.
- Errors verbatim from ERROR-HANDLING.

## Gates to run

```bash
npm run check
npm run build
# Rust: cargo test/clippy/fmt in CI.
```

## Docs to sync

- `docs/API-SPEC.md` — confirm/complete the `driver.import` row.
- `docs/DATABASE-SCHEMA.md` — if `import_batches` usage changes.
- `docs/ERROR-HANDLING.md` — ensure all referenced codes exist.
- `TASKBOARD.md` F-023 status; traceability matrix; `docs/DOCS-INDEX.md` if text changes.
