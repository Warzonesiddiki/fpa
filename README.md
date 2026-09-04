# OneFP&A

**The all-in-one FP&A suite — local-first, offline, Windows · macOS · Linux.**

One app replaces Excel + BI + cloud EPM for the whole FP&A cycle:
**import (any GL Dump / Excel / QuickBooks / Xero / NetSuite / Sage) → model (Excel-compatible formulas, drivers, assumptions) → plan (budget, forecast, rolling forecast, scenarios) → analyze (variance + attribution, what-if, FVA) → report (P&L, Balance Sheet, Cash Flow, SoCE, Segment, Board Pack) → govern (audit trail, encryption, offline license).**

- 🖥️ Native desktop on all three OS — identical behavior (B18-8)
- 🔒 Local-first: data never leaves your machine; encrypted at rest; zero telemetry (B18-9)
- 🏭 Works for every industry: 12 Industry Packs + Pack Builder (config, not code)
- 🏢 Multi-industry groups: BUs with different packs, calendars (4-5-4!), currencies, consolidated with IC eliminations, FX, NCI
- ✅ Audit-grade money: `rust_decimal` exact arithmetic; integer minor units; no floating-point money (I1)
- 📄 Excel + PDF export that is deterministic on every OS

> **Specs:** full documentation suite is in [`docs/`](./docs) — start with `docs/DOCS-INDEX.md`.

---

## Quickstart (developer, < 5 minutes)

```bash
# 1. Prerequisites
#    Node.js ≥ 22 · Rust ≥ 1.85 · Tauri system deps (see https://tauri.app/start/prerequisites/)

# 2. Install
npm ci
cargo fetch

# 3. Run the app (opens native desktop window)
npm run tauri:dev

# 4. Verify quality gates (what CI runs)
npm run check            # typescript + eslint + vitest + coverage
cargo test               # rust unit + property + oracle tests
```

### Try the product in 60 seconds
1. First-Run Wizard: name a Company → pick **Manufacturing** pack → calendar → **Finish**.
2. **Import Hub → GL Dump** → drop `docs/examples/sample_gl_dump.xlsx` (Demo Company fixture) → map → Tie-Out → Commit.
3. Open **Revenue** sheet, type driver values (units × price), watch P&L/BS/CF cascade.
4. **Reports → P&L** → export PDF. Done — no Excel opened.

### Common scripts

| Command | Purpose |
|---|---|
| `npm run tauri:dev` | Dev desktop app (HMR) |
| `npm run build` | Production webview bundle |
| `npm run tauri:build` | Build installer for current OS |
| `npm run check` | Full frontend gate (tsc+lint+test+coverage) |
| `cargo test` | Rust engine/storage/property tests |
| `npm run test:e2e` | Playwright E2E (requires tauri-driver) |
| `npm run docs:verify` | Docs index/links/consistency checks |
| `npm run money:ast` | Money-safety ratchet (float ban check) |

---

## Where things live

| Path | What |
|---|---|
| `docs/` | The 61 documentation files (60-row docs index + README) — source of truth — start at DOCS-INDEX.md) |
| `src/` | TypeScript UI (React 19, AG Grid, ECharts, HyperFormula) |
| `src-tauri/` | Rust core (engines, money, calendar, ingestion, export, security) |
| `packs/` | Industry Packs (JSON + SQL seeds — data only) |
| `e2e/` | Playwright flows (UF-001…UF-014) |

## License & support

Self-host/enterprise — offline Ed25519 license activation (see `docs/AUTH-SPEC.md` §4). No telemetry, ever. For issues: GitHub Issues with **Local Diagnostics** export (sanitized; no financial data).
