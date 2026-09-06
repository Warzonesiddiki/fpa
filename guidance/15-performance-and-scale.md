# 15 · Performance & scale

OneFP&A must stay fast on real datasets. Performance targets are specified, not vibes.

## Read first

- `docs/PERFORMANCE-REQUIREMENTS.md` — the numeric targets (dataset sizes, latencies,
  memory, startup, bundle).
- `docs/BENCHMARKS.md` — how benches are run/reported (the audit flagged mislabeling and
  extrapolation — measure, don't estimate).
- `benchmarks/*.bench.ts` — existing benches (engine recalc, GL import).

## Principles

- **Measure, never extrapolate.** A perf claim must come from an actual run on the stated
  dataset size, on record. Do not label an estimate as a measurement.
- **The Rust core does the heavy lifting.** Large parsing/consolidation/aggregation
  happen in Rust, not the JS thread. Keep the UI responsive.
- **Virtualize large grids/lists.** `@tanstack/react-virtual` is a dependency; large
  tables/audit logs should virtualize, not paginate-then-render-all. The audit noted
  AG Grid is client-only and S-070 is paginated-not-virtualized — prefer virtualization
  for big data.
- **Incremental recalc.** The formula engine recalculates incrementally; don't force full
  recomputes on every keystroke.
- **Streaming for huge imports.** Very large GL dumps / archives should stream, not load
  entirely into memory (watch the memory targets in the spec).
- **Bundle size matters.** Keep the mock out of production (WS-08). Code-split heavy routes
  (the audit flagged `s041-model-grid` at 1.13 MB). Lazy-load AG Grid/HyperFormula/ECharts
  where a route doesn't need them upfront.

## When you touch a hot path

1. Check the relevant target in `docs/PERFORMANCE-REQUIREMENTS.md`.
2. Add/extend a bench in `benchmarks/` at the specified dataset size.
3. Run it and record the real number (`npm run bench`).
4. If you regress a target, fix it before committing; if you improve one, note it.

## Gates / commands

```bash
npm run bench                 # vitest benches
npm run build                 # check bundle sizes in the output
```

## Anti-patterns (banned)

- Reporting an extrapolated/estimated perf number as measured.
- Rendering 500k rows without virtualization.
- Doing large aggregation on the JS main thread.
- Loading a whole multi-GB import into memory when the spec says stream.
- Shipping dev-only/mock code or unused heavy libs in the production bundle.
