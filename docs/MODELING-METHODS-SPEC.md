# MODELING-METHODS-SPEC.md

> OneFP&A · v1.0.0 · **Exact semantics of the 7 Planning Methods, Period Spreading, Bootstrap/Copy, and the Driver expression grammar (F-013/F-015).** Terms per GLOSSARY.md (Method, Driver, Assumption, Spread, Hybrid Period).

---

## 1. PLANNING METHODS (per planning line — `model_lines.method`)

| Method | Stored inputs | Computed value (per Period) | Notes |
|---|---|---|---|
| `manual` | explicit value (user-typed) | the value | cell has `computed=0`; overrides never re-derived |
| `static` | single constant (may be Assumption ref) | constant × (no growth) | useful for fixed costs |
| `driver` | driver expression (`D[expr]`) | evaluated by Driver grammar (§2) | method chip shows the driver; attribution available |
| `growth` | `{start_value, rate_%}` | `start × (1 + rate)^(n−1)` (n = period index) | rate may be Assumption ref; compounding exact decimal |
| `yoy` | `{source_line, fallback}` | same period of prior FY from `source_line` | missing prior period (first year) → `fallback` (method switches to `manual` with WARNING, per US-016) |
| `seasonal` | `{annual_or_driver, weights}` | annual spread by `weights` (Period Spreading §3) | weights validated to 1.00; W53 excluded by default |
| `spread` | `{total, method: equal\|seasonal\|custom\|lump}` | spread total across the horizon | explicit "spread" is a one-time action; result stored as `seasonal`-style values with provenance |

## 2. DRIVER EXPRESSION GRAMMAR (`driver` method)

```
expr      := term (('+'|'-') term)*
term      := factor (('*'|'/') factor)*
factor    := NUM | DRIVER | ASSUMPTION | 'period' | '(' expr ')'
NUM       := decimal literal
DRIVER    := driver name (e.g., units_sold)   // resolves to Driver Table value for the period
ASSUMPTION := @assumption_name               // resolves from Assumption Register
'period'  := current Fiscal Period ordinal (for ramp/step logic)
```

Examples: `units_sold * price` · `fte_count * salary * (1 + @wage_inflation)` · `@fx_usd_eur * units * price` · `IF(period >= 6, 0, ramp)` — `IF` is allowed only via Formula (see FORMULA-ENGINE-SPEC); Driver grammar is deliberately arithmetic-only (keeps attribution computable). Any formula-level logic → the user writes a Formula line instead (F-012).

**Attribution guarantee:** a line whose method is `driver` and whose factor chain is a **product of one Driver and other concrete/simple terms** is decomposable into Volume/Price/Mix/FX/Efficiency by the Variance engine (F-024). Chains that are sums or contain `@assumption` with period-varying rates are attributed by approximation with explicit "approximate" flag — never presented as exact without that flag.

## 3. PERIOD SPREADING (exact algorithm)

```
Input: total T (Money Value), horizon periods P = [p1..pn], weights W (sum ≈ 1.00)
1. If method == 'equal': v_i = T / n  (rounded each period to scale; residual to the LAST period
   via Largest-Remainder so Σ v_i == T exactly)                          → ROUNDING-SPEC §4
2. If method == 'seasonal': v_i = T × w_i  (weights from pack curve or user curve; exact decimal)
3. If method == 'week_weighted': for week-based calendars (4-4-5, 4-5-4, 5-4-4, 13-period),
   w_i = weeks_in_period_i / total_weeks_in_year (e.g. 4/52 or 5/52; 4/53 or 5/53 in leap fiscal years),
   ensuring 5-week months with 25% more operating days receive proportional budget.
4. If method == 'working_days': w_i = business_days_in_period_i / total_business_days_in_year.
5. If method == 'custom': user supplies per-period values; validates Σ == T (± unit) or offers
   "normalize residuals" (audited choice — never silent)
6. If method == 'lump': user-supplied map period → amount; Σ must equal T
7. 13-period / 53-week calendars: `W53`/P13 weight optional; if excluded, weights re-normalized
   to the 12/13 periods actually planned; report flags the exclusion.
8. Hierarchical Spreading (Breakback): Top-down adjustment applied to a consolidated line
   is distributed proportionally down its child lines based on prior period actual weights.
Validation: sum(weights) ≠ 1.00 ± 1e-6 → HARD SPREAD_WEIGHTS_INVALID with "normalize or fix".
```

## 4. BOOTSTRAP & COPY (F-015)

