# OneFP&A — Remediation Master Plan

**Owner:** project lead (ACCA, non-technical, vibe-coding).
**For:** the agentic AI that will do the work.
**Standard:** EXTREME PERFECTION, ZERO COMPROMISES. A false "green" ends the task.
**Source of findings:** `AUDIT-2026-09-06-fresh.md` (hands-on audit, all gates executed).
**Date:** 2026-09-06. **Branch (fixed):** `arena/01a0760c-fpa`.

> **PROGRESS (2026-09-06, session 2 — branch `arena/01a078fe-fpa`):** WS-03 ✅ · WS-01/02
> 🚧 ready-but-blocked (token lacks `workflows` permission; file staged at
> `.github/workflows/ci.yml`) · WS-09 ✅ (ADR-028, updater removed) · WS-08 ✅ (mock out of
> prod) · WS-04 ✅ (waivers persist + audited) · WS-11 ✅ (coverage in `check`; found real
> regression 84.12/76.71 → 87.49/81.82) · WS-10 ✅ (12 packs re-issued, 132 → 0 warnings).
> Remaining: WS-05/06/07 (Rust native commands) — **do after CI is live** (D5). Full
> evidence: `AUDIT-2026-09-06-remediation-status.md`.

---

## 0. How to use this package

You (the agent) have been given three kinds of document. Read them in this order:

1. **`AGENT-GUIDANCE.md`** — how to work: mindset, guardrails, the verification loop,
   the report format, and the anti-patterns that void your work. Read it fully before
   touching code. It is the rulebook for _how_ you behave.
2. **`REMEDIATION-PLAN.md`** (this file) — _what_ to fix, in _what order_, and _why_.
   It lists every finding as a numbered workstream (WS-01 … WS-11) with priority,
   decision already taken, and the finish line.
3. **`remediation/WS-XX-*.md`** — one self-contained task card per workstream. Each
   card has: objective, exact files, step-by-step, acceptance criteria, and the gates
   that must pass. Execute one card at a time, top to bottom.
4. **`guidance/00-INDEX.md`** — the how-to playbook library (repo map, add-a-command,
   add-a-screen, error handling, money, database/migrations, audit/security, testing,
   packs, formula engine, state/i18n/design, git/PR, definition-of-done, glossary,
   performance, anti-patterns, decision log, sandbox troubleshooting). These are the
   mechanical recipes you consult _while building_; they route to `docs/`, never restate it.

**Golden rule:** the repo's own rulebook wins over everything here. Before any edit,
you must have read `docs/CLAUDE.md`, `docs/ZERO-COMPROMISE-RULES.md` (B1–B20),
`docs/GLOSSARY.md`, and the spec for the area you touch. If this plan ever contradicts
those docs, the docs win and you flag it.

---

## 1. The decisions already made for you (do not re-litigate)

The owner is non-technical and has delegated all technical judgment. These calls are
final so you never have to stop and ask:

| #   | Decision                                                                                                                                                                                                                  | Rationale                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **Implement the 3 mock-only commands natively** (`company.archive_year`, `driver.import`, `model.inspect`).                                                                                                               | All three are MVP scope (PRD F-001, F-023, F-012). A mock-only MVP command is a half-built feature (B10/B18-7).                                  |
| D2  | **Wire `assumption.waive` UI → native handler; persist + audit.**                                                                                                                                                         | The Rust handler already exists and writes an audit event. In-memory-only waivers break B7 (every mutation is audited) and lose data on restart. |
| D3  | **Keep npm; delete `pnpm-lock.yaml`.**                                                                                                                                                                                    | `package.json` declares `packageManager: npm@10.9.0`; every script, the README, and `infra/ci.yml` use npm. One lockfile, one tool.              |
| D4  | **Reconcile `skills-lock.json`** — it is agent tooling, not product source; remove it from git tracking (it is already in `.gitignore`).                                                                                  | Tooling artifacts must not be tracked (repo hygiene).                                                                                            |
| D5  | **Rust verification = CI + honest local reporting.** Repair `infra/ci.yml` so it compiles, clippies, fmt-checks, and tests the Rust core on a real toolchain; locally you mark Rust gates `🚧 UNVERIFIED (no toolchain)`. | The sandbox has no `cargo`. CI is the only place the 27k-line core gets verified.                                                                |
| D6  | **Exclude the mock core from production builds** via a dev-only dynamic import.                                                                                                                                           | B18-7: no mock data in a production path.                                                                                                        |
| D7  | **Finish the updater signing keys.** If release keys cannot be generated in-session, **disable the updater** in `tauri.conf.json` rather than ship an unverifiable one.                                                   | An empty `pubkey` means the updater cannot verify signatures — a security hole.                                                                  |
| D8  | **Re-issue the 12 packs** with the missing formulas, alert bands, and driver links so `packs:validate` emits **zero** warnings.                                                                                           | Packs are data (B15); functional gaps degrade alerts and attribution.                                                                            |
| D9  | **Stand up CI so gates run automatically.** Resolve or clearly document the `.github/` push-permission blocker.                                                                                                           | Without CI, "green" depends on memory. This is the biggest process risk.                                                                         |
| D10 | **Add the coverage gate to `npm run check`** and lift the razor-thin margin.                                                                                                                                              | An 80.07% vs 80% margin regresses the moment a new file lands untested.                                                                          |

