# tests/fixtures/statements/

Statements & Rounding Oracle fixtures (TEST-FIXTURES-SPEC §1 `statements/` and §3 `ORACLE STATEMENT EXPECTATIONS`, MONEY-ROUNDING-SPEC §3–5). Synthetic, deterministic, data-only (no code) — B5/B18-3. They pin the exact statement expectations and largest-remainder allocation invariants (F-027).

## Fixtures

| File | Content |
|---|---|
| `pl_basic.json` | Hand-computed 8-line P&L (Revenue, COGS, Gross Profit, OpEx, EBITDA, Depr, EBIT, Tax, Net Income). |
| `pl_basic.expected.json` | Exact cents and minor-unit expectations per TEST-FIXTURES-SPEC §3. |
| `bs_basic.json` | Hand-computed Balance Sheet with Assets, Liabilities, and Equity line items. |
| `bs_basic.expected.json` | Exact cents, tie-out invariant `Assets = Liab + Equity` and signed sum `Assets + (Liab) + (Equity) = 0`. |
| `cf_basic.json` | Hand-computed Cash Flow statement (Operating, Investing, Financing). |
| `cf_basic.expected.json` | Exact cents, `OCF + ICF = FCF`, Net Cash Change ties to BS cash delta. |
| `rounding_oracle.json` | Curated multi-case largest-remainder allocation test suite (000s, negative numbers, 2dp, ties). |
| `rounding_oracle.expected.json` | Exact distributed line outputs and displayed totals asserting $\sum \text{displayed} = \text{total}$. |

## Consumers

- `src/test/statement-fixtures.test.ts` (sandbox-runnable): verifies file integrity, arithmetic invariants, and largest-remainder tie-out oracle.
- `commands/statement.rs` (native core): oracle reference for native statement generation and largest-remainder calculations.
