# OneFP&A — Agent Operating Guidance

**Read this in full before you touch any code.** This is _how_ you work. The _what_ is
in `REMEDIATION-PLAN.md`; the _step-by-step_ is in `remediation/WS-XX-*.md`.

The owner is a non-technical ACCA building this by directing you. They cannot catch a
subtle mistake by reading code — so **your discipline is the only safety net.** Behave
like a senior engineer who signs their name to an audit opinion.

---

## 1. Mindset — you are the guardian of correctness

- This is **audit-grade financial software**. A wrong number is not a bug, it is a
  broken promise to a CFO. Treat every money path as if a regulator will trace it.
- **Slow is smooth, smooth is fast.** Read the spec, then the code, then edit. Most
  "bugs" here come from not reading `docs/` first.
- **Honesty over green.** A truthful `🚧 PARTIAL` protects the project; a false ✅ ends
  it. If you did not run a gate, say so. If you are unsure, say so.
- **You never invent.** Not a function name, not an error code, not a capability, not a
  number. If it is not in the spec or the code, it does not exist until you add it _and_
  document it.

---

## 2. Before every task (the intake ritual)

1. `git status --short` — the tree must be clean. If not, stop and resolve.
2. `ls node_modules >/dev/null 2>&1 || npm install` — the sandbox wipes `node_modules`;
   reinstalling is normal, not a failure.
3. Read, in this order:
   - `docs/GLOSSARY.md` — use the locked term; banned synonyms void the change.
   - `docs/PRD.md` — confirm the feature is in scope (§2 MVP) and not in `NOT BUILDING` (§5).
   - `docs/ZERO-COMPROMISE-RULES.md` — B1–B20, the rules that end a PR.
   - `docs/CLAUDE.md` — DO / DON'T / forbidden patterns / the response format (§7).
   - The **spec for your area** (API-SPEC, DATABASE-SCHEMA, ERROR-HANDLING,
     MONEY-ROUNDING-SPEC, FORMULA-ENGINE-SPEC, SCREENS-SPEC, etc.).
   - The **task card** `remediation/WS-XX-*.md`.
4. Only then write code.

---

## 3. The non-negotiables (violating any one voids your work)

These are the repo's own rules, restated so you cannot miss them:

1. **Money is exact.** `i64` minor units or decimal strings; `rust_decimal` in the
   core. Never `f64`, `parseFloat`, `toFixed`, `Math.round`, `Number()` on money, nor a
   `REAL` column for money. `npm run money:ast` is the gate and must stay green.
2. **One owner per concern (B14).** Money, Calendar, Formula engine, Ingestion each
   live in exactly one place. Extend the owner — never write a second implementation.
3. **No server, no runtime `.env`, no telemetry, no cloud sync (B1/B18-9).** Secrets go
   to the OS keychain. The web dev preview is tooling, never a product surface.
4. **Industry behavior is Pack data (B15).** No per-industry code, page, or engine.
5. **All 5 states + typed errors ship with the feature (B12/B18-5/6).** Loading, empty,
   populated, error, read-only — every screen, every time. Errors use codes defined in
   `docs/ERROR-HANDLING.md`, verbatim copy.
6. **Every mutation writes an audit event (B7).** Locked/immutable artifacts are never
   edited in place — you create a new version.
7. **Docs win (B8).** If code and spec disagree, the code is the bug. Any spec change
   updates `docs/DOCS-INDEX.md` and the traceability matrix in the same commit.
8. **No `TODO`, no `skip`, no `continue-on-error`, no mock in a production path, no
   half-built feature (B10/B18-7/B20).**

---

## 4. The architecture in one picture (so you edit in the right place)

```
User → React 19 / TypeScript (src/)            ← view only, never computes money
          │  Zod validates args
          ▼
       bridge.ts  →  invoke()  →  Tauri IPC
          │                          │
   (dev only) mock.ts           Rust core (src-tauri/src/)
                                   ├─ commands/*.rs   ← thin handlers, session gate, audit
                                   ├─ core/*.rs       ← money, calendar, model, error, audit
                                   └─ storage/*.rs    ← SQLite (rusqlite), keystore
```

- **The Rust core owns all math.** The UI displays; it does not calculate money. The
  one documented exception is the HyperFormula formula engine (B6/B14).
- **Every command handler pattern** (copy an existing one, e.g.
  `src-tauri/src/commands/assumption.rs::assumption_waive`):
  1. `require_session_write(&state)?` — session gate (or `require_session` for reads).
  2. Validate inputs → typed `AppError` with a code from ERROR-HANDLING.
  3. Open DB, check ownership (`model_belongs_to_company` etc.).
  4. Do the work inside a transaction.
  5. **Write an audit event** with the hash chain (`audited_hash` → `next_hash`) for any
     mutation.
  6. Return `Ok(json!({ "data": { ... } }))`.
  7. Register the handler in `src-tauri/src/lib.rs` `generate_handler![...]`.
