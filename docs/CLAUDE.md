# CLAUDE.md

> **You are a coding agent working on OneFP&A — a local-first, cross-platform (Windows/macOS/Linux) FP&A desktop suite.**
> This file + docs/ are your complete context. Read: GLOSSARY.md → PRD.md → ARCHITECTURE.md → CODING-STANDARDS.md → ERROR-HANDLING.md in that order. **Never guess. When a doc conflicts with code, the doc is the source of truth and the bug is in the code.**

---

## 1. PROJECT CONTEXT (one paragraph)

OneFP&A replaces Excel + BI + cloud EPM for the full FP&A cycle: **import (GL Dump/Excel/4 ERP connectors) → model (Excel-compatible formulas + drivers + assumptions) → plan (Budget/Forecast/Scenarios) → analyze (variance + attribution + FVA) → report (statement suite + segment/board pack) → govern (audit + encryption + offline license)**. It is **desktop-only, offline-first, single-user**, built as a **Rust core (Tauri 2) + React 19/TypeScript UI** with SQLite storage. Industry support is **config data (Industry Packs) — never per-industry code**. The product promise is **perfection with zero compromises**: money is exact, every number is traceable, every screen has 5 states, every error is defined.

## 2. EXACT TECH STACK (canonical — TECH-STACK.md)

- Rust 1.85 (edition 2024) core; Tauri 2.11; tauri-specta (typed IPC); rusqlite 0.32 (WAL) + rusqlite_migration; rust_decimal 1.36; calamine 0.26; rust_xlsxwriter 0.79; typst 0.12; reqwest 0.12; oauth2/1; keyring 3.6; aes-gcm/argon2/ed25519-dalek/hmac/sha2; tokio 1.40.
- TypeScript 5.9 strict; React 19.2.8; Vite 8; Tailwind 4.3; AG Grid 36.1; ECharts 5.6; HyperFormula 3.4.0 (web worker); Zod 4.4; Zustand 5.0.13.
- Tests: Vitest 4.1 + Testing Library + vitest-axe; Playwright 1.60 (+ tauri-driver); cargo test + proptest.

## 3. FILE STRUCTURE (exact tree: ARCHITECTURE.md §2)

```
src/                     # TS UI (pages/, components/ui|domain/, stores/, workers/, api/, hooks/, theme/)
src-tauri/src/           # Rust core (commands/, core/{money,calendar,ingestion,engines,connectors,export,security}, audit.rs, storage/)
packs/                   # Industry Packs — DATA ONLY (schema-validated JSON + SQL seeds, per INDUSTRY-PACK-SPEC.md)
docs/                    # 60 specs — the ONLY source of truth; off-index docs fail CI (B8)
e2e/  scripts/  migrations/ (in src-tauri/migrations)
```

**Core specs you cannot skim:** GLOSSARY.md (terms) · MONEY-ROUNDING-SPEC.md (money — read before touching any amount)
· FORMULA-ENGINE-SPEC.md (supported functions/error values) · MODELING-METHODS-SPEC.md (methods/driver grammar)
· SCENARIO-VERSION-SPEC.md (state machine) · INDUSTRY-PACK-SPEC.md (pack schema — B15) · GL-TEMPLATE-SPEC.md
· CONNECTOR-DATA-DICTIONARY.md (per-provider fields) · EXPORT-FORMAT-SPEC.md (output contracts) · SCENARIO-VERSION-SPEC.md.
**UI work also requires:** WIREFRAMES-CORE.md / WIREFRAMES-ANALYTICS.md (region geometry — this file owns layout,
DESIGN-SYSTEM.md owns look) · COPY-GUIDELINES.md (every user-facing string; error text stays verbatim from
ERROR-HANDLING.md) · COMPETITIVE-ANALYSIS.md (why a differentiator claim is true — never invent one).
**Licensing / packaging work also requires:** PRICING-AND-ENTITLEMENTS.md (§7 interim rule: no code may branch on the license plan; §3 is the only sanctioned seam).

## 4. DO LIST (every task)