| Operation | Semantics (choose one, per-line or per-sheet) | Audit |
|---|---|---|
| **Actuals → Budget (PY basis)** | copies Actuals values for the source FY into Budget target FY periods; option `keep_formulas` (copy formulas with relative refs remapped) or `re-drive` (rerun drivers) | `bootstrap.copy` event with options + affected line count |
| **Prior-Year → Budget** | `yoy` method: target = source-line same period prior FY; missing → `manual` + WARNING | per-line mapping |
| **Scenario → Scenario** | full duplicate of editable Scenario (structure + values + formulas + comments); Locked source → snapshot version; option `re-drive` | `scenario.duplicate` |
| **Year → Year (LRP)** | copies a template FY into next FY with method preservation (`yoy` auto = prior FY ref) | `model.year.copy` |

**Rules:** copies never overwrite Locked targets (blocked `MODEL_CELL_LOCKED`); every copy writes a fresh Audit event (before/after counts); copy of a hybrid-labels model keeps labels.

## 5. HYBRID PERIOD LABEL (never silent mixing)

A Model period is one of:
```
ACTUAL            — all data from committed Import Batches (F-007)
FORECAST          — no Actuals yet, forecast only
HYBRID (Actual P01–P04, Forecast P05–P12)   — mixed, ALWAYS labeled in every report
PLAN_ONLY         — Plan-Only mode; no Actuals at all (variance shows "No Actuals — projected only")
```
Health Check fails any report that mixes unlabeled periods (`VARIANCE_SOURCE_MIXED`).

## 6. LINE TYPES & ROLLUP

Lines are `input` (manual/method), `formula` (HyperFormula), `parent` (subtotal of children — computed as SUM, never typed), `driver_line` (consumes Driver Table), `schedule` (headcount/capex/debt). Parent totals are always SUM of visible children; hidden children cannot be silently excluded (a parent with un-mapped children = Health Check HARD `LINE_MAPPING_INCOMPLETE`).

### 6.1 Headcount schedule (F-016 / S-045)

A headcount row carries unique `employee_id`, `role`, `cost_center`, ISO `start_date`, nullable ISO `termination_date`, `base_comp_decimal`, `bonus_pct`, `benefits_pct`, `employer_load_pct`, and integer `ramp_months`. All compensation and percentage values cross IPC as Decimal strings.

For each loaded fiscal period:
1. **Base Compensation Annualization:** The annual base compensation is divided by the fiscal year period frequency (`periods_per_year`: 12 for monthly, 13 for 4-week, 52 for weekly), **never** by the loaded multi-year horizon length (`periods.len()`). Multi-year models maintain exact monthly run rates across all years.
2. **Timing Proration:** Employees active for partial periods are prorated by `active_days / period_days`. Employees hired prior to the model horizon start are active on day 1 (start dates before the model start are valid; `HC_DATE_INVALID` applies only if termination precedes start date).
3. **Capacity vs Cost:** Quota-carrying ramp schedules adjust sales capacity without altering base salary compensation.
4. **Multiple Roles:** Rows are identified by distinct `employee_id`; multiple employees may share the same role and cost center without collision.

### 6.2 Capital, Debt & Working Capital schedule (F-017 / S-046)

1. **Working Capital Operating Cash Flow Impact:**
   - Operating cash flow impact of working capital is the change in Net Working Capital:
     $$\Delta\text{NWC}_t = \text{NWC}_t - \text{NWC}_{t-1}, \quad \text{OCF Impact} = -\Delta\text{NWC}_t$$
   - AR, AP, and Inventory are derived from DSO, DPO, and DIO over elapsed period days.
2. **Institutional Debt Amortization & Day-Count Conventions:**
   - Term loan and revolver interest accruals support exact ISDA day-count conventions:
     - `Actual/360`: Standard US corporate debt ($\text{Rate} \times \text{Days} / 360$).
     - `Actual/365`: Standard UK/Commonwealth debt ($\text{Rate} \times \text{Days} / 365$).
     - `30/360`: Bond basis.
   - Eliminates the ~1.39% interest expense understatement caused by naive annual/12 division.
3. **Depreciation Roll-Forward:**
   - Straight-Line (SL), Double Declining Balance (DDB) with automatic optimal switch to Straight-Line when SL exceeds DDB, and MACRS half-year convention tax depreciation schedules.

*Referenced by: PRD F-013/F-015/F-016/F-017, SCREENS S-041/S-043/S-045/S-046, FORMULA-ENGINE-SPEC, VARIANCE/ATTRIBUTION (PRD F-024).*
