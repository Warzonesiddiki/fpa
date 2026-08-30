# USER-PERSONAS.md

> Product: OneFP&A · Terms per GLOSSARY.md · Three personas, one archetype each; every screen and story must serve at least one persona.

---

## PERSONA 1 — "Ravi" — FP&A Manager / Controller at a Mid-Market Manufacturer

| Attribute | Value |
|---|---|
| **Role** | FP&A Manager (reports to CFO); only finance person on the modeling side |
| **Company** | $120M revenue manufacturing company; 1 Business Unit (later 2–3); 300 employees; SAP on-prem + Excel |
| **Age / experience** | 38; 12 years finance; CPA-ish (ACCA) |
| **Device** | Windows 11 desktop (company), macOS laptop (home); 16 GB RAM; always offline when traveling |
| **Tech skill** | Advanced Excel (pivot tables, XLOOKUP, macros-lite); no code; hates broken links and the "8 workbooks" ritual |
| **Daily context** | Writes budget annually, forecasts monthly, prepares variance packs; pulls GL dumps from SAP monthly; spends 2–3 days/month consolidating 12 workbooks by hand |

**Goals**
1. Import the SAP GL dump in minutes and have Actuals that tie to the cent.
2. Build and maintain a driver-based model (units, headcount, copper price, utilization) without visual basic or macros.
3. See volume/price/mix variance decomposition for manufacturing margin, not just "total variance".
4. Produce the CFO's monthly pack (P&L, BS, CF, variance commentary) in under an hour.
5. Prove any number to an auditor in one click.

**Frustrations**
- Month-end: copy/paste between 12 workbooks; duplicate formulas drift; nobody knows which file is "final".
- Float rounding: P&L in 000s doesn't sum; he has a "manual rounding adjustment" row.
- No audit trail: "who changed Q3 sales forecast?" is unanswerable.
- Old budget vs forecast vs actuals confusion: three different files, three different names.
- Cloud tools are blocked by security policy; Excel plugins (Vena/Datarails) are also blocked for data-sovereignty reasons.

**Success with OneFP&A**
- Install → wizard → Manufacturing Pack → import SAP GL dump → Budget → monthly variance → Board Pack export: all in one app, offline, auditable.

---

## PERSONA 2 — "Priya" — CFO of a Diversified Group (Conglomerate)

| Attribute | Value |
|---|---|
| **Role** | Group CFO; leads 4-person finance team; owns group reporting to the board |
| **Company** | ₹/USD-group holding company: 5 BUs — manufacturing (EUR), retail chain (GBP), hospital (USD), SaaS (USD), asset management (USD); 2,000 employees; group revenue $450M |
| **Age / experience** | 47; 20 years; CA; has survived 3 "consolidation in Excel" disasters |
| **Device** | macOS (Admin), Windows laptop (subsidiary meetings); 32 GB RAM |
| **Tech skill** | Expert spreadsheet user; barely tolerates cloud EPM; expects finance-domain correctness over fashion |

**Goals**
1. One Group model where each BU runs with its own Industry Pack, calendar (retail BU = 4-5-4), and currency.
2. Monthly consolidation: intercompany eliminations that tie, FX translation with correct OCI treatment, NCI on the 80%-owned services BU.
3. Segment report (BU × margin lines) for board; group statements that match statutory figures.
4. See "what happens to group EBITDA if retail rolls to a 53-week year?" — calendar-aware comparison.
5. Audit-ready: each group number drillable to BU → Account → GL Line.

**Frustrations**
- Intercompany lines don't match between BU exports; her team writes fixing journals monthly.
- Entities with different fiscal calendars make "August" ambiguous; YoY comparatives are wrong.
- The last consolidation took 9 days and 6 versions of a workbook; one wrong paste changed the board's cash number (caught by luck).
- Cloud EPM quotes: $90K/yr + 6-month implementation + consultant; board said no.

**Success with OneFP&A**
- Group Company with 5 BUs; each BU picks a Pack; IC Tie-Out Check blocks flawed consolidations; Segment Report + Group CFS + SoCE(NCI) export to PDF; every number drillable.

---

## PERSONA 3 — "Alex" — Founder / Head of Finance at a Pre-Revenue SaaS Startup

| Attribute | Value |
|---|---|
| **Role** | Founder-CEO who does finance; will hire first analyst at Series A |
| **Company** | B2B SaaS, pre-revenue; 8 employees; 12 months of runway; investor reporting monthly |
| **Age / experience** | 33; product background; strong with metrics, weak with accounting |
| **Device** | MacBook Air; also Linux laptop at home |
| **Tech skill** | Spreadsheet-native; comfortable with formulas but no finance vocabulary; wants "the model to explain itself" |

**Goals**
1. Plan-only model from scratch (no Actuals yet — F-004 Plan-Only mode).
2. Driver-based revenue: number of sales reps × quota × attainment; headcount plan; runway projection.
3. Investor-friendly reports: ARR, NRR, CAC payback, burn multiple, cash runway — explained in-app (no "what does this mean?").
4. Run "what if we hire 2 more reps" and see the cash impact in seconds.
5. On day 90, attach Actuals (GL Dump from QBO) to the same model without rebuilding it.

**Frustrations**
- His Excel model works but has 40 tabs, unfindable breakdowns, and no audit; the VC asked "where does 82% gross margin come from?" — he couldn't answer quickly.
- Spreadsheet "what-if" = duplicating the whole file; changes don't propagate consistently.
- He doesn't know what MAPE, EBITDA, or OCI mean — the app must explain, not assume.
- Cash ≠ profit surprises: he plans P&L but not 13-week cash.

**Success with OneFP&A**
- Wizard (Plan-Only) → SaaS Pack → drivers (reps × quota, churn) → runway + 13-week cash → investor PDF; every KPI has an in-app explainer; when QBO Actuals arrive, they attach to the existing model.

---

## PERSONA-MATRIX (feature coverage check — Stage 3 will verify)

| Feature domain | Ravi | Priya | Alex |
|---|---|---|---|
| D1 Foundation | ✅ | ✅ | ✅ |
| D2 Ingestion (GL Dump) | ✅✅ (SAP) | ✅ (BU files) | ✅ (QBO connector) |
| D3 Modeling (formulas, drivers) | ✅✅ | ✅ | ✅✅ |
| D4 Planning (Budget/Forecast/Scenarios) | ✅✅ | ✅ | ✅✅ |
| D5 Analysis (Variance/Attribution/FVA) | ✅✅ | ✅ | ✅ |
| D6 Reporting (Statements/Consolidation) | ✅ | ✅✅ | ✅ |
| D7 Governance (Audit/Security/License) | ✅ | ✅✅ | ✅ |

Legend: ✅ primary value · ✅✅ highest-value persona for that domain.

---

*Referenced by: USER-STORIES.md (story owner tags), SCREENS-SPEC.md, QA-CHECKLIST.md, DESIGN-SYSTEM.md (contrast/typography sizing for 47-year-old CFO).*
