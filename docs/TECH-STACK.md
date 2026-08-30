# TECH-STACK.md

> OneFP&A · v1.0.0 · **Exact packages + versions + one-line why. No TBD.** Locked 2026-08-30.
> **Canonical versions = committed lockfiles** (`Cargo.lock`, `package-lock.json`) build in CI; every version below is the minimum pinned and the exact API surface used (B9).
> Language inventory per Stage 0: **12 shipped / 15 total** (B13). One owner per concern (B14).

---

## 1. RUNTIME & SHELL

| Package | Version | Why (one line) |
|---|---|---|
| **Tauri 2** (Rust) | `2.11.0` (`tauri`, `tauri-build`, `@tauri-apps/api 2.11.0`, `@tauri-apps/cli 2.11.2`) | Native shell, ~10 MB binaries, per-OS keychain/updater/signing, one codebase for Windows/macOS/Linux |
| **Rust** | `1.85.0` (edition 2024) | Memory-safe native core; `rust_decimal` exact money; `cargo` single toolchain for all 3 OS |
| **Tauri plugins** | dialog `2`, notification `2`, updater `2`, global-shortcut `2`, os `2`, clipboard-manager `2`, window-state `2` | Dialog/notify/update/shortcut/OS/state via official plugins (least-privilege capabilities) |
| **tauri-specta** | `2.0.0` | Generates typed TS bindings from Rust IPC → **zero contract drift** between core and UI |
| SQLite | `3.50.x` bundled via `rusqlite` | Single-file encrypted Company storage; WAL; ACID; zero-config |
| `rusqlite` | `0.32.1` (feature `bundled`, `chrono`, `serde_json`) | System-independent SQLite; no per-OS install |
| `rusqlite_migration` | `1.0.6` | Versioned SQL migrations with tests + rollback |
| `rust_decimal` | `1.36.0` | Exact decimal money (28 digits); the single Money Core (I1/I5) |
| `chrono` | `0.4.38` | Date/period math primitives (calendar engine owns fiscal logic) |
| `calamine` | `0.26.1` | Reads xls/xlsx fast (GL Dumps) in native memory |
| `rust_xlsxwriter` | `0.79.0` | Deterministic, injection-safe Excel export on all 3 OS |
| `typst` (crate) | `0.12.0` | Deterministic, tagged, board-quality PDF export (no browser, no jspdf) |
| `reqwest` | `0.12.9` (rustls) | Connector HTTP client (tokens never pass through webview) |
| `oauth2` | `4.4.2` | QBO/Xero OAuth2 flows; NetSuite OAuth1 via `hmac`+`sha2` signatures |
| `keyring` | `3.6.1` | OS Credential Store: Windows Credential Manager / macOS Keychain / Linux Secret Service |
| `aes-gcm` / `argon2` / `sha2` / `hmac` / `ed25519-dalek` | `0.10.4` / `0.5.3` / `0.10.9` / `0.12.1` / `2.1.5` | AES-256-GCM at rest · Argon2id PIN · SHA-256 vault hashes · HMAC audit chain · Ed25519 offline license |
| `tokio` | `1.40.0` | Async runtime (connectors, background imports) |
| `thiserror` / `serde` / `serde_json` / `uuid` / `base64` / `zip` / `regex` / `dirs` | `2.0` / `1.0` / `1.0` / `1.10` / `0.22` / `2.2` / `1.10` / `6.0` | Typed errors (→ ERROR-HANDLING.md), serialization, IDs, vault compression, normalization |

## 2. FRONTEND (webview) — TYPESCRIPT

| Package | Version | Why |
|---|---|---|
| **React + ReactDOM** | `19.2.8` | Industry-largest DOM ecosystem; concurrent rendering for huge grids |
| **TypeScript** | `5.9.3` (strict) | Compile-time contract for the whole UI; ban `any` (except typed boundaries) |
| **Vite** | `8.0.16` | Fast dev/build; webworker + assets handling; bundling for Tauri |
| **Tailwind CSS** | `4.3.3` + `@tailwindcss/vite` | Token-driven utility CSS, deterministic output |
| **AG Grid Community** | `35.3.0` (`ag-grid-community`, `ag-grid-react`) | The only table engine proven at 1M virtualized financial rows |
| **Apache ECharts** | `5.6.0` | Canvas charts at 100k points; waterfall/tornado/seasonality; deterministic export |
| **HyperFormula** | `3.0.4` | Excel-parity formula engine (Cell refs, cross-Sheet, cycles) — runs in a Web Worker |
| **Zod** | `4.4.3` | Schema validation for every IPC input at the UI boundary (gate, not guess) |
| **Zustand** | `5.0.13` + `persist` | Minimal, selector-based UI state; no server |
| **@tanstack/react-virtual** | `3.13.24` | Row/column virtualization in grids and report tables |
| **date-fns** | `4.1.0` | Locale-aware formatting (fiscal data still owned by Rust calendar) |
| **decimal.js** | `10.6.0` | Money formatting/parse in UI only — **never arithmetic** in financial paths (I1) |
| **lucide-react** | `0.475.0` | Icon set (paired with text/aria, a11y §5) |
| **i18next + react-i18next** | `26.2.0` / `17.0.8` | v1.0.0 English + locale-aware formats; V2 full i18n (V-011) |
| `@tauri-apps/api` | `2.11.0` | Typed invoke from UI |

