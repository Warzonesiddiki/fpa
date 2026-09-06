# 04 · Error-handling playbook

Errors are a **typed, closed taxonomy** (B12). Every error the API can return is defined
once in `docs/ERROR-HANDLING.md`, mapped in Rust `core/error.rs`, and surfaced with
verbatim copy. Inventing a code or paraphrasing copy voids the change.

## The rule

- **Never invent an error code.** Use one that exists in `docs/ERROR-HANDLING.md`.
- **Never paraphrase error copy.** The user-facing message is verbatim from the spec.
- Every code referenced by the API must be **defined** (the `docs:verify` /
  error-taxonomy test enforces completeness — currently 99 codes).

## Anatomy of an error (both sides)

Rust (`core/error.rs`): the `AppError` enum + `body()` produce an `ErrorBody`
(`code`, `userMessage`, `httpStatus`, `retryable`, `retryAfterMs`, `details`). There are
builder helpers, e.g. `AppError::invalid(...)`, `AppError::driver_out_of_bounds(...)`,
`AppError::formula_cycle(path)`. **Reuse a builder**; only add a new variant if the code
is genuinely new.

TypeScript (`src/api/bridge.ts`): `toBridgeError` normalizes into `BridgeError`
(`code`, `userMessage`, `httpStatus`, `retryable`, `retryAfterMs`, `details`). The UI
reads these fields.

## To surface an existing error in the UI

```ts
try {
  await call("cmd", args);
} catch (e) {
  const err = e as BridgeError;
  // show err.userMessage; show a Retry button only if err.retryable;
  // if err.retryAfterMs != null, disable retry for that long.
}
```

Pass `err.code` to `StatePanel errorCode=` so the error state is typed (B12).

## To add a genuinely new error code (rare)

1. **Spec first:** add the row to `docs/ERROR-HANDLING.md` (code, HTTP status, retryable,
   the verbatim user message, when it fires). Update `docs/DOCS-INDEX.md`/matrix if needed.
2. **Rust:** add the variant/builder in `core/error.rs`, mapping to that exact code and
   copy; wire `body()`.
3. **API-SPEC:** list the code on every command that can return it (`docs/API-SPEC.md`).
4. **Mock:** if the dev preview can hit the path, return the same `code`/message.
5. **UI:** handle it (retry semantics, read-only, inline vs banner per COPY-GUIDELINES).
6. **Test:** assert the code is returned and surfaced.

## Retry & read-only semantics (get these right)

- `retryable` must reflect reality — do not attach an unconditional `onRetry` to a
  non-retryable error.
- Honor `retryAfterMs` in the UI when present.
- Read-only situations (locked scenario, read-only session/2nd instance, license limits)
  use the defined codes and disable controls with an explaining `title`, not a silent
  no-op.

## Verify

```bash
npm run docs:verify     # error-taxonomy completeness (every referenced code defined)
grep -n "MY_CODE" docs/ERROR-HANDLING.md src-tauri/src/core/error.rs src/api/*.ts
```

## Anti-patterns (banned)

- Inventing `READ_ONLY_MODE`, `MONEY_FORMAT_INVALID`, etc. that aren't in the spec.
- Non-verbatim copy for `VALUE_INVALID`, `INTERNAL`, etc.
- A generic `catch` that swallows the typed code and shows a generic string.
- Mapping every failure to `INTERNAL` instead of the specific documented code.
