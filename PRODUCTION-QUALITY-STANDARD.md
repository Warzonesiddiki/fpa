# OneFP&A — PRODUCTION QUALITY STANDARD (REAL APP, ZERO COMPROMISES)

> Non-negotiable bar for the build. This project ships to **real MNC finance teams** and feeds
> **real-world decision-making**. It is **not a mock, not a demo, not a prototype.** Every
> surfaced capability must be a real, persisted, audited, tested path. This file is the work
> quality contract (root-level; the normative B-rules stay in `docs/ZERO-COMPROMISE-RULES.md`).

---

## 1. THE #1 RULE: REAL WORKING APP, NOT A MOCK

| Trap                               | Fails us                                         | Real-world rule                                                                                                                        |
| ---------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| "It works in the mock/dev preview" | Mock returns a hardcoded shape; nothing persists | **Product path = Rust core + SQLite/Company file.** Mock is build tooling only (B18-3). A feature is not "done" from a mock pass       |
| "Contract is in place"             | Schema + mock exist but no real engine           | A contract is a **boundary**, not the feature. M3-1 is only done when HyperFormula worker + grid + real DB `model_values` write exists |
| "Tests pass in the browser"        | jsdom tests only                                 | Real logic must have unit + oracle + (where flow) integration/E2E against the real core                                                |
| "We'll harden later"               | Placeholder/`INTERNAL`/silent catch              | All 5 states + error paths ship in the same PR (B18-5/6)                                                                               |
| "Demo data proves it"              | Fake rows are used to claim success              | Demo Company is a separate, clearly-marked artifact; never token for production acceptance (B18-3)                                     |

## 2. WHAT "REAL" MEANS PER FEATURE (definition of working)

A feature is **working** only when all of these are true against the real app:

1. **Persists** to the Company DB / file (`SQLite` via Rust; no in-memory-only happy path that
   vanishes on restart — unless the spec says ephemeral, e.g. a parse session).
2. **Computes in Rust** for every financial value (B6/B14). The UI formats; it does not calculate
   money (single documented exception = HyperFormula worker formula engine).
3. **Money is exact** — `i64` minor units / `rust_decimal`; no float on any financial path at
   rest, in IPC, or in UI math (B3/B18-2). `money:ast` is green before `DONE`.
4. **Every mutation is audited** — before/after + actor + timestamp appended to the Company HMAC
   chain (B7/B18-1). Read-only commands don't need events.
5. **Every error is typed** — code from ERROR-HANDLING (never invented), `userMessage`, `retry`
   flag, no raw error text to the user (B12).
6. **All 5 states** exist on the screen (loading / empty / error / success / populated) with exact
   documented texts (B18-5/6).
7. **Tested** — unit + oracle known-answers + flow + a11y; coverage thresholds met; a regression
   test exists for every bug fixed (Q5).
8. **Docs synced** — API/ERROR/SCREEN/GLOSSARY updated in the same PR; this board row flips to
   `✅ DONE` only when all of the above are green (B8).

## 3. THE ABSOLUTE DECISION-QUALITY BAR

Because MNC boards and lenders use these outputs, a number in OneFP&A must never be wrong:

| Invariant              | Implementation                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tie to the cent        | Every statement/consolidation/export has a tie-out oracle against exact minor units; `largest-remainder` keeps displayed totals summing exactly (MONEY-ROUNDING-SPEC §4)   |
| No silent zeros        | A missing value is NEVER shown as `0`/`—` as if it were a real zero; it is an explicit state (empty / `#N/A` / `VALUE_INVALID`), especially in statements and Health Check |
| No hidden assumptions  | Hardcoded numbers are surfaced by Model Health Check; never auto-corrected                                                                                                 |
| Every number drillable | Report/board/export numbers trace to source cells → drivers → actuals; if traceability is impossible it is a documented exception, not a silent one                        |
| Deterministic          | Identical inputs → identical values + identical export bytes on all 3 OS (B5/B18-8); property tests where stochasticity or rounding is involved                            |
| Explainable            | Every KPI has a definition; every insight cites its cells/drivers (V2 AI also must)                                                                                        |

## 4. CODE QUALITY HARD RULES

- **No `any`** in TS IPC boundary; never bypass the Zod gate. Typed `CommandArgs` is the only IPC
  contract (ARCHITECTURE §1b).
- **No second implementation** of money/calendar/audit/formula. One owner per concern (B14); a
  duplicate is a defect, not a convenience.
- **No float tokens** in Rust financial code (`f64`/`f32`), no `Number(`/float math in TS money
  paths (money:ast scans both).
- **No raw SQL from the UI**; DB is Rust-only (B4).
- **No network in shipped code** except user-initiated connector sync + update check (B18-9).
- **No telemetry/analytics** (B18-9). Local Diagnostics is opt-in, sanitized, no financial values.
- **No secrets in code/DB**; secrets only in OS keychain via `storage/keys.rs` (B14/B18-4).
- **Accessibility is a gate**: axe 0, keyboard-only path, 200% zoom, reduced-motion, no color-only
  signals (B11).
- **Performance budget**: meet PERFORMANCE-REQUIREMENTS (e.g. 1M-cell recalc < 2s in M3,
  500k-row import to cent); bench regressions ≤10% block merge.
- **Rust compile-read**: the sandbox has no Rust toolchain/CI, so every Rust change is
  hand-reviewed for syntax/semantics (brace/balance + symbol scan) before it's called done. This
  is not optional.
- **i18n baseline**: English strings centralized in `src/i18n/en.json`; locale-aware formatting;
  no hardcoded user-facing text in components.

## 5. THE ZERO-COMPROMISE "STOP" LIST

Do **not** ship (or accept a PR that ships) any of these:

1. Float money anywhere on a financial path.
2. A mock-only implementation labeled an MVP feature.
3. A new error code not in the locked 97.
4. A skipped / `continue-on-error` / `skip` in a release path.
5. A screen that renders `Loading`/`Empty`/`Error`/`Success`/`Populated` incompletely.
6. A persisted mutation with no audit event.
7. An untyped/raw IPC payload.
8. A financial computation owned by the UI.
9. An untested "DONE" row on TASKBOARD.
10. Scope-creep beyond the 38 locked MVP into v1.0.0 (B20).

## 6. REVIEW LENS (use before marking anything `DONE`)

```
▢ Real persistence?  (DB/file, not mock-only)
▢ Rust owns the math?  (B6)
▢ Exact money?  (money:ast green)
▢ Audited mutation?  (B7)
▢ Typed error + userMessage + retry?  (B12)
▢ 5 states?  (B18-5/6)
▢ Tests + oracle + a11y + perf?  (Q1/Q4/Q5/Q6)
▢ Docs + TASKBOARD updated?  (B8)
▢ No float / no new dep / no telemetry / no scope drift?  (B3/B13/B18-9/B20)
```

If any box is unchecked, the row is **NOT DONE** — it is `🚧 PARTIAL`. That is not a judgement on
effort; it is the zero-compromise standard that makes real-world decisions safe.

---

_Root-level operational standard (`TASKBOARD.md` = the tracker; this = the bar). Bound to
`docs/ZERO-COMPROMISE-RULES.md` B1–B20 and `docs/DEFINITION-OF-DONE.md`._