---

## 2. Priority ladder & execution order

Do them in this order. Earlier workstreams de-risk later ones. **Never batch
unrelated workstreams into one commit** — one WS = one focused, gate-green commit.

### Phase A — Foundation & safety (do first)

- **WS-01 · Stand up CI** (D9) — so every later change is auto-verified. `remediation/WS-01-ci.md`
- **WS-02 · Rust in CI** (D5) — add cargo build/test/clippy/fmt to the pipeline. `remediation/WS-02-rust-verification.md`
- **WS-03 · Repo hygiene** (D3, D4) — one lockfile, untrack tooling. `remediation/WS-03-repo-hygiene.md`

### Phase B — Correctness & the zero-compromise gaps

- **WS-04 · Persist & audit assumption waivers** (D2) — `remediation/WS-04-assumption-waive.md`
- **WS-05 · Implement `model.inspect` natively** (D1) — `remediation/WS-05-model-inspect.md`
- **WS-06 · Implement `driver.import` natively** (D1) — `remediation/WS-06-driver-import.md`
- **WS-07 · Implement `company.archive_year` natively** (D1) — `remediation/WS-07-company-archive-year.md`

### Phase C — Production quality & release readiness

- **WS-08 · Dev-only mock, remove from prod bundle** (D6) — `remediation/WS-08-mock-out-of-prod.md`
- **WS-09 · Updater signing or disable** (D7) — `remediation/WS-09-updater.md`
- **WS-10 · Re-issue packs to zero warnings** (D8) — `remediation/WS-10-packs.md`
- **WS-11 · Coverage gate in `check` + lift margin** (D10) — `remediation/WS-11-coverage.md`

---

## 3. The findings (traceability table)

| WS    | Finding (from audit)                                                   | Severity        | Decision | Rule touched            |
| ----- | ---------------------------------------------------------------------- | --------------- | -------- | ----------------------- |
| WS-01 | CI exists (`infra/ci.yml`) but never runs (`.github/` git-ignored)     | Process P1      | D9       | B-rules enforcement map |
| WS-02 | Rust core (~27k lines) never compiled/tested in this env               | Verification P1 | D5       | B5, B6, B14             |
| WS-03 | Dual lockfiles tracked; `skills-lock.json` tracked+ignored             | Hygiene P2      | D3, D4   | repo hygiene            |
| WS-04 | `assumption_waive` orphan; UI waives in-memory only (no persist/audit) | Correctness P1  | D2       | B7                      |
| WS-05 | `model.inspect` mock-only, no Rust handler                             | API P1          | D1       | B10, B18-7, F-012       |
| WS-06 | `driver.import` mock-only, no Rust handler                             | API P1          | D1       | B10, B18-7, F-023       |
| WS-07 | `company.archive_year` mock-only, no Rust handler                      | API P1          | D1       | B10, B18-7, F-001       |
| WS-08 | ~4,600-line mock core ships in production bundle                       | Prod P2         | D6       | B18-7                   |
| WS-09 | Updater configured with empty `pubkey`                                 | Security P2     | D7       | B1, security            |
| WS-10 | 132 pack warnings (missing KPI formulas/bands, driver links)           | Data P2         | D8       | B15                     |
| WS-11 | Coverage gate razor-thin (~80.07%) and not in `check`                  | Test P3         | D10      | B5, DoD                 |

