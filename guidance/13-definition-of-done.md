# 13 · Definition of Done — the final gate

Do not call anything "done" until **every** box is true. This mirrors
`docs/DEFINITION-OF-DONE.md` and `docs/QA-CHECKLIST.md` (Q1–Q8) operationally — those
specs win if they say more.

## Universal checklist (every change)

- [ ] **Spec-aligned:** matches the relevant `docs/` spec; if code and spec disagreed,
      the code was fixed (docs win, B8).
- [ ] **No half-feature:** no `TODO`/`FIXME`/placeholder/`skip`/`continue-on-error`; no
      invented capability behind a disabled control (B10/B18-7).
- [ ] **Single owner:** extended the one owner of the concern; no second implementation (B14).
- [ ] **Money exact:** no floats in money paths; `npm run money:ast` green (B3/I1).
- [ ] **Docs synced in the same commit:** API-SPEC / DATABASE-SCHEMA / ERROR-HANDLING /
      GLOSSARY / traceability matrix / DOCS-INDEX updated as needed (B8).
- [ ] **Tests added** for the new behavior; coverage did not drop.
- [ ] **All gates green with pasted evidence** (below); Rust gates run in CI or reported
      `🚧 UNVERIFIED`.
- [ ] **Reported** in `docs/CLAUDE.md §7` format, honestly.
- [ ] **One commit, one concern**, on `arena/01a0760c-fpa`.

## If a command changed

- [ ] Rust handler implemented + **registered in `lib.rs`** + tested.
- [ ] Mutations write an audit event (B7); reads don't.
- [ ] Zod schema + `CommandArgs` binding + dev mock case.
- [ ] A real caller exists (no orphan handler, no mock-only MVP command).
- [ ] `docs/API-SPEC.md` row matches exactly.

## If a screen changed

- [ ] All 5 states (+ read-only where applicable); no simulated states.
- [ ] Typed error codes only, verbatim copy.
- [ ] All copy via i18n; axe-clean; keyboard operable.
- [ ] Colocated tests cover states + a11y + primary action.

## If the schema changed

- [ ] New migration (append-only) + `docs/DATABASE-SCHEMA.md` updated.
- [ ] `node scripts/schema-equality-check.mjs` green; no float money column.

## If a pack changed

- [ ] `npm run packs:validate` → 12/12, **0 warnings**; finance-correct values only.
- [ ] No executable code in packs; no per-industry code anywhere.

## The gate command block (paste output)

```bash
npm run check       # lint · typecheck · fmt:check · vitest · schema-equality ·
                    # docs-link · docs:verify · packs:validate · money:ast · security:scan
npm run build       # production bundle builds
npm run test:coverage           # coverage gate (see WS-11)
# CI / Rust machine:
cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test --all
npm run test:e2e                # if a user journey changed (needs tauri-driver)
```

## The "not done" traps (from docs/DEFINITION-OF-DONE.md §2)

If ANY of these is true, it is **not done**: a state is missing; an error is untyped or
paraphrased; a mutation isn't audited; a float touched money; docs weren't updated; a
gate was skipped or faked; a mock answers a production path; a handler is orphaned or
mock-only; the change spans multiple concerns in one commit.
