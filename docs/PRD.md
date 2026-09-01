# PRD.md

> Product: OneFP&A · Version 1.0.0 · Terms per GLOSSARY.md · Stage 0 **v9** scope.
> **Tag legend:** `[MVP]` = ships complete in v1.0.0 · `[V2]` = v1.1.0, fully specified but deferred by design · `[FUTURE]` = considered, not committed.
> Every `[MVP]` feature: all 5 Screen States, all error paths, tests, and docs must exist (DEFINITION-OF-DONE.md).
>
> **Stage-0 v9 revision (2026-08-31):** the v1.0.0 MVP set is **unchanged** (still opens at
> F-001…F-038, B20). This revision absorbs the previously scrapped "FinPlan Pro" domain
> backlog **as documented V2/FUTURE entries** so the roadmap reflects the full all-in-one
> ambition without breaking the locked build scope. Those items were formerly scattered in
> FUTURE/"not building"; the ones that belong to FP&A are now V2, the ones that are accounting
> / system-of-record / execution remain FUTURE.

---

## 1. FEATURE DOMAINS

**D1 Foundation · D2 Ingestion · D3 Modeling · D4 Planning · D5 Analysis · D6 Reporting & Consolidation · D7 Governance & Platform**

---

## 2. FEATURES

### D1 — Foundation

| ID | Feature | Tag | Requirements (summary) |
|---|---|---|---|
| F-001 | Company Manager | [MVP] | Create/open/switch multiple Company Files; archive years; clone Company as Sandbox; single-instance file locking (2nd instance = read-only); file association `.fpa` (double-click opens). |
| F-002 | Chart of Accounts & Dimensions | [MVP] | Hierarchical COA per Company/BU (Account Type, Report Section); Dimensions: BU, Cost Center, Project, Product, Customer, Channel, Fund, Program + unlimited user-defined; Account codes normalized (leading zeros); versioning of COA structure. |
| F-003 | Fiscal Calendar Engine | [MVP] | Presets: 12-month (any start month), 4-5-4, 4-4-5, 5-4-4, 3-3-3-4 (13-period); 52/53-week rules (NRF + configurable year-end rule); FY start/end; week-start day; Fiscal Periods P01–P13; Fiscal Quarters; YTD/PY/PYTD/LTM; Transit Period mapping for BUs with different calendars. |
| F-004 | First-Run Wizard | [MVP] | 5 steps: Company → Industry Pack → Calendar → COA (pack-provided or import) → first Model; Plan-Only mode selectable (no Actuals); Demo Company available; < 10 min to first Budget. |
| F-005 | Industry Pack Library & Pack Builder | [MVP] | 12 launch Packs (SaaS/Tech, Manufacturing, Retail/CPG, Healthcare, Construction/Engineering, Professional Services, Nonprofit, Government, Energy/Utilities, Financial Services/Insurance, Logistics, Real Estate). Each Pack = COA template + KPI definitions + Driver Templates + Report Layouts + calendar preset. Pack Builder lets users create/edit packs (schema-validated data, never code — B15). |
| F-006 | Horizons & Model Sizing | [MVP] | Planning Horizon presets: 13-week, 1-year, 3-year, 5-year; model limits: 1M formula cells, 2M GL Lines per Company, 50 BUs per Group. |

### D2 — Ingestion (one pipeline, all sources — F-023)

