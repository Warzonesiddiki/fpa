# PERFORMANCE-REQUIREMENTS.md

> OneFP&A · v1.0.0 · **Numeric targets only.** Reference hardware = 2020 mid-tier laptop (4c/8th i5 or M1, 16 GB, SSD). All measured in release CI + benchmark suite (`vitest.bench` + `cargo bench`), regression = release-blocking.

---

## 1. STARTUP & UI

| Metric | Target (p50) | Hard ceiling (p95) |
|---|---|---|
| Cold start → unlock screen (app launch) | < 1.0 s | < 1.8 s |
| Unlock → Dashboard populated (Company ≤ 500k GL Lines) | < 1.2 s | < 2.5 s |
| First paint after route change (any screen) | < 150 ms | < 400 ms |
| KPI card/chart render (dashboard, 12 periods, 8 KPIs) | < 300 ms | < 800 ms |
| Grid interaction latency (cell nav/focus, 1M cells) | < 16 ms | < 50 ms |
| Cell edit commit (incl. incremental recalc of ≤ 5k dirty cells) | < 150 ms | < 350 ms |
| Full model recalc (1M cells, 5-year monthly) | < 1.2 s | < 2.0 s |
| Undo/redo (100-step stack, 1M cells) | < 100 ms | < 250 ms |

**Note:** desktop app — FCP/LCP are the webview equivalents; we track **route first-paint** instead (native shell has no network FCP). Bundle: JS assets ≤ **750 KB gzipped** (lazy-loaded per route; grid/charts chunked).

## 2. DATA & INGESTION

| Metric | Target | Ceiling |
|---|---|---|
| Parse 500k-row GL dump (xlsx, multi-sheet) | < 8 s | < 20 s |
| Normalize + map + validate (500k rows) | < 6 s | < 15 s |
| Commit Import Batch (500k rows incl. index build + snapshot) | < 10 s | < 25 s |
| Trial Balance Tie-Out (500k rows) | < 3 s | < 8 s |
| Connector sync 50k transactions (QBO/Xero/NS/Sage) | < 60 s | < 180 s |
| Reconciliation (batch A vs B, 500k rows) | < 10 s | < 30 s |
| Import UI responsiveness during pipeline | always interactive (watchdog: > 80 ms frame = fail) | — |
| Peak memory during 2M-row import | < 2.0 GB | < 2.5 GB |

## 3. ENGINES

| Metric | Target | Ceiling |
|---|---|---|
| Statement generation (P&L/BS/CF/SoCE, 50 BU group, 500k GL Lines) | < 4 s | < 8 s |
| Consolidation (50 BU, mixed calendar/currency, IC matrix, 500k lines) | < 8 s | < 10 s |
| Variance + Attribution (1M cells, 12 periods) | < 2 s | < 4 s |
| FVA (20 versions × 1M cells) | < 3 s | < 6 s |
| Model Health Check (full) | < 10 s | < 30 s |
| Goal Seek (≤ 100 iterations) | < 3 s | < 6 s |

## 4. EXPORT & STORAGE

| Metric | Target | Ceiling |
|---|---|---|
| Excel export (statement w/ 1M cells) | < 8 s | < 15 s |
| PDF export (Board Pack, 30+ pages) | < 5 s | < 12 s |
| Model Dump (full workbook) | < 12 s | < 20 s |
| Encrypted backup (2 GB Company) | < 25 s | < 45 s |
| Restore (2 GB backup, passphrase) | < 30 s | < 60 s |
| Storage overhead (Company File vs raw SQLite) | < 15% | < 30% |
| Disk growth per 100k GL Lines | < 40 MB | < 60 MB |

## 5. RUNTIME HYGIENE

| Metric | Target | Ceiling |
|---|---|---|
| Idle CPU (no interaction, 5 min) | < 0.5% | < 2% |
| Idle memory (app open, 1M-cell model) | < 450 MB | < 800 MB |
| Peak memory during exported doc (2M rows) | < 2.5 GB | < 3.0 GB |
| Audit write latency per mutation | < 20 ms | < 60 ms |
| Auto-save flush (after 5s idle) | < 150 ms | < 300 ms |

## 6. CROSS-PLATFORM PARITY (numeric)

| Check | Requirement |
|---|---|
| Same fixture run on Win/macOS/Linux | Result values identical (money/statements to the cent) |
| Export file hash | Identical PDF hash for same input on all 3 OS (typst determinism) |
| Recalc duration variance | ≤ 15% across OS (same machine class) |

## 7. BENCHMARK CI GATES

- `npm run bench` + `cargo bench` in CI on each PR touching engines; regression > 10% = fail.
- Performance tests use reference hardware class; results stored in `reports/bench/` with history — no silent regressions (reference project's F-0002).
- Bundle checksum gate (≤ 750 KB gz) blocks bloat; visualizer artifact in CI.

*Referenced by: QA-CHECKLIST.md, CI-CD.md, MONITORING.md, FEATURE-TRACEABILITY-MATRIX.md.*