## 3. TESTING & QUALITY

| Package | Version | Why |
|---|---|---|
| **Vitest** (+`@vitest/coverage-v8`, `@vitest/ui`) | `4.1.6` | Fast unit/component tests; coverage gates |
| **@testing-library/react / user-event / jest-dom** | `16.3.2` / `14.6.1` / `6.9.1` | React tests by user behavior, not implementation |
| **vitest-axe + axe-core** (+ `jest-axe`) | `0.1.0` / `4.10` / `10.0.0` | Accessible-UI verification (gate, not optional) |
| **Playwright** (`@playwright/test`) | `1.60.0` | E2E across 3 OS via `tauri-driver`; keyboard/a11y flows |
| **proptest** (Rust) | `1.5.0` | Property tests: money, calendar, rounding, consolidation invariants |
| **cargo test + cargo-audit** | toolchain / `0.20` | Rust unit + dependency security audit in CI |
| **ESLint 9** (`typescript-eslint 8`, jsx-a11y, react-hooks) + **Prettier 3** | `9.39.4` / `8.59` / `3.8.3` | Static style + `--max-warnings 0` as blocking gate |
| **Storybook** | `8.6.0` | Component states/variants gallery (all 5 states per component) |

## 4. BUILD & RELEASE

| Tool | Version | Why |
|---|---|---|
| GitHub Actions (YAML) | `v4` workflow syntax | One pipeline, 3 OS runners, signing per OS |
| `cargo-tauri` build | Tauri CLI `2.11.2` | Bundles MSI/NSIS · DMG · AppImage/deb/rpm |
| Signing | Windows `signtool` (EV/OV) · macOS `codesign` + notarization (Developer ID) · Linux `dpkg-sig`/AppImage signing | Release trust on all 3 platforms (R1) |
| Update host | GitHub Releases + `tauri-plugin-updater` (ed25519 signed) | Auto-Update from day one (F-036) |

## 5. EXPLICITLY NOT USED (with why — no "maybe")

| Rejected | Why |
|---|---|
| Electron | ≥ 150 MB per app, higher memory, no better native story than Tauri 2 in 2026 |
| Web server / Express / Fastify | Local-first single-user — no server exists (B1); no `server/` directory in repo |
| jsPDF / jspdf-autotable | Browser-JS PDFs are non-deterministic across OS; `typst` wins |
| ExcelJS in UI | Calamine/Rust reads faster, less memory; Rust owns ingestion (B14) |
| Recharts | SVG breaks at 100k points; ECharts canvas wins |
| Redux / Apollo / TanStack Query | No server; Zustand + engine calls only (STATE-MANAGEMENT.md) |
| Prisma / Diesel / sqlx | ORM + migration overhead; plain SQL + `rusqlite_migration` is auditable and simple |
| SQL.js (browser DB) | Reference project's dual-storage flaw (W4); SQLite lives in Rust only |
| Python at runtime | Packaging/speed; only dev tooling (B13) |
| Per-industry engines / sector modules | B15 — Industry Packs are data |

---

## 6. VERSION POLICY (binding)

1. `package-lock.json` + `Cargo.lock` are committed and are the CI source of truth.
2. Minor upgrades → PR with changelog + docs update; breaking upgrades → ADR in DECISIONS.md.
3. Security advisories: `npm audit` and `cargo audit` gate at HIGH+ (CI, blocking).
4. License gate: no GPL/AGPL dependencies (self-host/enterprise model) — verified by `scripts/license-check.mjs`.

*Referenced by: ARCHITECTURE.md, CI-CD.md, CODING-STANDARDS.md, CLAUDE.md.*