| ID | Feature | Tag | Requirements (summary) |
|---|---|---|---|
| F-007 | Manual Import — GL Dump (primary) | [MVP] | XLSX/XLS/CSV/TSV/delimited/zip; encodings UTF-8/16/Latin-1 + BOM; locale numbers; wide (Debit/Credit) and long (signed Amount) layouts; multi-sheet; multi-period split; column Mapping; saved Mapping Templates; HARD/WARNING Validation Errors with per-row report; Trial Balance Tie-Out gate; commit as immutable Import Batch with file hash; rollback to previous Actuals batch. |
| F-008 | Manual Import — Excel/CSV (raw files, driver data) | [MVP] | Same pipeline for: Operational Driver Data (units, headcount, volumes, pipeline, backlog), Dimension master lists, Opening Balances, Budget bootstrap files. |
| F-009 | Connectors — QuickBooks Online, Xero, NetSuite, Sage | [MVP] | OAuth2/OAuth1 flows per provider; OS-keychain Credential Store (tokens never enter UI layer); Contract tests per provider; Sync Run → Import Batch; Rate Limit Policy per connector; graceful fallback to Manual Import; connector health UI. |
| F-010 | Source Vault & Reconciliation | [MVP] | Original imported files compressed + SHA-256 in Source File Vault; Source Reconciliation report (dump vs connector vs ERP totals) with mismatch flagging; files re-importable. |
| F-011 | Mapping Management | [MVP] | Create/edit/version Mapping Templates; column preview with sample rows; Account normalization rules (leading zeros, whitespace, case); Period code patterns (202608, FY26-P08, Aug-26, date ranges); Dimension splitting ("Department: Sales" → Dimension + Value); sign interpretation (debit/credit, already-signed, reversed). |

### D3 — Modeling

| ID | Feature | Tag | Requirements (summary) |
|---|---|---|---|
| F-012 | Multi-Sheet Model & Excel-Compatible Formulas | [MVP] | Model = named Sheets; HyperFormula engine; Excel function set + declared Analysis Functions (CAGR, MA, Trend, Seasonality Index); cross-Sheet Cell References; Named Ranges; Formula Inspection (precedents/dependents); Circular Reference detection with `#CYCLE!` path; incremental Recalculation. |
| F-013 | Driver-Based Modeling | [MVP] | Driver Tables per Sheet/period/dimension; 5–7 core Driver rule per model (enforced advisory); Driver Federation precedence (global override → BU override → Collection → imported); driver ranges from Assumption Register. |
| F-014 | Assumption Register | [MVP] | Single versioned register (name, unit, source, owner, effective periods, bounds); cells reference entries; hardcoded Assumption = Validation Error (Model Health Check). |
| F-015 | Planning Methods | [MVP] | Per planning line: Manual, Static, Driver-based, Growth %, YoY, Seasonal, Spread; method visible in grid; Period Spreading (equal / seasonal curve / custom weights / lumps); Bootstrap & Copy: Actuals→Budget, PY→Budget, Scenario→Scenario (keep values/formulas/re-drive). |
| F-016 | Headcount & Workforce Plan | [MVP] | Org units; hires/attrition; comp structure (base, bonus, benefits %, employer load); timing/ramp; Headcount → cost linkage; imported from Operational Driver Data or Input Collection. |
| F-017 | Capital, Debt & Working Capital Plan | [MVP] | Capex projects (amount, in-service date, useful life, depreciation SL/DDB/units); asset roll-forward to BS; debt schedule (draws, repayments, rate, interest to P&L/CF); Working Capital from DSO/DPO/DIO drivers; **13-Week Cash Forecast**; covenant gauges (leverage, interest cover). |
| F-018 | Production, Inventory & Backlog Plans | [MVP] | Unit plan (production, scrap, purchase prices, BOM-level cost rollup) → COGS/inventory; Backlog & Pipeline import (contract value, %, expected timing) for services/construction/software; revenue timing schedules. |
| F-019 | Revenue Recognition Schedules | [MVP] | Bookings → revenue bridge; deferred revenue; over-time vs point-in-time presets (ASC 606-style); product-level at MVP; contract-level in V2. |
| F-020 | Edit UX: Excel parity | [MVP] | Keyboard navigation (arrows, Tab/Enter, Home/End), F2 edit, fill, copy/paste/paste-special, Insert, range selection, undo/redo (100+ steps, survives saves), performance with 1M cells (virtualized grid). |

### D4 — Planning & Scenarios

