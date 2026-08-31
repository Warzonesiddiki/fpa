# FORMULA-ENGINE-SPEC.md

> OneFP&A · v1.0.0 · **The supported function set, syntax, precedence, and error semantics for the Model grid (F-012).** Engine: HyperFormula 3.0.4 in a Web Worker; all authored Formulas live in `model_values.formula`. No function outside the set — anything else fails `FORMULA_UNSUPPORTED_FUNCTION` (never silent).

---

## 1. SYNTAX

- Formulas start with `=`. Cell refs: `Sheet!C10` (sheet name quoted if it contains spaces: `'Opex Detail'!C10`).
- Named Ranges (Drivers/Assumptions) resolve to Named Range refs: `units_sold`, `wage_inflation` — case-insensitive; conflict with a Sheet name is a validation error.
- Ranges: `A1:B10`; 3D refs across Sheets are NOT supported in v1.0.0 (documented limitation; V2).
- Operators: `+ - * / ^ %` · comparisons `= <> < > <= >=` · concat `&` · references `!`, `:`, `,` (union), `;` (intersection — Excel-compat).
- Precedence (high→low): parentheses → `^`  → `* /` → `+ -` → `&` → comparisons. HyperFormula follows Excel precedence exactly.
- Percent literals: `12%` = `0.12` (exact decimal, not float).
- Money literals are decimal strings (`182500.00`); engine stores exact decimal; float only inside engine-internal IEEE-754 evaluation for Excel parity, with **cell-commit rounding to Currency Scale** (MONEY-ROUNDING-SPEC §3).

## 2. SUPPORTED FUNCTION SET (v1.0.0 — whitelist)

> **Count:** **103 supported functions** (30 math/aggregation + 24 logical/lookup + 32 text & date
> incl. 5 fiscal-aware + 15 financial + 8 Analysis Functions). This is the single whitelist gate;
> the UI mirror lives in `src/api/schema.ts` (`SUPPORTED_FUNCTIONS`) and the authoritative Rust
> gate in `src-tauri/src/core/model.rs` — the two must stay identical (B14). Anything else →
> `FORMULA_UNSUPPORTED_FUNCTION` (never silent).

### Math & aggregation
`SUM` `SUMIF` `SUMIFS` `SUMPRODUCT` `AVERAGE` `AVERAGEIF` `AVERAGEIFS` `COUNT` `COUNTA` `COUNTIF` `COUNTIFS` `MIN` `MAX` `MEDIAN` `ROUND` `ROUNDUP` `ROUNDDOWN` `MROUND` `ABS` `SQRT` `POWER` `MOD` `INT` `TRUNC` `CEILING` `FLOOR` `SIGN` `PRODUCT` `RAND` (seeded: `RAND()` with `seed` param — deterministic in v1.0.0) `RANDBETWEEN`

### Logical & lookup
`IF` `IFS` `IFERROR` `IFNA` `AND` `OR` `NOT` `XOR` `SWITCH` `TRUE` `FALSE` `ISNUMBER` `ISTEXT` `ISBLANK` `ISERROR` `ISNA` `VLOOKUP` `HLOOKUP` `XLOOKUP` `INDEX` `MATCH` `CHOOSE` `OFFSET` (bounded) `INDIRECT` (Sheet-scoped only, audit-logged)

### Text & date
`CONCAT` `CONCATENATE` `TEXT` `LEFT` `RIGHT` `MID` `LEN` `UPPER` `LOWER` `TRIM` `SUBSTITUTE` `VALUE` `DATE` `YEAR` `MONTH` `DAY` `EOMONTH` `EDATE` `DATEDIF` `WEEKDAY` `NETWORKDAYS` · **Fiscal-aware date functions** (pack-level): `FPERIOD(date)` `FQTR(date)` `FYEAR(date)` `FPERIODSTART(p)` `PERIODLEN(p)` — computed by the Rust Calendar engine, not the formula engine (I5).

### Financial (included, documented — NOT "advanced later")
`NPV` `IRR` (bisection, max 100 iter) `XNPV` `XIRR` (Newton w/ fallback) `PMT` `IPMT` `PPMT` `FV` `PV` `RATE` `NPER` `SLN` `DDB` `SYD` `DB`

