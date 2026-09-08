# Remediation task cards

Self-contained work orders for the OneFP&A audit remediation. Execute **in order**, one
card per commit, each to the global Definition of Done in `../REMEDIATION-PLAN.md §4`.

**Start here:**
1. Read `../AGENT-GUIDANCE.md` (how to work — mindset, guardrails, verification loop).
2. Read `../REMEDIATION-PLAN.md` (what to fix, order, and the decisions already made).
3. Skim `../guidance/00-INDEX.md` (the how-to playbook library you consult while building).
4. Then work these cards top to bottom.

| Order | Card | Fix | Decision | Status |
|-------|------|-----|----------|--------|
| 1 | `WS-01-ci.md` | Stand up GitHub Actions CI | D9 | ✅ DONE |
| 2 | `WS-02-rust-verification.md` | Rust build/test/clippy/fmt in CI (3 OS) | D5 | ✅ DONE |
| 3 | `WS-03-repo-hygiene.md` | One lockfile (npm); untrack tooling | D3, D4 | ✅ DONE |
| 4 | `WS-04-assumption-waive.md` | Persist + audit assumption waivers | D2 | ✅ DONE |
| 5 | `WS-05-model-inspect.md` | Implement `model.inspect` natively | D1 | ✅ DONE (ADR-029) |
| 6 | `WS-06-driver-import.md` | Implement `driver.import` natively | D1 | ✅ DONE |
| 7 | `WS-07-company-archive-year.md` | Implement `company.archive_year` natively | D1 | ✅ DONE (2026-09-07; follow-ups closed 2026-09-08 — restore_year + clone guard + ADR-032) |
| 8 | `WS-08-mock-out-of-prod.md` | Keep mock out of the production bundle | D6 | ✅ DONE |
| 9 | `WS-09-updater.md` | Real signing keys or disable updater | D7 | ✅ DONE (updater removed, ADR-028) |
| 10 | `WS-10-packs.md` | Re-issue 12 packs to zero warnings | D8 | ✅ DONE |
| 11 | `WS-11-coverage.md` | Coverage in `check` + lift margin | D10 | ✅ DONE |
| 12 | `WS-12-archived-period-write-gating.md` | Refuse mutations into archived periods | D1 | 🚧 NOT STARTED (design recorded 2026-09-08, ADR-032) |

**Standard:** extreme perfection, zero compromises. A gate you didn't run is
`🚧 UNVERIFIED`, never ✅. One WS = one focused, gate-green commit on
`arena/01a0760c-fpa`. Report each in the `docs/CLAUDE.md §7` format.