1. Read the relevant spec sections **before** writing code (feature → PRD, screen → SCREENS-SPEC, command → API-SPEC).
2. Use GLOSSARY terms **verbatim** in code identifiers, UI strings, and docs (e.g., `BusinessUnit`, `ImportBatch`, `Scenario`, `MoneyValue` — never `entity`, `upload`, `version-vs-scenario` confusion).
3. Keep **one owner per concern**: money math in Rust `core/money.rs`; calendar in `core/calendar.rs`; formulas via HyperFormula; ingestion one pipeline.
4. Money: pass `i64` minor units / decimal strings; **never float**; never `parseFloat`/`toFixed` on financial values; display only via `moneyFormat` utils.
5. All IPC: define Rust serde structs FIRST; regenerate tauri-specta bindings; validate UI inputs with Zod at the boundary.
6. Add **all 5 screen states** (loading/empty/error/success/populated) + exact error codes from ERROR-HANDLING.md for every new screen.
7. Write **tests with the change**: Rust proptest for math/calendar invariants; Vitest for components/stores; Playwright for user flows (UF-ids).
8. Keep accessibility: contrast tokens, focus ring, aria on grids/charts/modals, keyboard parity (ACCESSIBILITY.md).
9. Write an **Audit event** for every mutation command.
10. Run the full gate before submitting: `pnpm lint && pnpm test && cargo test && cargo clippy -- -D warnings && pnpm build`.
11. Update docs-index.json when adding a doc; add terms to GLOSSARY before using them.
12. Use `Pack` data, not code, for any new industry need (B15) — opened Pack Builder feature in Pack schema.

## 5. DON'T LIST (violations = rebuild)

1. **Never** use `f64`/`f32`/JS `number` for financial amounts, or `REAL` columns for money (I1).
2. **Never** create a second money/calendar/formula/ingestion implementation (B14/I5) — extend the owner.
3. **Never** add an HTTP server, `.env` runtime config, telemetry, or cloud sync (B1/B18-9).
4. **Never** add per-industry code/pages/engines (B15).
5. **Never** commit without tests for the change; no `skip`, `TODO`, `FIXME`, `// later`, TBD (B18-7).
6. **Never** use `continue-on-error`, `allow-failure`, or disable a gate in CI (B18-7).
7. **Never** store OAuth tokens/secrets in DB, localStorage, or logs — keychain only (AUTH-SPEC §5).
8. **Never** display color-only signals; always pair ↑/↓ + text (ACCESSIBILITY §5).
9. **Never** auto-fix data or "round to make it tie" — surface, let a human decide (B18-1, Health Check).
10. **Never** write docs that contradict PRD/GLOSSARY or add features to the PRD without tagging MVP/V2/FUTURE.
11. **Never** use mock/demo data in production code paths; Demo Company is separate (B18-3).
12. **Never** edit a locked/hash-verified artifact (Audit chain, Import Batch, Version) — create new ones.

## 6. FORBIDDEN PATTERNS

- `parseFloat`/`Number(x)` on money; `toFixed` in financial logic; `Math.round` on money.
- Global mutable state duplicated across stores (STATE-MANAGEMENT rule 1).
- Direct DB access from UI; business logic in components.
- Stringly-typed error handling — always `AppError` → IPC error shape.
- `any` in TS (except generated bindings); `unwrap()`/`expect()` in Rust paths reachable from IPC (use `thiserror`).
- Hardcoded hex/colors/spacings outside `theme/tokens.ts`.
- Silent `catch {}` / `catch (e) { console.log(e) }`.
- Dynamic SQL string concatenation (use params, migrations only).
- Import cycles between stores; components importing other components' private helpers.

## 7. RESPONSE FORMAT RULES (reporting back)

```
## Summary        — 2–4 sentences, what changed and why (reference doc IDs)
## Files          — changed/added files with one-line purpose
## Tests          — added/updated + command + result (include exact counts)
## Gates          — lint / tsc / unit / cargo / e2e / a11y — PASS/FAIL with evidence
## Docs synced    — GLOSSARY/PRD/API-SPEC/ERROR-HANDLING updated where needed (or "no changes needed")
## Risks          — deviations, open questions, or waivers (with reason)
```

Never claim green without output; never state a doc fact without citing the doc; if specs conflict, stop and ask.

## 8. FIRST TASKS (when told to build)

1. `src-tauri` scaffold + storage migrations 001 (tables per DATABASE-SCHEMA.md) + money core + error.rs.
2. `session.unlock/status` + S-001; encryption + keyring integration.
3. Calendar engine + oracle tests; COA + dimensions; First-Run Wizard (S-002).
4. Ingestion pipeline (parse→map→validate→tie-out→commit) + S-030/031/032.
5. Model grid (HyperFormula worker) + cell.set + S-040/041/042; then engines, reports, governance in ROADMAP.md order.

*Source of truth chain: GLOSSARY → PRD → ARCHITECTURE → API-SPEC → ERROR-HANDLING → CODE.*
