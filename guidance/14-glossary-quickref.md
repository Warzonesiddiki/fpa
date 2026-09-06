# 14 · Glossary quick-reference (naming discipline)

`docs/GLOSSARY.md` is **binding**: it locks the exact term for every concept and lists
**banned synonyms**. Using a banned synonym — in code identifiers, UI copy, comments,
docs, or commit messages — voids the change (B8/B9; `docs:verify` scans for banned terms).

> **This is a pointer, not a copy.** Always confirm the exact locked term in
> `docs/GLOSSARY.md`. The list below only reminds you _that a term is locked_ so you go
> check before naming things.

## Rule of thumb

Before you name a variable, function, screen label, error, table, or write copy: **grep
the glossary** for the concept and use the locked term verbatim.

```bash
grep -in "<the word you're about to use>" docs/GLOSSARY.md
npm run docs:verify        # includes the banned-term scan
```

## Known live-debt areas (the audit found bleed — be extra careful here)

These concepts have historically drifted to banned synonyms. Confirm the locked term
before using any of them:

- Model / Sheet / Cell (vs "workbook", "spreadsheet", "tab").
- Import / Import Hub (vs "upload").
- Recalculate (vs "sync", "refresh").
- Company / Business Unit (BU) / Collection (vs "workspace", "entity", "department").
- Driver / Assumption (vs "metric", "parameter" where locked).
- Scenario / Baseline / What-if overlay (vs "version" where locked).
- Command / Bridge (IPC) vs UI "action".
- GL account / Chart of Accounts (vs "ledger", "category", "tag" where locked).
- Plan / Budget / Forecast / Rolling Forecast (use the precise locked one).
- Secret / Keychain (vs "vault", "password" where locked).
- Audit event / Audit trail (vs "log", "history" where locked).

## When you think the glossary is missing a term

Don't invent one. Propose it: add the term to `docs/GLOSSARY.md` with its definition and
banned synonyms in the same commit, and reference it where used. A new locked term is a
small decision — record it (see `17-decision-log-protocol.md` if it's architectural).

## Anti-patterns (banned)

- Any banned synonym anywhere (code, copy, comments, commits, docs).
- Inventing a new noun for an existing locked concept.
- Two names for the same thing across Rust and TS (pick the locked term for both).
