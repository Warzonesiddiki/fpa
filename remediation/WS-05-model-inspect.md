# WS-05 · Implement `model.inspect` natively

**Priority:** Phase B. **Decision:** D1. **Finding:** `model.inspect` has a Zod schema
(`src/api/schema.ts:1195`), a mock case (`src/api/mock.ts:2035`), and an API-SPEC row
(§; `{line_id, period_id}` → `{precedents[], dependents[], cycle?}`), but **no Rust
handler**. In the real desktop shell the call would fail. This is MVP scope (PRD F-012,
"Formula Inspection (precedents/dependents); Circular Reference detection").

## Objective

A native `model.inspect` handler that returns, for a given cell (`line_id`,
`period_id`): its formula, computed text, error code (if any), precedents, dependents,
and the cycle path when the cell is part of a circular reference (`#CYCLE!`).

## Why it matters (business terms)

"Formula Inspection" lets the user click a number and see exactly what feeds it and what
depends on it — essential for trusting a model. It is a promised MVP feature; a mock-only
version means it silently breaks in the shipped app.

## Read first

- `docs/FORMULA-ENGINE-SPEC.md` (esp. §6 inspection + circular-reference/`#CYCLE!` rules).
- `docs/API-SPEC.md` `model.inspect` row (contract).
- The mock at `src/api/mock.ts:2035` — the exact response shape to match:
  `{ line_id, period_id, formula, computed_text, error_code, precedents[], dependents[],
cycle, is_cycle }`.
- Existing formula/model code owner: `src-tauri/src/core/model.rs` and
  `src-tauri/src/commands/model.rs` (see `model_diff`, `model_recalc`,
  `model_cell_set_v1` for the pattern). **One owner per concern (B14):** the dependency
  graph / formula evaluation lives in the model core — extend it, do not fork.

## Files

- `src-tauri/src/commands/model.rs` — add `pub fn model_inspect(...) -> AppResult<Value>`
  following the standard handler pattern (session gate → ownership check → read → return
  `{ data: {...} }`). This is a **read**, so use the read-session gate and **no audit
  event** (reads are not mutations; confirm with B7 / `docs/audit` — reading is not
  audited).
- `src-tauri/src/core/model.rs` — if precedent/dependent extraction and cycle detection
  are not already exposed, add the function here (the graph owner) and call it from the
  command. Reuse the existing recalc/graph structures; do not build a second graph.
- `src-tauri/src/lib.rs` — register `model_inspect` in `generate_handler![...]`.
- `src-tauri/src/commands/model.rs` tests (or a `#[cfg(test)]` module) — unit tests:
  simple precedents/dependents, a formula error surfaces `error_code`, and a circular
  reference returns the `cycle` path with `is_cycle = true`.
- `src/api/schema.ts` — verify the response type matches the native output; tighten if
  the current schema is `unknown`/loose.
- Keep the mock in `src/api/mock.ts` (dev preview) consistent with the native shape.

## Contract (must match the mock + API-SPEC exactly)

Input: `{ line_id: string, period_id: string }` (scenario-agnostic read).
Output `data`:

```
{
  line_id, period_id,
  formula: string | null,
  computed_text: string | null,
  error_code: string | null,     // e.g. "#CYCLE!" mapped code, per FORMULA-ENGINE-SPEC
  precedents: CellRef[],
  dependents: CellRef[],
  cycle: string[] | null,        // path of cell refs when circular
  is_cycle: boolean
}
```

## Acceptance criteria

- `model_inspect` registered and returns the exact contract shape.
- Precedents/dependents/cycle come from the **existing** model graph (no second engine).
- Circular reference produces the `#CYCLE!` path per FORMULA-ENGINE-SPEC.
- Reads only; no audit event, no write.
- Rust unit tests cover normal, error, and cycle cases.
- Schema binding tightened to the real shape; mock stays consistent.

## Gates to run

```bash
npm run check
npm run build
# Rust: cargo test/clippy/fmt in CI (UNVERIFIED locally).
```

## Docs to sync

- `docs/API-SPEC.md` — confirm/complete the `model.inspect` row.
- `docs/FORMULA-ENGINE-SPEC.md` — if you clarify any inspection behavior.
- Traceability matrix / `docs/DOCS-INDEX.md` if text changes. Update F-012 status in
  `TASKBOARD.md`.
