# CODING-STANDARDS.md

> OneFP&A · v1.0.0 · **Naming conventions per entity type, import order, async patterns, file naming, component structure template.** Enforced by ESLint/Prettier/tsc/clippy + review (no warnings allowed).

---

## 1. NAMING CONVENTIONS

| Entity type | Convention | Examples |
|---|---|---|
| Rust files | `snake_case.rs`; one concept per file | `money.rs`, `calendar.rs`, `qbo.rs`, `statement.rs` |
| Rust structs/enums | `PascalCase`; `AppError` suffix for errors | `ImportBatch`, `FiscalPeriod`, `IngestionError` |
| Rust functions | `snake_case` verb-first | `commit_batch()`, `tie_out()`, `translate_bu()` |
| DB tables/columns | `snake_case` plural tables; singular columns | `model_values.amount_minor` |
| TS files | `camelCase.ts` (utils), `PascalCase.tsx` (components), `kebab-case` only for page dirs (`s041-grid/`) | `moneyFormat.ts`, `KpiCard.tsx`, `pages/s041-grid/` |
| React components | `PascalCase`; domain-prefixed when financial | `MoneyCell`, `TieOutPanel`, `FiscalPeriodPicker` |
| Store files | `camelCaseStore.ts`; one store per concern | `scenarioStore.ts` |
| Hooks | `use*` | `useScenario`, `useModelValues` |
| Zustand slices | `create<Name>Store` | `useScenarioStore` |
| CSS classes | Tailwind utility only (no custom class names unless theme layer) | — |
| Error codes | `PASCAL_CASE`, domain prefix | `IMPORT_TIE_OUT_FAILED`, `MODEL_CELL_LOCKED` |
| IPC commands | `domain.action.v1` dotted | `model.cell.set.v1`, `import.commit` |
| IDs (UI) | `uuid v4` strings; never user text as PK | `sc-base` examples are docs-only |
| Env/feature flags | `ONE_FPA_*` (build-time only; no runtime .env) | `VITE_API` forbidden — none |

**Domain names (GLOSSARY) — never synonymized in identifiers:** `BusinessUnit` (not Entity/Division), `ImportBatch` (not Upload), `Scenario`/`ScenarioVersion` (not Case/Version interchangeably), `MoneyValue` (not Amount in code types), `FiscalPeriod` (not Period as type), `Driver` (not KPI input), `Kpi` (not Metric).

## 2. IMPORT ORDER (lint-enforced)

```
1. react / react-dom
2. external packages (alphabetical)
3. @/ alias imports (alphabetical, by path)
4. relative imports (../ ./)
5. type-only imports (must use `import type`)
6. CSS / assets
```
Never import from `components` into `pages`? **Rule:** pages → hooks → stores → api (generated) → utils; components never import pages; stores never import components. Single import per line; no barrel `index.ts` for stores (explicit paths, greppable).

## 3. ASYNC & CONCURRENCY PATTERNS

| Situation | Pattern |
|---|---|
| IPC calls from UI | `useQuery`-free — custom hooks with `useAsync` wrapper (AbortController), never bare `useEffect` side effects |
| Background work | Rust `tokio::spawn`; UI progress via Tauri events (`import:progress`, `recalc:done`) |
| Recalc | HyperFormula worker — input queue, single-flight (no concurrent recalcs), result keyed by `(model, scenario, version)` |
| Import (long) | Checkpoint every 5s; resumable via `parse_id`; cancellable; Result channel |
| Connectors | `tokio` + `reqwest`; rate limiter (leaky bucket) per provider; circuit breaker; timeout 30s per request |
| Undo | Command pattern (serialized), max 100; snapshot refs for model-level undo; never async recalc inside undo (queue) |
| Web events | Tauri `listen` in a single provider; typed events; unsubscribe on unmount |
| Error in async | Always catch → `AppError` → IPC shape → UI; no unhandled promise rejections (global handler logs diagnostics) |
| Rust panics | `catch_unwind` boundary on commands; `INTERNAL` + diagnostics capture |

## 4. FILE NAMING & STRUCTURE

### Component template (structure mandatory)

```tsx
// src/components/domain/MoneyCell.tsx
/** @file MoneyCell — Money Value display (tabular, locale, sign style). Pure. */
import type { MoneyValue } from '@/api/types';
import { moneyFormat } from '@/utils/moneyFormat';

export type MoneyCellProps = {
  value: MoneyValue | null;   // null = missing → renders 'n/a', never 0
  format?: 'plain' | '000s' | 'pct';
  signed?: boolean;
  direction?: 'favorable' | 'unfavorable' | 'neutral';
  showIcon?: boolean;          // default true — color never alone (a11y)
  signStyle?: 'paren' | 'minus';
};

export function MoneyCell({ value, format='plain', direction='neutral', ... }: MoneyCellProps) {
  // 1. derive text (never mutate value) 2. render with aria-label 3. no logic beyond display
}
```

Rules: one component per file; props typed; pure functions at top; no `useMemo` unless measured need; comments explain *why* not *what*.

### Rust module template

```rust
//! core/ingestion.rs — single owner of the ingestion pipeline (B14).
use crate::core::error::AppError;
use crate::core::money::MoneyValue;

pub struct ParseResult { /* … */ }

pub fn validate(rows: &[Row], mapping: &Mapping) -> Result<ValidationOutput, AppError> {
    // No side effects; DB writes happen in the command layer, not engines.
}
```

Rules: engines are pure; commands are thin (validate → core → repository); `AppError` from `thiserror` via `#[error("…")]`; no `unwrap()` (clippy `-D warnings`); doc comments on public items.

## 5. TYPESCRIPT & RUST STRICTNESS

- TS `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; `any` banned (lint); `unknown` for IPC + Zod narrow.
- Zod schemas mirror serde structs (`src/api/schemas.ts`); changes are paired (generate + test).
- Rust: `#![deny(clippy::all, clippy::pedantic)]` in workspace; `rustfmt` + `cargo clippy -- -D warnings` gate.
- Money types: `pub type MinorUnits = i64; pub struct MoneyValue { minor: MinorUnits, scale: u8, currency: CurrencyCode }`; all ops via `core::money` (add/sub/mul with rounding policy) — no operator overloading outside it.

## 6. STYLE & FORMAT

- Prettier (printWidth 100, singleQuote, semi) + ESLint (`--max-warnings 0`); Rust `rustfmt` defaults.
- No trailing whitespace; LF line endings; UTF-8.
- Commit hooks: husky + lint-staged (eslint --fix, prettier, tsc for touched).

## 7. REVIEW CHECKLIST (every PR)

1. Doc references present (PRD/SCREENS/API codes).
2. All 5 states + error codes for new screens.
3. Money types correct; no float; format tests exist.
4. A11y: axe tests pass; no color-only.
5. Tests added; count reported; coverage not reduced.
6. Docs-index updates; GLOSSARY terms used.
7. No forbidden patterns (manual scan + lint).

*Referenced by: CLAUDE.md, GIT-STANDARDS.md, TESTING-STRATEGY.md.*
