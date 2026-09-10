# OneFP&A — THE ALL-IN-ONE, ZERO-COMPROMISE FP&A SUITE

> **Vision (v9, 2026-09-09):** A desktop-native, local-first, exact-decimal, fully-audited FP&A tool that makes every cloud EPM obsolete, every Excel workbook untrustworthy, and every analyst's job defensible. Every number has a proof. Every change has a chain. Every industry has a pack. Zero seats. Zero servers. Zero compromises.

**The all-in-one FP&A suite — local-first, offline, Windows · macOS · Linux.**

One app replaces Excel + BI + cloud EPM + close management for the whole FP&A cycle:
**import (any GL Dump / Excel / QuickBooks / Xero / NetSuite / Sage) → model (Excel-compatible formulas, drivers, assumptions) → plan (budget, forecast, rolling forecast, scenarios, cycle) → analyze (variance + attribution, what-if, FVA, alerts) → report (P&L, Balance Sheet, Cash Flow, SoCE, Segment, Board Pack, KPI Builder) → govern (audit trail, encryption, health check, backup, license) → export (Excel / PDF / Model Dump / Data Room).**

- 🖥️ Native desktop on all three OS — identical behavior verified (B18-8)
- 🔒 Local-first: data never leaves your machine; AES-256-GCM encrypted at rest; zero telemetry; offline-capable (B18-9)
- 🏭 Total industry coverage: 12 Industry Packs (SaaS, Manufacturing, Retail 4-5-4, Healthcare, Construction, Professional Services, Nonprofit, Government, Energy, Financial Services, Logistics, Real Estate) + Pack Builder — data only, never code (B15)
- 🏢 Multi-industry groups: BUs with different packs, calendars (4-5-4 / 52-53wk / 3-3-3-4), currencies, consolidated with IC eliminations, FX translation, NCI, CTA equity plug
- ✅ Audit-grade money: `rust_decimal` exact arithmetic; integer minor units; no float anywhere on a financial path (`money:ast` gate, B3/I1)
- 📄 Deterministic Excel + PDF export: identical bytes across all 3 OS (B5)
- ⚡ Zero per-seat billing: one license per Company File; no cloud subscription; no implementation project (F-035)
- 🌐 GL Dump guarantee: any ERP's export imports via Manual Import; 4 connectors are convenience, never prerequisite (B19)

> **Strategic vision:** See `docs/STRATEGIC-VISION.md` — the single source of truth for what "perfect" means, the 7 domains, the zero-compromise architecture, and the competitive reality.
> **Specs:** Full documentation suite is in `docs/` — start at `docs/DOCS-INDEX.md`.
> **Quality gates:** 14 blocking gates (lint + tsc + vitest + coverage + docs:verify + schema-equality + docs-link + packs + money:ast + tokens + ipc:casing + command:parity + security + build) — zero skips permitted (B18-7).

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
npm run check            # full gate: lint + typecheck + fmt:check + fmt:rust + vitest + coverage (main ≥85/80, critical ≥95/90) + schema-equality + docs-links + docs:verify + packs + money:ast + tokens + ipc:casing + command:parity + security
npm run docs:verify      # docs index/links/consistency checks
npm run packs:validate   # 12 Industry Packs validate
npm run money:ast        # money-safety ratchet (float ban check)
npm run tokens:check     # design-token reference gate (no undefined --color-* in src/)
npm run ipc:casing        # Tauri invoke-args casing gate (snake_case wire contract)
npm run command:parity    # three-way command parity gate (schema ↔ mock ↔ native)
npm run security:scan    # secret + telemetry + license scans
cargo test               # Rust engine/storage/property tests (needs Rust toolchain; also run cargo clippy -- -D warnings and cargo fmt --check)
```

> **Sandbox notes:** if `node_modules` is empty/missing (`eslint: not found` out of
> nowhere), the sandbox wiped it mid-session (excluded from snapshots) — run
> `npm install` and re-run the gates, do not chase phantom code failures.
> `npm install` may rewrite `package-lock.json` (`dev` → `devOptional` churn from
> newer npm) — run `git checkout -- package-lock.json` before committing unless you
> intended a lockfile change.

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
| `npm run check` | Full gate (lint + typecheck + fmt:check + fmt:rust + vitest + coverage main ≥85/80 + critical ≥95/90 + schema-equality-check + docs-link-check + docs:verify + packs:validate + money:ast + tokens:check + ipc:casing + command:parity + security:scan) |
| `cargo test` | Rust engine/storage/property tests (plus `cargo clippy -- -D warnings`, `cargo fmt --check`) |
| `npm run test:e2e` | Playwright E2E (requires tauri-driver) |
| `npm run docs:verify` | Docs index/links/consistency checks |
| `npm run packs:validate` | Industry Pack validation (12/12) |
| `npm run money:ast` | Money-safety ratchet (float ban check) |
| `npm run tokens:check` | Design-token reference gate (no undefined `--color-*` in src/) |
| `npm run ipc:casing` | Tauri invoke-args casing gate (snake_case wire contract, ADR-030) |
| `npm run command:parity` | Three-way parity: every typed command has a Zod binding, a mock case, and a native handler (or engine) — and vice versa |
| `npm run fmt:rust` | Rust formatting gate without a toolchain (WASM rustfmt, ADR-031) |
| `npm run security:scan` | Secret + telemetry + license scans |

---

## Where things live

| Path | What |
|---|---|
| `docs/` | The 61 documentation files (60-row docs index + README) — source of truth — start at DOCS-INDEX.md) |
| `src/` | TypeScript UI (React 19, AG Grid, ECharts, HyperFormula) — 42 screens in `src/pages/` |
| `src-tauri/` | Rust core (engines, money, calendar, ingestion, export, security) — 78 Tauri handlers in `src-tauri/src/lib.rs` |
| `packs/` | Industry Packs (JSON + SQL seeds — data only) |
| `e2e/` | Playwright flows (UF-001…UF-014) |

## License & support

Self-host/enterprise — offline Ed25519 license activation (see `docs/AUTH-SPEC.md` §4). No telemetry, ever. For issues: GitHub Issues with **Local Diagnostics** export (sanitized; no financial data).
