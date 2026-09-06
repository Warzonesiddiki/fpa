# Agent Guidance Library — Index

These are **operational playbooks** for the agentic AI building OneFP&A. They tell you
_how to build correctly in THIS repository_ — the mechanical recipes, checklists, and
guardrails that the canonical specs assume but don't spell out step-by-step.

> **Critical rule (B8/B9 — one source of truth):** these playbooks **route you to** the
> canonical specs in `docs/`; they never restate spec content. If a playbook and a
> `docs/` spec ever disagree, **the `docs/` spec wins** and you flag the drift. Do not
> copy rules, numbers, formulas, schemas, or error copy out of `docs/` into anything else.

## Read order

1. `../AGENT-GUIDANCE.md` — mindset, non-negotiables, verification loop, report format.
2. `../REMEDIATION-PLAN.md` + `../remediation/` — the current backlog to execute.
3. These playbooks (below) — the how-to reference you consult while building.

## The library

| File                            | Use it when…                                                        |
| ------------------------------- | ------------------------------------------------------------------- |
| `01-repo-map.md`                | You need to find where a concern lives (money, calendar, a screen). |
| `02-add-a-command.md`           | Adding or changing a Tauri command end-to-end (Rust→schema→UI).     |
| `03-add-or-change-a-screen.md`  | Building/editing any of the 42 screens (5 states, a11y, i18n).      |
| `04-error-handling-playbook.md` | Surfacing or adding a typed error code.                             |
| `05-money-and-numbers.md`       | Touching anything numeric/financial.                                |
| `06-database-and-migrations.md` | Changing the SQLite schema / writing a migration.                   |
| `07-audit-and-security.md`      | Any mutation, secret, license, or export path (B7/B1).              |
| `08-testing-playbook.md`        | Writing unit / component / e2e / property / a11y tests.             |
| `09-packs-playbook.md`          | Editing or issuing an Industry Pack (data only, B15).               |
| `10-formula-engine-playbook.md` | Touching formulas, drivers, analysis functions.                     |
| `11-state-i18n-design.md`       | Frontend state, i18n copy, design tokens, components.               |
| `12-git-commit-pr-playbook.md`  | Committing, branching, opening a PR, writing the report.            |
| `13-definition-of-done.md`      | The final gate before you call anything "done".                     |
| `14-glossary-quickref.md`       | Naming anything user-facing (avoid banned synonyms).                |
| `15-performance-and-scale.md`   | Anything touching large data, grids, recalc, export perf.           |
| `16-anti-patterns-catalog.md`   | A fast "is this allowed?" lookup of banned patterns.                |
| `17-decision-log-protocol.md`   | You must make or record an architectural decision (ADR).            |
| `18-troubleshooting-sandbox.md` | Gates behave strangely / `node_modules` vanished / no cargo.        |

## The one-paragraph version

Read the spec, find the single owner of the concern, extend it (never fork), ship all 5
states + typed errors + an audit event for mutations, keep money exact, add tests, sync
docs in the same commit, run every gate and paste real output, and report honestly. A
gate you didn't run is `🚧 UNVERIFIED`, never ✅.