| ID | Feature | Tag | Requirements (summary) |
|---|---|---|---|
| F-021 | Budget, Forecast & Rolling Forecast | [MVP] | Budget per FY (annual, committed); Forecast (updated projection); Rolling Forecast (actuals auto-roll forward + re-forecast remaining periods); hybrid Actual+Plan periods labeled; Planning Cycle Manager (kickoff → submit → review → approve → baseline; milestones; Close Checklist). |
| F-022 | Scenarios, Versions & What-If | [MVP] | Unlimited Scenarios; Scenario State Draft→Review→Approved→Locked (Locked = immutable Version + baseline freeze); Model Compare (2-way, cell-level diff); What-If overlay & waterfall; Sensitivity (tornado, one Driver at a time over register bounds); Goal Seek (invert-solve one Driver to target). |
| F-023 | Input Collection Loop | [MVP] | Export structured input Sheets (drivers per BU) → fill by contributors in Excel → re-import → merge with audit; per-contributor tracking; no multi-user feature required (works in single-user file). |

### D5 — Analysis

| ID | Feature | Tag | Requirements (summary) |
|---|---|---|---|
| F-024 | Variance Analysis & Attribution | [MVP] | Variance $ and % (Actuals vs Budget/Forecast/Commit); 3-Way View (Plan vs Commit vs Actuals); Variance Attribution (Volume/Price/Mix/FX/Efficiency where data supports); Reason Codes + narrative; Favorable/Unfavorable by account nature; drill to source rows; thresholds & Waterfall. |
| F-025 | FVA — Forecast Value Added | [MVP] | Every Forecast Version scored against Actuals: MAPE, bias, hit rate, by line/BU; FVA dashboard. |
| F-026 | Alerts | [MVP] | Threshold alerts per KPI/line (variance, data completeness, covenant gauges); in-app alert center + opt-in OS notifications; dedupe/digest. |

### D6 — Reporting & Consolidation

| ID | Feature | Tag | Requirements (summary) |
|---|---|---|---|
| F-027 | Statement Suite | [MVP] | P&L, Balance Sheet, Cash Flow (indirect), SoCE, Segment Report; GAAP/IFRS presentation presets; Period/YTD/FY/PY columns; Rounding Rule (largest-remainder) so every total sums exactly; statement tie-out to source (BS ties, CF ties to cash). |
| F-028 | Multi-Entity & Multi-Industry Group Consolidation | [MVP] | Group Company with BUs (each its own Pack/calendar/currency); Group Rollup Maps; Elimination Matrix + IC Tie-Out Check; NCI; Balance Translation (Average/Closing rates, OCI or P&L policy); Transit Period mapping; consolidated statement suite + Segment Report + audit of every group number to source. |
| F-029 | Report Builder & KPI Builder | [MVP] | Report Layouts: rows (model lines), columns (Period/YTD/FY/Variance/3-Way), filters, grouping, formats (000s, parentheses, decimal per line, locale separators); saved/versioned; KPI Builder: name, formula, unit, target, owner, source; every KPI explainable in-app. |
| F-030 | Dashboard & Board Pack | [MVP] | Dashboard: KPI cards, trends, Actual vs Plan, cash position, alerts, segment summary; Board Pack: fixed-layout statements + KPIs + variance commentary + wateralls; one-click export. |
| F-031 | Export Suite | [MVP] | Excel Export (`.xlsx`, formulas preserved where possible), PDF Export (typst, deterministic, identical 3-OS), Model Dump (full workbook, re-importable), Auditor Data-Room Export (mappings, driver registers, Audit Trail, source files, statements); export formula-injection protection (cell text starts with `=` treated as text on export unless authored as formula). |
| F-032 | Model Health Check | [MVP] | Pre-save/pre-export gate: statement tie-outs, BS ties, broken references, rounding integrity, missing driver feeds, anomalies (zero/negative/out-of-range/abrupt); results = explicit fix list; export blocked until addressed; never auto-fixes. |

### D7 — Governance, Security & Platform

