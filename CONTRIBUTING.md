# Contributing to OneFP&A

> **Pointer file.** The canonical rulebook is
> [`docs/CLAUDE.md`](docs/CLAUDE.md) + [`docs/ZERO-COMPROMISE-RULES.md`](docs/ZERO-COMPROMISE-RULES.md).
> This file covers the practical path for a human contributor.

## The bar

This project ships to real finance teams. Every change lands through the full gate —
there are no "just a quick fix" lanes:

```bash
npm install
npm run check        # lint + typecheck + prettier + rustfmt(WASM) + vitest + coverage gates
                     # + schema/docs/money/token/ipc-casing/command-parity/security gates
```

CI runs the same gate plus `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`,
`cargo test` on Linux/macOS/Windows, Playwright smoke, and dependency audits. A red CI is a
blocked PR, always.

## Where things are

| Path                                                                    | Role                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `docs/CLAUDE.md`                                                        | The coding rulebook (read before editing anything)           |
| `TASKBOARD.md`                                                          | Living work board — milestones, status, remaining named work |
| `remediation/WS-*.md`                                                   | Step-by-step work cards                                      |
| `guidance/`                                                             | Playbooks (add a command, add a screen, money, testing…)     |
| `docs/DECISIONS.md`                                                     | ADRs — architecture decisions are recorded, never implicit   |
| `docs/API-SPEC.md`, `docs/DATABASE-SCHEMA.md`, `docs/ERROR-HANDLING.md` | The locked contracts a change must respect                   |
| `audits/`                                                               | Dated audit/handover artifacts (read-only history)           |

## Workflow

1. **Branch** from `main` (`feat/…`, `fix/…`, `ws-XX-…` — see `docs/GIT-STANDARDS.md`).
2. **Small vertical slices.** A change crosses every layer it touches: schema →
   Rust command → Zod contract → mock → tests → docs. Half-slices don't merge.
3. **Run `npm run check` locally** before pushing. Rust formatting is verified without a
   toolchain (`fmt:rust`, ADR-031); clippy/test run in CI.
4. **Update the docs in the same commit** — the docs are machine-checked against the code
   (`docs:verify`, `command:parity`, `schema-equality`), so stale docs fail the gate, not a review.
5. **PR → CI green → review → merge.** Never merge red. Conventional Commits messages.

## Money, audit, offline

Three invariants override convenience: money is integer minor units (never floats —
`money:ast` enforces it), every mutation writes an HMAC-chained audit event, and nothing
phones home (`telemetry-scan`). If your change touches any of these, read the corresponding
spec first (`docs/MONEY-ROUNDING-SPEC.md`, `docs/AUTH-SPEC.md` §2, B18-9).

## License

MIT — see [`LICENSE`](LICENSE). By contributing you agree your contribution is licensed
under it.
