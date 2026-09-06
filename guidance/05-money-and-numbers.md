# 05 · Money & numbers — exactness is law

This is audit-grade financial software. **Money is never a float.** A single `f64` in a
money path is a release-ending defect (B3/I1). `npm run money:ast` is the gate.

## Read first

- `docs/MONEY-ROUNDING-SPEC.md` — the definitive rules (representation, rounding,
  allocation, display). Everything here routes to it.
- `docs/MODELING-METHODS-SPEC.md` — spreading, growth, seasonality methods.

## Representation (the only allowed forms)

- **Rust core:** `rust_decimal::Decimal` for computation; **i64 minor units** for storage
  where the schema says so. No `f32`/`f64` anywhere near money.
- **TypeScript:** money crosses IPC as **decimal strings** or integer minor units, never
  as a JS `number` you do arithmetic on. Use `decimal.js` if the UI must compute (rare —
  the Rust core should compute).
- **Database:** no `REAL` column for money. `schema-equality-check` enforces this.

## Banned in any money path (money:ast scans for these)

`f64`, `f32`, `parseFloat`, `Number(x)` on money, `toFixed`, `Math.round`, `Math.floor`
/`Math.ceil` on money, `.toNumber()` on a money Decimal, `Intl.NumberFormat` for the
authoritative value (formatting for display only, via the approved helper), `Decimal(number)`
constructed from a float, SQLite `Value::Real` for money.

## Rounding & allocation

- Follow `docs/MONEY-ROUNDING-SPEC.md` exactly. Display rounding and residual-allocation
  rounding are **different** (e.g. HALF_UP for display vs HALF_EVEN for the
  residual-to-grid step in largest-remainder allocation — see `core/money.rs`).
- Allocation/splits use the **single** largest-remainder implementation in
  `core/money.rs` (`largest_remainder_allocate`). Do not write a second splitter; the TS
  side mirrors, it does not re-own (B14).
- Totals must always tie: sum of allocated parts == the exact total, to the minor unit.

## When you add numeric code

1. Compute in the Rust core with `Decimal`; return decimal strings / minor units.
2. Display with the approved money formatter (`src/utils/money.ts` /
   `components/domain/MoneyCell`), never ad-hoc `toFixed`.
3. Add property tests (proptest in Rust) for invariants: no rounding drift, totals tie,
   sign handling, scale ≤ the documented max.
4. Run the gate:
   ```bash
   npm run money:ast        # must PASS — no financial float paths
   cargo test               # (CI) money.rs unit + property tests
   ```

## Quick self-check before commit

```bash
npm run money:ast
grep -rnE "parseFloat|toFixed|Math\.round|\.toNumber\(" src | grep -iE "money|amount|price|cost|value|total"
grep -rn "f64|f32" src-tauri/src | grep -iE "money|amount|price|cost|decimal"
```

If any hit is on a money path, fix it before proceeding. If you believe a float is truly
non-money (e.g. a chart pixel ratio), it must be obviously non-financial and ideally
outside the scanned paths — when in doubt, keep it exact.