- **Frontend contract:** add the Zod arg schema + `CommandArgs` binding in
  `src/api/schema.ts`, handle it in `src/api/bridge.ts` if needed, add a mock case in
  `src/api/mock.ts` (dev preview), and call it via `call("command.name", args)`.

---

## 5. The verification loop (run this, paste the output, every time)

```bash
# 1. JS/TS/docs/security — all must PASS
npm run check          # lint · typecheck · fmt:check · vitest · schema-equality ·
                       # docs-link · docs:verify · packs:validate · money:ast · security:scan
npm run build          # production bundle must build

# 2. Coverage (do not let it drop)
npm run test:coverage

# 3. Rust — run in CI; locally report UNVERIFIED if no toolchain
cargo test && cargo clippy -- -D warnings && cargo fmt --check   # in CI / on a Rust machine
```

Rules for reporting gates:

- Paste **real** output. Never summarize a gate you did not run.
- `cargo` not present in the sandbox → report Rust gates as
  `🚧 UNVERIFIED (no Rust toolchain in sandbox; runs in CI)`.
- A red gate is a stop. Fix it before you move on. Do not `--skip`, do not comment out a
  test, do not lower a threshold to pass.

---

## 6. Anti-patterns that will get your work rejected

- ❌ Claiming a gate is green without pasted output.
- ❌ Marking a Rust change ✅ when you could not compile it.
- ❌ Adding a command handler but not registering it in `lib.rs` (orphan handler).
- ❌ Adding a schema/mock command with no native handler (mock-only MVP command).
- ❌ Writing a mutation that does not append an audit event.
- ❌ Any float in a money path; any `REAL` money column.
- ❌ A second implementation of money/calendar/formula/ingestion.
- ❌ Editing a locked artifact in place instead of versioning it.
- ❌ Inventing an error code or using non-verbatim error copy.
- ❌ Shipping a screen missing any of the 5 states.
- ❌ Leaving `TODO`, `FIXME`, `skip`, `continue-on-error`, or placeholder data.
- ❌ Batching unrelated fixes into one commit.
- ❌ Pushing to any branch other than `arena/01a0760c-fpa`.
- ❌ Editing the repo root, `.git`, or deleting `docs/` files to make a gate pass.

---

## 7. Commit & branch discipline

- **Branch:** only ever `arena/01a0760c-fpa`. Never create/switch/push another branch.
- **One commit per workstream.** Conventional Commits, e.g.:
  - `feat(api): implement model.inspect native handler + wire UI`
  - `fix(governance): persist and audit assumption waivers via native command`
  - `chore(ci): enable GitHub Actions and add Rust build/test/clippy/fmt`
  - `chore(repo): standardize on npm, remove pnpm lockfile`
- Push with `git push origin arena/01a0760c-fpa`.
- If `git`/`gh` fails with an auth error, tell the owner "the GitHub connection needs
  attention — please reconnect GitHub in Arena." Never ask for tokens/passwords.

---

## 8. The report you must produce after each workstream

Use the exact format from `docs/CLAUDE.md §7`:

```
## Summary       — 2–4 sentences: what changed and why (cite doc IDs / WS number)
## Files         — each changed/added file, one-line purpose
## Tests         — added/updated, the command run, and the exact result/counts
## Gates         — lint / tsc / fmt / unit / build / cargo / e2e — PASS/FAIL/UNVERIFIED with evidence
## Docs synced   — which docs updated (or "no changes needed" and why)
## Risks         — deviations, open questions, waivers (with reason)
```

If any gate is not ✅, the workstream is not done. Say so plainly and keep going until
it is — or escalate to the owner with a specific, non-technical explanation of what is
blocking and what you need.

---

## 9. Talking to the owner (they are non-technical)

- Explain **impact in business terms**: "waivers weren't being saved, so an auditor
  reviewing the file next week would see no record — I've fixed it so every waiver is
  permanently logged."
- Never dump raw stack traces at them as an ask. Summarize, then offer a choice.
- Only ask when a decision genuinely changes the product and is not already covered by
  `REMEDIATION-PLAN.md §1`. Otherwise, take the best decision and note it under Risks.

---

## 10. When you are unsure

1. Re-read the spec — the answer is almost always there.
2. Check how an existing, similar, DONE feature did it, and mirror the pattern.
3. If still unsure and it changes behavior, record the question under **Risks** and pick
   the choice most consistent with the specs and the zero-compromise standard.
4. Never guess silently on money, audit, security, or schema — those are stop-and-verify
   areas.

Build it so every number ties out, every action is logged, and every gate is green for
real. That is the whole job.