| ID | Feature | Tag | Requirements (summary) |
|---|---|---|---|
| F-033 | Audit Trail | [MVP] | Immutable HMAC-chained event log: every edit, import, approval, lock, export (who/what/before-after/timestamp); per-Company chain; auditor export; no silent deletes. |
| F-034 | Security at Rest | [MVP] | AES-256-GCM Company File encryption; Argon2id PIN (verified unlock); user-held Recovery Phrase created at setup (offline, never transmitted); OS keychain Credential Store (Linux fallback with explicit warning); encrypted Backups (passphrase-protected); zero telemetry; Local Diagnostics (opt-in, no financial values). |
| F-035 | Licensing & Activation | [MVP] | Ed25519-signed offline License Keys; offline verification with defined grace period; machine-bound where policy requires; recovery path for lost keys; activation file exchange; no network dependency. |
| F-036 | Auto-Update & Releases | [MVP] | Signed per-OS updaters enabled from day one; channel (stable/beta); version + schema Migration with pre-migration Snapshot and tested rollback; release notes in-app. |
| F-037 | Backup, Restore & Retention | [MVP] | Manual + scheduled encrypted Backups; versioned with rotation policy; Restore with pre-restore Snapshot; Source File Vault retention; archive years (compress, restorable). |
| F-038 | In-App Help, Search & Accessibility | [MVP] | Global Search (Ctrl+K); F1 in-app help per screen; KPI/Driver explainers; WCAG 2.2 AA (keyboard-only workflows, focus order, contrast); locale-aware formats; multi-monitor/window-state persistence; dark/light theme. |

---

## 3. V2 — v1.1.0 (fully specified later in Phase docs, deferred by design — NOT half-built)

| ID | Feature | Tag |
|---|---|---|
| V-001 | AI Copilot (on-device, explainable-only — B17; every insight cites cells/drivers; opt-in; zero data leaves machine) | [V2] |
| V-002 | Monte Carlo simulation + probability-weighted scenarios | [V2] |
| V-003 | Contract-level revenue schedules (per contract) | [V2] |
| V-004 | Valuation/M&A module (DCF, multiples, cap table) | [V2] |
| V-005 | HRIS & CRM connectors (workday/ADP, Salesforce/HubSpot) | [V2] |
| V-006 | Watch-folder scheduled import | [V2] |
| V-007 | Direct-method Cash Flow template | [V2] |
| V-008 | Live FX rate feeds (optional) | [V2] |
| V-009 | Benchmark library (industry KPI ranges) | [V2] |
| V-010 | Board-deck PPTX export | [V2] |
| V-011 | Full i18n + RTL | [V2] |
| V-012 | API + webhooks (external BI push) | [V2] |
| V-013 | Advanced allocations (step-down, reciprocal, ABC) | [V2] |
| V-014 | Merge external Company Files into a Group | [V2] |
| V-015 | Team collaboration (roles, merge, conflict resolution) | [V2] |
| V-016 | Tax calendar & indirect-tax planning | [V2] |
| V-017 | Legal-hold / retention tooling | [V2] |
| V-018 | Scenario probability weighting + weighted expected value | [V2] (with V-002) |
| V-019 | Currency hedging / FX exposure views | [V2] |
| V-020 | Payroll-ready mapping presets | [V2] |
| V-021 | Lease accounting engine (ASC 842 / IFRS 16) | [V2] — promoted from old FUTURE; planning coverage already in F-017; contract-level lease math + roll-forward is v1.1 |
| V-022 | Tax provision engine (ASC 740 / deferred tax) | [V2] — promoted from old FUTURE; cash-tax planning only (F-017) stays MVP |
| V-023 | ESG / sustainability reporting & disclosures | [V2] — promoted from old FUTURE; compliance domain but FP&A-adjacent (non-financial drivers + reporting) |
| V-024 | Treasury & banking module: cash positioning, short-term investments, yield curve, credit risk / bonds | [V2] — promoted from old FUTURE; 13-week cash (F-017) stays MVP, market/credit analytics are v1.1 |
| V-025 | Insurance & financial-instruments reporting (fair value, impairment) | [V2] — legacy FinPlan Pro domain; scenarios/reporting reuse the v1.0 engine, valuations are v1.1 |
| V-026 | Advanced period-close management (close state machine, adjusting entries, close checklist automation) | [V2] — legacy domain; variance-driven close tracking is partial in F-021, full state machine is v1.1 |
| V-027 | Data governance suite: data catalog, quality rules, lineage, master data management | [V2] — legacy domain; source/vault + audit (F-010/F-033) stay MVP, governance analytics are v1.1 |
| V-028 | Report scheduling & distribution (scheduled export / digest / CSV-email) | [V2] — legacy domain; in-app Board Pack export (F-031) stays MVP, automation is v1.1 |
| V-029 | Plugin / extension marketplace (schema-validated, no code — B15) | [V2] — legacy domain; Pack Builder (F-005) is the v1.0 extension mechanism |