### Analysis Functions (OneFP&A-declared — FORMULA-ENGINE-SPEC §3)
`CAGR(start, end, periods)` · `MOVINGAVG(values, window)` · `TREND(values, points)` (linear least-squares) · `SEASONALITY(values)` (returns monthly index 0–2) · `YOY(period_ref)` · `PRIORPERIOD(period_ref)` · `PRIORYEAR(period_ref)` · `RATIO(numerator, denominator)`

**Anything else** → `FORMULA_UNSUPPORTED_FUNCTION` (explicit, with closest suggestion). No `LAMBDA`, no macros, no UDFs in v1.0.0 (V2).

## 3. ANALYSIS FUNCTIONS — exact semantics

| Function | Signature | Definition | Example |
|---|---|---|---|
| `CAGR` | `CAGR(start, end, n)` | `(end/start)^(1/n) − 1` exact decimal; n = number of periods | `=CAGR(C2, C14, 12)` |
| `MOVINGAVG` | `MOVINGAVG(range, window)` | simple moving average, window ≥ 2; partial windows use available data | `=MOVINGAVG(C2:C13, 3)` |
| `TREND` | `TREND(range, points)` | linear least-squares projection over next `points` fiscal periods (Rust engine — reported as an engine call) | `=TREND(C2:C13, 3)` |
| `SEASONALITY` | `SEASONALITY(range)` | monthly index = average share of each fiscal month over the range (sums to 1.00; to 1.08 for 13-period calendars) | `=SEASONALITY(C2:C13)` |
| `YOY` | `YOY(cell)` | same Fiscal Period last year | `=YOY(C2)` |
| `PRIORPERIOD` | `PRIORPERIOD(cell)` | previous Fiscal Period (P01 → prior FY P12/P13) | `=PRIORPERIOD(C3)` |
| `PRIORYEAR` | `PRIORYEAR(cell)` | prior Fiscal Year, same period | `=PRIORYEAR(C3)` |
| `RATIO` | `RATIO(a, b)` | exact division; `b=0` → `#DIV/0!` (never Infinity) | `=RATIO(G2, G1)` |

## 4. ERROR VALUES (rendered exactly, never as numbers)

| Value | Meaning | Recovery |
|---|---|---|
| `#CYCLE!` | Circular Reference detected — app shows full cycle path (Formula Inspection) | change a ref / mark a cell `manual_override` (audited) |
| `#REF!` | Reference to a deleted/renamed Sheet/Cell | auto-repair offer (Sheet rename updates refs atomically) |
| `#VALUE!` | Wrong type (text in arithmetic) | fix cell type |
| `#DIV/0!` | Division by zero | add guard `IF(ISBLANK(b),0,…)` |
| `#N/A` | Lookup not found | fix lookup key |
| `#NAME?` | Unknown name | use Formula Inspector to resolve |
| `#NUM!` | Numeric overflow/domain (e.g., IRR no sign change) | change inputs |
| `#UNSUPPORTED!` | Function outside whitelist (engine converts UNSUPPORTED to this error value) | replace function |

Rules: an error value **never propagates into a statement total as 0** — a cell with any error value marks its whole ancestor chain `#VALUE!`-style "unresolved" in Health Check (HARD); exports blocked until resolved or waived. Error cells are highlighted (red border) with a tooltip + "Fix" action.

## 5. RECALCULATION & GRAPH

- Dependency graph built at load; edits mark dirty cells; **incremental recalc** only (dirty subgraph); full recalc on model/scenario switch.
- Recalc runs in a single Web Worker; single-flight (queue, no concurrent); result returned as `recalc.dirty_cells/cycles/changed_cells` (API `model.cell.set.v1`).
- **Cycle policy:** cycle detected at build time (before evaluation) → marked `#CYCLE!`; the app never evaluates a cycle to a number.
- **Determinism:** same model + inputs → identical values on all OS (property test; float divergence eliminated by commit-rounding).
- **Scale contract:** engine evaluates in float (Excel parity), **then rounds to Currency Scale at commit** (MONEY-ROUNDING-SPEC §3); rust_decimal never participates in cell evaluation (I1 boundary: engine output → Money Value on commit).

## 6. FORMULA INSPECTION (S-042)

Trace precedents/dependents per Cell; dependency list rendering (Sheet!Cell → formula → source drivers/assumptions); cycle path UI; unsupported-function suggestion; audit: every Formula authored/edited is in the Audit Trail (cell-level before/after).

*Referenced by: PRD F-012, SCREENS S-041/S-042, API-SPEC model.cell.set.v1, MONEY-ROUNDING-SPEC.*
