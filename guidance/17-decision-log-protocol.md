# 17 · Decision-log protocol (ADRs)

Architectural or behavioral decisions are recorded, not made in silence. This keeps the
"why" auditable (B20) and prevents future drift.

## Read first

- `docs/DECISIONS.md` — the ADR log (ADR-001…026+). Read the relevant ones before
  changing behavior they govern.
- `docs/ZERO-COMPROMISE-RULES.md` B20 — a new rule/major decision requires a Stage-0-style
  decision + the rules-file update.

## When you MUST record a decision

- You change behavior an existing ADR defines (update or supersede that ADR).
- You choose between real alternatives with lasting consequences (storage layout, an
  algorithm's rounding, a security parameter, disabling the updater, a new locked term,
  etc.).
- You add or change a B-rule (requires B20 process).
- You defer something to V2 (record it as deferred-by-design, not "done").

## When you must ASK the owner first

- The decision changes the **product** (a feature's behavior, scope, or a finance
  definition) and isn't already settled in `REMEDIATION-PLAN.md §1` or the specs.
- Present 2–3 concrete options in plain, non-technical language with a recommendation.
- Otherwise: take the best spec-consistent decision, record it, and note it under **Risks**.

## How to record an ADR

Append to `docs/DECISIONS.md` following the existing format:

```
## ADR-0NN — <short title>
- Status: Accepted (or Superseded by ADR-0MM)
- Date: YYYY-MM-DD
- Context: what forced the decision (cite specs/rules)
- Decision: what we chose, precisely
- Consequences: trade-offs, what this constrains going forward
- Alternatives considered: and why rejected
```

Then update anything the ADR touches (GLOSSARY, PRD, API-SPEC, the rules file, matrix,
`DOCS-INDEX.md`) in the **same** commit (B8), and run `npm run docs:verify`.

## The audit flagged these ADR gaps — fix as you touch the area

- Waiver fingerprint semantics under-documented (code/API agree, DECISIONS silent).
- ADR-011 (read-as-data), ADR-010 (report-not-exception + export health-run persistence),
  ADR-002/014/015/018/022 contradicted or unbuilt.
- New RFCs needed for KI-012/017/018.

Don't leave a decision embedded only in code or a commit message — if it matters enough to
choose, it matters enough to record.

## Anti-patterns (banned)

- Changing ADR-governed behavior without updating the ADR.
- A silent architectural choice with no record.
- Marking a V2-deferred item as "done".
- An ADR update without the dependent doc updates in the same commit.
