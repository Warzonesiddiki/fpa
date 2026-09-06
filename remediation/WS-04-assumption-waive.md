# WS-04 · Persist & audit assumption waivers (wire UI → native)

**Priority:** Phase B. **Decision:** D2. **Finding:** `assumption_waive` is a fully
implemented, audited Rust handler registered in `lib.rs`, but it has **no schema binding,
no bridge case, and no frontend caller**. The S-044 UI waives hardcoded literals in
memory only (`src/stores/assumptions.ts:346` `waiveHardcoded`), so waivers are **not
persisted and not audited** — a direct B7 (every mutation is audited) violation.

## Objective

When a user waives a hardcoded-literal finding on S-044, the decision is persisted via
the native `assumption.waive` command, writes the audit event (already implemented in
Rust), and survives app restart.

## Why it matters (business terms)

A waiver is an auditor-relevant decision ("I accept this hardcoded number, here's why").
Today it vanishes when the app closes and leaves no trail. That is unacceptable for
audit-grade software — every such decision must be permanently logged.

## Ground truth (already exists in Rust)

`src-tauri/src/commands/assumption.rs::assumption_waive(app, model_id, cell_ref, reason,
state)`:

- gates on `require_session_write`,
- rejects empty reason with `VALUE_INVALID`,
- checks model ownership,
- inserts an `audit_events` row with the hash chain, action `assumption.waive`,
  object_type `assumption_waiver`, object_id = `cell_ref`,
- returns `{ data: { waived: true, cell_ref } }`.
  Registered in `lib.rs` line ~122. **Do not rewrite it** — wire the frontend to it.

## Files

- `src/api/schema.ts` — add `AssumptionWaiveArgs` Zod schema + `"assumption.waive"`
  binding in `CommandArgs` (mirror the existing `assumption.upsert` entry).
- `src/api/mock.ts` — add a `case "assumption.waive":` for the dev preview that mirrors
  the native contract (validate reason, return `{ data: { waived: true, cell_ref } }`,
  and record it in the in-memory waiver map used by `find_usages`/health so the preview
  stays consistent).
- `src/stores/assumptions.ts` — change `waiveHardcoded` (and `unwaiveHardcoded` if a
  native un-waive exists; if not, keep un-waive session-local and note it) to `await
call("assumption.waive", {...})`, then update local state from the response. Handle the
  typed error path (set `hardcodeError` from the bridge error).
- `src/pages/s044-assumptions.tsx` — `confirmWaive` must handle the now-async store call:
  loading state on the button, error surfaced inline, success clears the form. Ensure all
  5 states remain intact.
- `src/pages/s044-assumptions.test.tsx` + `src/stores/assumptions-hardcode.test.ts` —
  update/extend tests: success persists via `call`, empty reason rejected, error surfaced.

## Decisions to make correctly

- **Arg shape:** the Rust handler takes `{ model_id, cell_ref, reason }`. The store's
  `HardcodedFinding`/`HardcodedLiteral` must map to a single `cell_ref` string — use the
  same `hardcodeFindingKey(finding, literal)` value the UI already uses as the key, and
  confirm it matches what the Rust side expects as `cell_ref`. If the Rust `cell_ref`
  semantics differ, align the frontend to the Rust contract (docs win) and note it.
- **Un-waive:** check whether a native un-waive exists. If not, do **not** invent one in
  this WS — keep un-waive removing the local display only, and record in Risks that
  audited un-waive is a follow-up (or add it properly if the spec calls for it).

## Acceptance criteria

- Waiving a finding on S-044 calls `assumption.waive`; in the real shell it persists and
  writes an audit event (verify the audit row via S-070 Audit screen in a manual/e2e
  check, or in the mock's audit list for the dev preview).
- No orphan handler: `assumption.waive` now has schema + bridge/mock + caller.
- Empty reason is rejected with the verbatim ERROR-HANDLING copy.
- All 5 states present on S-044; typed errors only.
- Tests updated and green.

## Gates to run

```bash
npm run check          # lint · tsc · fmt · vitest · schema-equality · docs · packs · money · security
npm run build
# Rust unchanged (handler already exists) → cargo runs in CI.
```

## Docs to sync

- `docs/API-SPEC.md` — ensure `assumption.waive` row exists with args/returns/errors.
- `docs/ERROR-HANDLING.md` — confirm the reason-required code is listed.
- `docs/traceability` / `docs/DOCS-INDEX.md` if any spec text changes.
- `AUDIT-2026-09-06-fresh.md` §4 — mark the finding resolved (optional).
