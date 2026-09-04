# AGENTS.md

> **Pointer file.** The canonical rulebook for any coding agent (Claude, Codex, Cursor, Copilot, others) is
> [`docs/CLAUDE.md`](docs/CLAUDE.md). Read it plus [`docs/ZERO-COMPROMISE-RULES.md`](docs/ZERO-COMPROMISE-RULES.md)
> before editing. Keeping duplicated rules here would break the one-source-of-truth rule (B8/B9), so this file only
> routes you to the right document and states what fails a PR.
>
> Note: `.github/copilot-instructions.md` is intentionally absent — `.github/` is git-ignored in this repo
> (Actions are disabled; see `HANDOVER.md` §3 and TASKBOARD M7-1), so a Copilot file there would never be tracked.
> Copilot/other agents: read this file.

## What this product is

OneFP&A — a **local-first, offline, single-user desktop FP&A suite** (Windows · macOS · Linux) built as
**Tauri 2 + Rust core + React 19/TypeScript**, storage is **SQLite in Rust only**, and the whole product surface is:
import → model → plan → analyze → report → govern. It has **no server, no account backend, no telemetry, no web runtime**.

## Documents that decide your task

| Question you are asking                                         | Read                                                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| What is the exact term for this thing?                          | `docs/GLOSSARY.md` (banned synonyms are binding)                                              |
| Is this in scope for v1.0.0?                                    | `docs/PRD.md` §2 MVP, §5 `NOT BUILDING`                                                       |
| What must the screen contain, in which region, in all 5 states? | `docs/SCREENS-SPEC.md` + `docs/WIREFRAMES-CORE.md` / `docs/WIREFRAMES-ANALYTICS.md`           |
| How does the user-facing sentence read?                         | `docs/COPY-GUIDELINES.md` (errors: `docs/ERROR-HANDLING.md` verbatim)                         |
| How is this value computed/rounded?                             | `docs/MONEY-ROUNDING-SPEC.md`, `docs/FORMULA-ENGINE-SPEC.md`, `docs/MODELING-METHODS-SPEC.md` |
| What command/IPC shape do I implement?                          | `docs/API-SPEC.md` (Rust serde structs first, then regenerate specta, then Zod)               |
| Which table/column/index?                                       | `docs/DATABASE-SCHEMA.md` (migration + `schema-equality-check` is blocking)                   |
| What is "done"?                                                 | `docs/DEFINITION-OF-DONE.md` + `docs/QA-CHECKLIST.md`                                         |
| What is the build order right now?                              | `TASKBOARD.md` then `HANDOVER.md` §2                                                          |
| Why was it decided this way?                                    | `docs/DECISIONS.md` (ADR-001…026)                                                             |

## Non-negotiables (violating any of these voids the change)

1. **Money is exact.** `i64` minor units / decimal strings; `rust_decimal` in the core; no `f64`, `parseFloat`,
   `toFixed`, `Math.round`, no `REAL` column for money. `npm run money:ast` is the gate.
2. **One owner per concern** (B14): Money Core, Calendar engine, Formula engine, Ingestion pipeline. Extend the
   owner; never write a second implementation.
3. **No server, no runtime `.env`, no telemetry, no cloud sync** (B1/B18-9). Secrets go to the OS keychain.
4. **Industry behavior is Pack data** (B15) — no per-industry code, page, or engine.
5. **All 5 states + typed errors ship in the same PR as the feature** (B12/B18-5/6). No placeholder, no
   "handled later", no invented capability behind a UI control.
6. **Every mutation writes an audit event**; locked/immutable artifacts are never edited in place (B7).
7. **Docs win.** If code and spec disagree, the code is the bug; changing a spec means updating
   `docs/DOCS-INDEX.md` and the traceability matrix in the same PR (B8).

## Verification before you report back

```bash
npm run check          # lint · typecheck · vitest · docs:verify · packs:validate · money:ast · security scans
cargo test             # + cargo clippy -- -D warnings · cargo fmt --check
npm run docs:verify    # run this whenever you touch docs/
```

Report using the format in `docs/CLAUDE.md` §7. Never call a gate green without pasted output, and mark
native/desktop-only gates as unverified when your environment cannot run them — a `🚧 PARTIAL` is honest, a
false ✅ ends the PR.
