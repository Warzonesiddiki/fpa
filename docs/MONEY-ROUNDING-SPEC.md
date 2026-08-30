# MONEY-ROUNDING-SPEC.md

> OneFP&A · v1.0.0 · **The canonical money & rounding contract** — single owner `core/money.rs` (ADR-003, I1). No other module may round money. All rules below are property-tested (10k cases, `proptest`) + oracle-tested.

---

## 1. MONEY REPRESENTATION

| Layer | Representation |
|---|---|
| Rust core | `MoneyValue { minor: i64, scale: u8, currency: CurrencyCode }`; arithmetic via `rust_decimal` internally (28-digit) |
| SQLite | `amount_minor INTEGER` (+ `currency_code`); **never REAL** |
| IPC (Rust→TS) | `i64` minor units or decimal string (`"182500.00"`) — never JS number |
| UI display | `decimal.js` formatting only; no arithmetic |
| Formula engine | float internally (Excel parity) → **rounded to Currency Scale on commit** |

**Currency Scale** (from `currency_scales` seed; not derivable from symbol): USD/INR/EUR/GBP = 2 · JPY/KRW = 0 · KWD/BHD = 3 · CHF = 2. Unknown currency code at import → HARD `CURRENCY_UNKNOWN`.

## 2. ROUNDING MODES (only three, exactly)

| Mode | Use | Rule |
|---|---|---|
| `HALF_UP` | Default for all money arithmetic & statement subtotals | round half away from zero; `2.675 → 2.68` (exact decimal, never binary float) |
| `HALF_EVEN` | Only inside Largest-Remainder Allocation tie-breaks | `0.5 → 0` / `1.5 → 2` (prevents systematic bias across many lines) |
| `TRUNCATE` | Non-money display (percent, ratios, unit counts) only | never applied to `amount_minor` |

No `ROUND_CEILING`/`ROUND_FLOOR` in money paths (budget symmetry broken). If a model needs ceiling rounding explicitly, the user writes a Formula with `CEILING` (documented, not a money-core mode).

## 3. COMPUTE vs DISPLAY ROUNDING (the two-step rule)

1. **Compute:** every engine result is an exact `rust_decimal` value (28 digits), rounded to Currency Scale with `HALF_UP` **only at the boundary where a value becomes a stored/committed model value or statement line** (Currency Scale).
2. **Display:** a value may be displayed at fewer decimals (000s, 0 dp) — display NEVER changes stored values.
3. **Formula-engine cells:** engine computes in float for Excel parity → `round_to_scale(HALF_UP)` at commit → stored as Cash-style exact value → **no accumulated float drift** (0.1+0.2=0.3 guaranteed in stored model).

## 4. LARGEST-REMAINDER ALLOCATION (statement/report exact totals — F-027)

**Problem:** a P&L in 000s where subtotals are rounded independently can show `12 + 3 + 7 = 21` but the rolled-up total shows `22`.

**Algorithm (exact):**
```
1. Compute exact totals (unrounded) for every line and every subtotal.
2. Floor every line to display rounding unit (u = 10^display_decimals).
3. residual_total = exact_total − Σ floor(line_i)
4. Distribute residual_total in units of u:
   a. compute fractional remainders r_i = exact_line_i − floor(line_i) (in [0, u))
   b. sort lines by r_i descending; tie-break by HALF_EVEN on r_i/u
   c. add u to the first k lines, where k = round(residual_total / u)
   d. if residual_total negative, subtract u from lowest-remainder lines first
5. Assert: Σ displayed lines == displayed subtotal == displayed total.
```

**Invariant (tested):** `sum(displayed children) === displayed parent` for every hierarchy (P&L sections, BS classes, CF sections, group BU+eliminations = group total, KPI display cards on a report). Violation at runtime = Health Check HARD `ROUNDING_DRIFT`; export blocked.

## 5. SIGN CONVENTIONS (money in/out)

| Source | Convention |
|---|---|
| GL Line (import) | `amount_minor` signed; debits positive, credits negative (canonical). Wide Debit/Credit columns converted by import sign interpretation (F-011) |
| P&L | Revenue +, Costs − ; Favorable/Unfavorable computed by Account Type (revenue up = favorable, cost up = unfavorable) — never by sign alone |
| BS | Assets +, Liabilities/Equity − (so `Assets + (Liabilities) + (Equity) = 0` — used by tie-out property) |
| CF | Operating/Investing/Financing per standard; net CF ties to BS cash delta |
| Display | negatives as parentheses (default) or minus (setting) — display only |

## 6. RATES & PERCENTAGES (non-money precision)

| Kind | Precision | Example |
|---|---|---|
| FX rate | 8 dp decimal (exact string in `fx_rates.rate_decimal`) | `1.08420000` |
| Percentage (assumption/driver) | 6 dp decimal (store percent as decimal, e.g., `4.0` = 4.0%) | `wage_inflation = 4.0` |
| Ownership % | 6 dp (`NUMERIC(9,6)`) | `80.000000` |
| Weight/seasonality | 6 dp, sum validated to 1.00 (± 0.000001) | `0.166667` |

Rates are multiplied using `rust_decimal` (never float) in Rust engines; the formula engine may evaluate rate math as float but commits through the Money boundary.

## 7. PROPERTY & ORACLE VECTORS (must pass)

| Test | Expected |
|---|---|
| `sum(["0.1","0.2"])` | `0.3` (never 0.30000000000000004) |
| `mul("1.10","2.20")` | `2.42` |
| `round_half_up("2.675", 2)` | `2.68` |
| `round_half_up("-2.675", 2)` | `-2.68` (away from zero) |
| currency scale map | USD/INR=2, JPY=0, KWD=3 |
| largest-remainder on 3-line 000s example | displayed sum matches parent to the unit |
| 10,000 random decimal round-trip | parse→format→parse identity |
| IPC boundary | no float in any `serde` money field (schema test) |

## 8. ENFORCEMENT

1. `money:ast` AST scan: any `parseFloat`/`Number()`/`Math.round`/`toFixed`/`REAL` on financial paths = CI fail.
2. Rust: `MoneyValue` constructors validate `scale ≤ 4`; `impl` only in `core/money.rs`.
3. Schema: `amount_minor INTEGER`; `rate_decimal TEXT`; no `REAL` money columns (schema-equality check).
4. UI: `moneyFormat` (decimal.js) is the only money formatter; no arithmetic.

*Referenced by: TECH-STACK ADR-003, DATABASE-SCHEMA §1/§9b, FORMULA-ENGINE-SPEC §5, PERFORMANCE §7.*