Also fold in these audit sub-notes as you touch the relevant area (they are small):

- Bundle: `s041-model-grid` chunk is 1.13 MB — review lazy-loading during WS-08 if cheap.
- `docs/API-SPEC.md` line ~325 says "no Fiscal Year can be archived yet" — update in WS-07.

---

## 4. Global definition of done (every workstream must satisfy)

A workstream is **DONE** only when ALL of these are true — no exceptions, no "later":

1. **Feature-complete**: no mock in the product path, no `TODO`, no placeholder, no
   invented capability behind a disabled control (B10/B18-7).
2. **All 5 UI states** ship in the same change for any screen touched (loading / empty
   / populated / error / read-only), with typed error codes from
   `docs/ERROR-HANDLING.md` (B12/B18-5/6).
3. **Every mutation writes an audit event**; locked/immutable artifacts are never
   edited in place (B7).
4. **Money stays exact** — `i64` minor units / `rust_decimal`; `npm run money:ast` green.
5. **Docs synced**: if behavior/API/schema/errors change, update `docs/API-SPEC.md`,
   `docs/DATABASE-SCHEMA.md`, `docs/ERROR-HANDLING.md`, `docs/GLOSSARY.md`, the
   traceability matrix, and `docs/DOCS-INDEX.md` in the **same** commit (B8).
6. **All JS gates green with pasted evidence**: `npm run check` (lint · typecheck ·
   fmt:check · vitest · schema-equality · docs-link · docs:verify · packs:validate ·
   money:ast · security:scan) + `npm run build`.
7. **Rust gates**: added/updated `cargo test` + `proptest` where logic changed; run in
   CI. Locally report them as `🚧 UNVERIFIED (no toolchain in sandbox)` — never a false ✅.
8. **Tests added** for the new behavior (unit + the relevant page/store test; e2e flow
   if it changes a user journey). Coverage does not drop.
9. **Reported** in the exact format from `docs/CLAUDE.md §7` (Summary / Files / Tests /
   Gates / Docs synced / Risks), with real command output — never claim green without it.
10. **One commit, one concern**, pushed only to `arena/01a0760c-fpa`.

---

## 5. Sequencing contract (how to run the whole program)

```
for each WS in [01,02,03,04,05,06,07,08,09,10,11]:
    1. git status --short              # must be clean before you start
    2. read remediation/WS-XX-*.md fully
    3. read the specs it names (docs/*)
    4. implement to the global DoD (§4)
    5. run the gate set the card lists; paste evidence
    6. update docs in the same change
    7. commit with a Conventional Commit message; push to arena/01a0760c-fpa
    8. report in docs/CLAUDE.md §7 format
    9. STOP, confirm green, then move to the next WS
```

If a gate is red, fix it before moving on. If `node_modules` vanishes mid-session
(the sandbox wipes it), run `npm install` and re-run — this is normal, not a code bug
(see README "Sandbox notes"). If `npm install` rewrites `package-lock.json` with only
`dev`→`devOptional` churn, `git checkout -- package-lock.json` before committing.

---

## 6. What "zero compromise" means here (the spirit)

- **No false green.** A gate you cannot run is `🚧 UNVERIFIED`, never ✅.
- **No half-features.** If you can only do part of a command, you have not done the
  command. Finish it, states, errors, tests, docs — or don't start it.
- **No second implementations.** One owner per concern (B14): extend money/calendar/
  formula/ingestion in their single home, never fork.
- **No mock in production.** Ever.
- **No undocumented behavior.** Code and docs move together; the docs are the truth.
- **No scope creep.** Fix the finding, to spec, and stop. If you discover a new problem,
  record it in `REMEDIATION-PLAN.md §3` as a new WS row — do not silently expand.

Proceed workstream by workstream. Build it as if an auditor will trace every number.
