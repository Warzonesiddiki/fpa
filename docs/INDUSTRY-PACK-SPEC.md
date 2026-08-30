# INDUSTRY-PACK-SPEC.md

> OneFP&A · v1.0.0 · **The authoritative schema for Industry Packs (F-005).** Packs are DATA ONLY (B15) — never code. One engine, unlimited industries. Every field below is validated against `packs/schema/pack.schema.json` v1.0.0 at load (`PACK_SCHEMA_INVALID` names the exact path).

---

## 1. PACK DEFINITION (top-level JSON)

```json
{
  "schema_version": "1.0.0",
  "pack": {
    "key": "manufacturing",
    "name": "Manufacturing",
    "version": "2.1.0",
    "description": "Standard costing, production plan, capacity, WIP.",
    "logo_ref": "packs/manufacturing/logo.svg",
    "default_calendar": "calendar_12mo_apr",
    "default_currency_hint": "USD",
    "locale_hint": "en-US"
  },
  "coa_template": "coa.json",
  "kpi_definitions": "kpis.json",
  "driver_templates": "drivers.json",
  "report_layouts": "layouts.json",
  "gl_template": "gl_template.json",
  "group_rollup_maps": "rollup.json",
  "seed_sql": "seed.sql",
  "assets": { "glossary": "glossary.md", "help_topics": "help/" }
}
```

**Versioning rules:** `pack.version` semver; `schema_version` = pack schema revision (breaking → new schema_version, loader rejects older files with `PACK_SCHEMA_INVALID`); install is additive & versioned (`packs` + `pack_components` rows); a Company pins the exact version used.

## 2. `coa_template` — Chart of Accounts

```json
{
  "accounts": [
    { "code": "4000", "name": "Sales Revenue", "type": "revenue",
      "section": "Revenue", "dimensions": ["bu", "product"],
      "is_control": true },
    { "code": "4100", "name": "Direct Materials", "type": "cogs",
      "section": "COGS", "dimensions": ["cost_center", "product"] }
  ],
  "sections": { "pl": ["Revenue","COGS","Gross Profit","OpEx","EBITDA","Operating Income","Pre-tax","Net Income"] }
}
```

Rules: `code` normalized (trim + collapse spaces + left-pad zeros to pack-defined width, default 6); `type` ∈ GLOSSARY Account Type; `section` ∈ Report Section; `dimensions` reference dimension keys defined in §3; accounts are selectable/non-editable at company level after creation (COA is copy-on-create).

## 3. `kpi_definitions`

```json
{
  "kpis": [
    { "key": "gross_margin_pct", "name": "Gross Margin %", "unit": "%",
      "formula": "gross_profit / revenue", "target": { "value": 38.0, "direction": "gte" },
      "definition": "Gross Profit / Revenue; explained in-app (D-008).",
      "bands": { "good": 35.0, "watch": 25.0 } }
  ]
}
```

Rules: formulas reference **engine line keys** (not raw cells) so KPIs survive COA edits; target optional; `bands` drive Alert thresholds; every KPI carries `definition` (renderable in KPIExplainer).

## 4. `driver_templates`

```json
{
  "drivers": [
    { "key": "units_sold", "name": "Units sold", "type": "volume_x_rate",
      "unit": "units", "bounds": { "low": "0", "high": "1000000" },
      "default_method": "seasonal", "links": ["revenue_line_key"] },
    { "key": "fte_count", "name": "FTEs", "type": "headcount",
      "unit": "count", "bounds": {"low":"0","high":"5000"}, "links": ["opex_salaries"] }
  ]
}
```

`type` ∈ GLOSSARY DriverTypes (volume_x_rate, headcount, growth, seasonal, spread, ratio, manual); 5–7 core Driver advisory (B16); `links` declare which planning lines consume the driver (drives Federation + attribution).

## 5. `report_layouts`

```json
{
  "layouts": [
    { "key": "mfg_pl", "name": "Manufacturing P&L (000s)",
      "rows": ["revenue","cogs","gross_profit","opex","ebitda"],
      "columns": [{ "type": "ytd" }, { "type": "variance", "compare": "budget" }],
      "format": { "000s": true, "negative": "paren", "decimals": 0 } }
  ]
}
```

Rows are line keys; columns ∈ period/ytd/fy/variance/threeway (GLOSSARY); `format` per DESIGN-SYSTEM accounting rules.

## 6. `gl_template` — Canonical GL Template mapping (see GL-TEMPLATE-SPEC.md)

Defines the Pack's suggested source columns + a **pre-built Mapping Template** so a user's dump maps with one click; never required for Manual Import (a user can map anything).

## 7. `group_rollup_maps`

```json
{ "maps": [ { "source_acc": "4100", "group_acc": "g-cogs", "weight_pct": 100 } ],
  "default_currency": "USD" }
```

Used by Consolidation for BU→Group account mapping; empty = user maps at setup (healthy gate `GROUP_ROLLUP_INCOMPLETE`).

## 8. VALIDATION (loader, exact)

| Check | Behaviour |
|---|---|
| schema_version supported | else `PACK_SCHEMA_INVALID` (path = `pack.schema_version`) |
| unique account codes | else invalid w/ duplicates list |
| KPI formula keys exist in engine line registry | else invalid w/ key |
| Driver types valid; bounds numeric decimal | else invalid w/ path |
| Layout row keys exist | else `LAYOUT_INVALID` (pack load warns; layout unusable until fixed) |
| seed.sql applies to migrations version | else load fails; Company unaffected |
| checksum mismatch vs `packs.source_checksum` | warning + re-download suggestion (never trust partial pack) |

## 9. PACK BUILDER (S-023)

Create/edit a Pack with the same schema; save → new `version`; auto-diff summary (what changes for existing Models); Publishing = export `pack.json` + assets as a single `.fpapack` file (zip with checksum). A user-built Pack has `is_bundled=0` and never enters the update channel.

## 10. LAUNCH PACK INVENTORY (v1.0.0 — 12)

| key | Calendar preset | COA hooks | Driver highlights | KPI highlights |
|---|---|---|---|---|
| saas | 12mo | deferred revenue | reps×quota, churn, ARPU | NRR, CAC payback, burn multiple |
| manufacturing | 12mo or 4-4-5 | standard costing | units, scrap%, material price | inventory turns, OEE, cost variance |
| retail | 4-5-4 (NRF) | markdown/shrink | footfall×conversion×AOV, promo | same-store sales, GMROI |
| healthcare | 12mo | payer mix | volume, length of stay, reimbursement | cost/patient, days AR, denial rate |
| construction | 12mo | WIP accounts | contract %, costs to date, backlog | backlog, over/under billing |
| professional_services | 12mo | billable | utilization, rate, pipeline | utilization %, rev/FTE |
| nonprofit | 12mo or Jul–Jun | fund/restricted | grants, donors | program ratio |
| government | Oct–Sep | fund/encumbrance | appropriations | budget execution % |
| energy | 12mo | regulated tariff | volume, weather | tariff recovery |
| financial_services | 12mo | NII | AUM, NIM, claims | MLR, loss ratio |
| logistics | 12mo | fleet | cost/mile, fuel price, utilization | cost/mile, DSO |
| real_estate | 12mo | NOI | occupancy, rent roll | NOI, cap rate |

**Conglomerate rule:** each BU picks any pack/calendar/currency independently; group consolidation uses each BU's rollup maps (F-028).

*Referenced by: PRD F-005, SCREENS S-023, DATABASE-SCHEMA §2, TODO M0-4/M1-9.*
