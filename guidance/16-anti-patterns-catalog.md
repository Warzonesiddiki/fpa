# 16 · Anti-patterns catalog — the fast "is this allowed?" lookup

If what you're about to do appears here, **stop**. Each maps to a rule that ends a PR.
Grouped for quick scanning.

## Money & numbers

- ❌ `f64`/`f32` anywhere near money · `parseFloat` · `toFixed` · `Math.round/floor/ceil`
  on money · `.toNumber()` on a money Decimal · `REAL` money column · `Decimal(number)`
  from a float. → B3/I1. Gate: `money:ast`, `schema-equality-check`.

## Architecture & ownership

- ❌ A second implementation of money / calendar / formula / ingestion. → B14.
- ❌ Per-industry code, page, or `if (industry === …)`. → B15.
- ❌ Local financial computation in a React store/component. → B6.
- ❌ A screen calling `invoke`/`fetch` directly instead of a store + `bridge.ts`.

## API surface

- ❌ A command registered in Rust but with no caller (orphan handler).
- ❌ A schema/mock command with no native handler (mock-only MVP command).
- ❌ A handler not added to `lib.rs generate_handler!` (dead code / 404 in shell).
- ❌ Command shape in code ≠ `docs/API-SPEC.md`.

## Errors & copy

- ❌ Inventing an error code not in `docs/ERROR-HANDLING.md`.
- ❌ Paraphrasing error/user copy (must be verbatim).
- ❌ Collapsing distinct errors into `INTERNAL`.
- ❌ Unconditional `onRetry` on a non-retryable error; ignoring `retryAfterMs`.
- ❌ Banned synonyms from `docs/GLOSSARY.md` (code/copy/comments/commits).

## Audit & security

- ❌ A mutation with no `audit_events` row. → B7.
- ❌ Editing a locked/immutable artifact in place. → B7.
- ❌ Telemetry/analytics/beacon; any product-path network call (except the **signed**
  updater). → B1/B18-9.
- ❌ Secrets in code/files/env; committing a private key; bypassing the OS keychain.
- ❌ Runtime `.env`; online license/feature check.

## UI completeness

- ❌ A screen missing any of the 5 states; simulating a state with a constant.
- ❌ Hardcoded English (bypassing i18n); ad-hoc `Intl` on authoritative money.
- ❌ Non-axe-clean populated state; not keyboard-operable.
- ❌ Bypassing design tokens / re-implementing an existing UI primitive.

## Data & schema

- ❌ Editing a shipped migration in place.
- ❌ Schema change without a migration or without updating `DATABASE-SCHEMA.md`.
- ❌ Deleting rows that break the audit hash chain.

## Process & honesty

- ❌ Claiming a gate green without pasted output.
- ❌ Marking a Rust change ✅ you couldn't compile (use `🚧 UNVERIFIED`).
- ❌ `TODO`/`FIXME`/`skip`/`.only`/`continue-on-error`/`|| true`/`--skip` to pass.
- ❌ Lowering a coverage/threshold instead of adding tests.
- ❌ Mock data in a production path.
- ❌ Batching unrelated changes in one commit; "docs in a later commit."
- ❌ Pushing to any branch but `arena/01a0760c-fpa`.
- ❌ Editing the repo root/`.git`, or deleting `docs/` files to force a gate green.

## The test

Ask: _"Would an auditor tracing this number, this action, and this claim be satisfied?"_
If not, it's an anti-pattern — fix it before proceeding.
