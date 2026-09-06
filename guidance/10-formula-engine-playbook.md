# 10 · Formula engine, drivers & analysis functions

The formula engine is the **one documented exception** to "Rust owns the math" (B6/B14):
HyperFormula runs in the frontend worker, but its behavior, function whitelist, and the
financial semantics are specified and owned in one place. Do not fork it.

## Read first

- `docs/FORMULA-ENGINE-SPEC.md` — function whitelist, driver grammar, cycle detection
  (`#CYCLE!`), analysis functions (CAGR, MA, Trend, Seasonality), recalc semantics.
- `docs/MODELING-METHODS-SPEC.md` — spreading, growth, YoY, seasonality, rollups.
- `src/workers/modelEngine.ts` — the frontend engine worker.
- `src-tauri/src/core/model.rs` — the model/graph owner in Rust (inspection, diff).

## Single-owner rules

- **One whitelist.** The set of allowed functions is defined once; don't maintain a
  second copy. Every KPI/formula in packs must use only whitelisted functions.
- **One implementation per analysis function.** TREND/MOVINGAVG/SEASONALITY/CAGR etc.
  have a single owner — extend it; do not add a parallel float-based version.
- **YoY/PRIORPERIOD and period functions** (FPERIOD/FQTR/FYEAR/FPERIODSTART/PERIODLEN)
  must be actually implemented (the audit flagged several returning `#NAME?`), and owned
  consistently (spec says which layer owns them — follow it, don't split TS vs Rust).
- **Money exactness still applies** inside analysis functions — see `05-money-and-numbers.md`.
  No float drift in spreading/allocation; mirror the money core, don't re-invent it.

## Circular references

- Detection returns a `#CYCLE!` path (the ordered list of cells in the cycle). The native
  `model.inspect` (remediation WS-05) must surface this. Do not collapse distinct engine
  errors (`#CYCLE!`, `#REF!`, `#NAME?`, `#VALUE!`) into one generic error.

## Drivers

- Driver tables per sheet/period/dimension; bounds come from the Assumption Register and
  are enforced (`DRIVER_OUT_OF_BOUNDS`). The `D[expr]` driver grammar must be parsed per
  spec — don't accept syntax the grammar doesn't define.
- Driver Federation precedence (global → BU → collection → imported) is spec-defined;
  implement exactly that order.

## When you touch formulas/drivers

1. Confirm the function/behavior against `docs/FORMULA-ENGINE-SPEC.md`.
2. Extend the single owner (`modelEngine.ts` / `core/model.rs`), never a fork.
3. Add tests: precedents/dependents, cycle path, each analysis function's numeric
   correctness (exact), bounds enforcement, federation precedence.
4. Keep packs' formulas valid against the whitelist (`09-packs-playbook.md`).

## Gates

```bash
npm run money:ast     # no float in the numeric paths
npm run check
cargo test            # (CI) model/graph tests
```

## Anti-patterns (banned)

- A function returning `#NAME?` because it was declared but never implemented.
- A second whitelist or a duplicate analysis-function implementation.
- Float-based spreading/trend that diverges from the money core.
- Collapsing distinct `#…!` errors into one.
