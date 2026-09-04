# CLAUDE.md

> **This file is a pointer, not a source of truth.** The canonical coding-AI rulebook for this repo is
> [`docs/CLAUDE.md`](docs/CLAUDE.md) — read all of it before editing anything. Root copies of the rules
> are forbidden (rule B9/B8: one source of truth, all docs indexed). This file exists so agents that
> auto-load only the repository root still find the rules.

## Read in this order

1. [`docs/GLOSSARY.md`](docs/GLOSSARY.md) — locked terms; never invent a synonym.
2. [`docs/PRD.md`](docs/PRD.md) — 38 MVP features, V2/FUTURE, and the binding `NOT BUILDING` list.
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Rust core owns the math; React/TS is the view.
4. [`docs/CLAUDE.md`](docs/CLAUDE.md) — DO / DON'T / forbidden patterns / response format.
5. [`docs/ZERO-COMPROMISE-RULES.md`](docs/ZERO-COMPROMISE-RULES.md) — B1–B20, the rules that end a PR.
6. Task-specific spec, then code. Money work: [`docs/MONEY-ROUNDING-SPEC.md`](docs/MONEY-ROUNDING-SPEC.md) first.
7. Current state and next task: [`TASKBOARD.md`](TASKBOARD.md), then [`HANDOVER.md`](HANDOVER.md).

## Hard rules (the ones that void a PR — full list in docs/CLAUDE.md §5–§6)

- Money is never a float: `i64` minor units or decimal strings, `rust_decimal` in the core, `npm run money:ast` must stay green (B3/I1).
- No HTTP server, no `.env` runtime config, no telemetry, no cloud sync (B1, B18-9). Dev web preview is tooling, never a product surface.
- One owner per concern: money, calendar, formulas, ingestion live in exactly one place each (B14).
- Industry behavior is Pack **data**, never per-industry code (B15).
- Every screen ships all 5 states; every failure ships a typed code from `docs/ERROR-HANDLING.md` (B12, B18-5/6).
- Every mutation writes an audit event (B7). Never edit a locked artifact — create a new one.
- No `TBD`, no `skip`, no `continue-on-error`, no mock data in a production path, no half-built feature (B10, B18-7, B20).
- Docs are the source of truth: if code contradicts a spec, the code is the bug — and any spec change updates `docs/DOCS-INDEX.md` (B8).

## Commands

```bash
npm run check            # lint + typecheck + vitest + docs:verify + packs + money:ast + security scans
cargo test               # Rust engines (also: cargo clippy -- -D warnings, cargo fmt --check)
npm run docs:verify      # doc suite integrity gate
npm run tauri:dev        # native desktop app
```

## Before reporting back

Use the exact response format in `docs/CLAUDE.md` §7 (Summary / Files / Tests / Gates / Docs synced / Risks), and never
claim a gate is green without its pasted output. Native-only gates you could not run must be reported as unverified,
not as passing.