---

## 4. FUTURE (considered, not scheduled)

| ID | Feature | Tag | Note |
|---|---|---|---|
| FUT-001 | Mobile apps | [FUTURE] | Desktop requirement; revisit post-V2 |
| FUT-002 | Hosted cloud sync / SaaS multi-tenant | [FUTURE] | Contradicts local-first; only if strategy changes (DECISIONS.md) |
| FUT-003 | Accounting system of record (journals, AR/AP, payroll, reconciliation) | [FUTURE] | Separate product domain; not FP&A |
| FUT-004 | Bank feeds / cash reconciliation | [FUTURE] | Accounting domain |
| FUT-005 | Treasury trading / hedging execution (broker integration) | [FUTURE] | Execution domain; planning/analytics is V-024 |
| FUT-006 | Multi-user collaboration server (non-local-first) | [FUTURE] | Contradicts single-user local-first (B2); V2 has single-user input collection (F-023/V-015) |

---

## 5. NOT BUILDING (v1.0.0 — explicit, binding)

The following are **explicitly out of scope** and must never be added to v1.0.0 without a formal PRD revision + DECISIONS.md entry (rule B1, B6, B20):

1. **Accounting system of record** — OneFP&A imports Actuals; it does not post journals, maintain AR/AP, run payroll, or reconcile banks. (That is the ERP's job; importing its GL Dump is our job.)
2. **Multi-user real-time collaboration** — single-user local-first. Input Collection Loop (F-023) covers multi-contributor planning without a server.
3. **Hosted cloud / sync / PWA / web runtime** — desktop only (B1). Dev web preview is build tooling, not a product surface.
4. **Per-industry code or sector engines** — Industry Packs are data only (B15).
5. **Mobile apps** — FUT-001.
6. **Self-serve BI query language** — Report Builder (F-029) is bounded: layout only; all math lives in Model Cells (R9).
7. **Formula-injection-unsafe exports** — export protection is required, not optional (F-031).
8. **AI that runs on data outside the machine or is non-explainable** — B17; AI is V-001 (v1.1) and on-device.
9. **Mock/demo data in production paths** — Demo Company is separate and clearly marked (B18-3).
10. **Silent "fixed" data** — no auto-correction ever; Health Check surfaces, humans decide.
11. **Floating-point money** — I1; any financial computation in floats is a build failure.
12. **Skippable quality gates** — no `continue-on-error`, no skips in release paths (B18-7).

---

## 6. DEPENDENCIES & PRIORITY

| Domain | Depends on |
|---|---|
| D1 Foundation | — |
| D2 Ingestion | D1 (COA, Calendar) |
| D3 Modeling | D1, D2 (drivers/actuals) |
| D4 Planning | D3 |
| D5 Analysis | D3, D4 |
| D6 Reporting | D3, D4, D5 |
| D7 Governance | All |

**Build order (ROADMAP.md):** D1 → D2 → D3 → D4 → D5 → D6 → D7 hardening; quality gates green at every milestone.

---

*Referenced by: USER-STORIES.md, SCREENS-SPEC.md, API-SPEC.md, DATABASE-SCHEMA.md, ROADMAP.md, FEATURE-TRACEABILITY-MATRIX.md (Stage 3).*
