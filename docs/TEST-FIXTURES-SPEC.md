# TEST-FIXTURES-SPEC.md

> OneFP&A · v1.0.0 · **The deterministic fixture inventory + exact expected results (oracle) used by TESTING-STRATEGY.** Fixtures are synthetic (no real client data, B18-3); production paths never load them.

---

## 1. FIXTURE DIRECTORY & NAMING

```
tests/fixtures/
├── gl/                       # GL dump fixtures
│   ├── sap_style/*.xlsx      # 3-sheet debit/credit, 48k rows, period codes FY26-P08
│   ├── tally_style/*.csv     # long signed amount, EU locale (1.234,56), utf-16
│   ├── qbo_report/*.csv      # JournalReport export shape
│   ├── eu_locale/*.xlsx      # German locale, ";" delimiter
│   ├── duplicate/*.xlsx      # 12 duplicate (batch, source_row) rows
│   ├── tieout_fail/*.xlsx    # 1 conflicting credit (₹0.05) — exact expected diff row
│   └── multi_period/*.xlsx   # 1 workbook spanning P01–P12 (calendar split)
├── drivers/                  # operational driver data (units, headcount), weekly/monthly mismatch sample
├── coa/                      # pack COA import, duplicate code, merge-remap
├── calendar/                 # NRF 4-5-4 published years 2024–2028 expected JSON (oracle source)
├── statements/               # P&L/BS/CF/SoCE known-answer workbooks (oracle, hand-computed)
├── consolidation/            # 2-BU + 5-BU group fixtures (mixed currency/calendar, IC pairs, NCI 80%)
├── connectors/<provider>/    # recorded HTTP payloads + expected NormalizedRow JSON
├── model/                    # multi-sheet model fixture (formulas, cycles, driver chains, cross-sheet)
├── exports/                  # expected xlsx/pdf dump outputs (round-trip targets) + formula-injection samples
├── audit/                    # valid chain + tampered chain (hash mismatch) samples
├── license/                  # valid/signature-invalid/expired/machine-mismatch Ed25519 payloads
├── security/                 # wrong PIN vectors, recovery phrase valid/invalid, keychain metadata
└── packs/                    # valid pack per launch industry + schema-invalid pack (exact error path)
```

Every fixture has a **`.expected.json`** sidecar with exact expected values (amounts to the cent, row counts, error codes, durations bands listed as `max_ms`).

## 2. ORACLE CALENDAR EXPECTATIONS (fixed — property + oracle)

Rule (NRF 4-5-4): fiscal start = Sunday nearest Feb 1 (tie → after; Feb 1 Sunday → Feb 1); a year is **53 weeks iff the next fiscal-year start is 371 days later** (NRF 53-week schedule: FY12, FY17, FY23, FY28, …); the 53rd week lands in Q4 (4-5-5).

| Year (NRF 4-5-4, Sunday nearest Feb 1) | Start | Weeks | Weeks pattern |
|---|---|---|---|
| 2024 | 2024-02-04 | 52 | Q1 4-5-4 · Q2 4-5-4 · Q3 4-5-4 · Q4 4-5-4 |
| 2025 | 2025-02-02 | 52 | 4-5-4 (standard) |
| 2026 | 2026-02-01 | 52 | 4-5-4 (standard) |
| 2027 | 2027-01-31 | 52 | 4-5-4 (standard) |
| 2028 | 2028-01-30 | **53** | Q4 4-5-5 (53rd week per NRF 4-day rule) |

Also: 12-month Apr-start 2026 (P01 = Apr 1), 3-3-3-4 (13 periods), 52-53 full-week rule variant. Calendar engine must return these exact period date ranges (oracle JSON).

## 3. ORACLE STATEMENT EXPECTATIONS (hand-computed, curated)

| Fixture | Expected (to cent) |
|---|---|
| `statements/pl_basic` | Revenue 6,350,000.00 · COGS 3,970,000.00 · Gross Profit 2,380,000.00 · OpEx 1,240,000.00 · EBITDA 1,140,000.00 · Depr 250,000.00 · EBIT 890,000.00 · Tax 22% → Net 694,200.00 |
| `statements/bs_basic` | Cash 1,320,000.00 · AR 2,100,000.00 · Inv 1,150,000.00 · Fixed 4,200,000.00 · AP 1,950,000.00 · Debt 5,000,000.00 · Equity 1,820,000.00 → Assets 8,770,000.00 = Liab 6,950,000.00 + Equity 1,820,000.00 |
| `statements/cf_basic` | OCF 1,480,000.00 · ICF −640,000.00 · FCF 840,000.00 · Financing −520,000.00 → Net change 320,000.00 = BS cash delta |
| `consolidation/2bu` | Group Revenue 12,400,000.00 (BU1 6,900,000 + BU2 6,100,000 − IC 600,000) · IC eliminated 600,000.00 (net row = 0 in eliminations column) · NCI 120,000.00 on 80% BU · FX translation gain 12,300.00 → OCI |

**CI rule:** any change to these values requires a PR update of the `.expected.json` + a note in DECISIONS.md (engine behavior change).

## 4. ROUND-TRIP CONTRACTS

| Test | Contract |
|---|---|
| `dump_roundtrip` | Model Dump export → import into fresh Company → identical model values (cent-exact) |
| `backup_roundtrip` | encrypted backup → restore into empty profile → identical Company (incl. audit chain) |
| `export_hash_parity` | same input → identical PDF bytes on 3 OS; xlsx bytes identical |
| `excel_injection` | cell `=1+1` as TEXT → export shows `'=1+1` (quoted) — verified by reopening workbook |

## 5. FIXTURE OWNWERSHIP & RENEWAL

| Fixture | Owner | Renewal |
|---|---|---|
| gl/, drivers/ | Ingestion | on parser/format change |
| calendar/ | Calendar engine | on calendar change (rare) |
| statements/, consolidation/ | Statement/Consolidation engines | on GAAP/IFRS preset change |
| connectors/ | Connector owner | on provider API payload change (recorded refresh) |
| audit/, license/, security/ | Security | on crypto parameter change |
| exports/ | Export | on format change |

Fixtures are versioned by engine version; `fake-indexeddb`/sqlite in-memory used for integration tests; no fixture file > 50 MB (large 2M-row synthetic generated at test time by `scripts/gen-fixtures.py`, dev-only).

*Referenced by: TESTING-STRATEGY §1/§6, QA F-007/F-028, CI-CD stage 4.*
