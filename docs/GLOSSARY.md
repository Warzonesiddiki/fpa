# GLOSSARY.md

> **STATUS: LOCKED (Stage 1)** — v1.0.0. This document is the single source of truth for terminology.
> Every other document (PRD, SCREENS-SPEC, API-SPEC, DATABASE-SCHEMA, CLAUDE.md, etc.) MUST use
> these exact terms. BANNED synonyms are listed per term and must never appear in code, UI, or docs.
>
> **Working product name:** OneFP&A (working title; all brand strings live in one config file, per rule B9).
> **Company File extension:** `.fpa`
>
> **Rules for authors (from Stage 0, B1–B20):** if a term is missing, add it HERE first, then use it.
> Never invent a synonym. Never reuse a BANNED word.

---

## 1. Product & Structure

| Term | Definition | Used In | Synonyms (BANNED) |
|---|---|---|---|
| OneFP&A | The application itself: a local-first desktop FP&A suite for Windows, macOS, Linux. | All docs | The app, Prototype, FPA Tool, FinPlan, Suite (only "suite" as generic noun allowed) |
| Company | The highest-level container in the app; a single legal/economic entity set owned by one user. A Company has one Group Calendar view, one Chart of Accounts structure, and can own multiple Business Units. | Screens, DB, Auth | Workspace, Tenant, Organization, Org, Portfolio |
| Company File | A `.fpa` file on disk containing one encrypted Company (schema, data, packs, audit chain). | Storage, Backup, Auth | Project file, Database file, Save file |
| Business Unit (BU) | A reporting/operating unit inside a Company that owns its own Industry Pack, calendar variant, currency, Chart of Accounts subset, and scenario drivers. One BU = one consolidation "leaf" and (if owned) one legal subsidiary. | Consolidation, Industry Packs | Entity, Division, Department, Legal Entity, Section, Segment |
| Model | The user's editable planning artifact inside a Company: a set of Sheets, Driver Tables, Assumption Register entries, Report Layouts, and Scenarios, scoped to a planning horizon. | Budgeting, Formulas, Reports | Workbook, Model file, Planning file, Spreadsheet |
| Sheet | A named tab within a Model (e.g., `Revenue`, `Headcount`, `Capex`, `Cash`). Sheets reference each other by name. | Formulas, Screens | Grid, Worksheet, Tab (banned when meaning a Sheet), Page (banned when meaning a Sheet) |
| Industry Pack | Versioned configuration data (JSON + SQL seed) that adapts the generic engine to one industry: Chart of Accounts template, KPI definitions, Driver Templates, Report Layouts, calendar preset. Packs are data, never code (rule B15). | Packs, Onboarding | Sector pack, Vertical, Industry module, Template pack |
| Pack Builder | The in-app tool that creates or edits an Industry Pack for a user's own industry. | Packs | — |
| Driver Template | A prebuilt Driver Table pattern inside a Pack (e.g., "Volume × Price", "Headcount × Salary"). | Packs, Drivers | Model template, Formula template |
| Planning Horizon | The time span of a Model: 13-week, 1-year, 3-year, or 5-year presets. | Modeling, Reports | Time range, Period range |
| Onboarding Wizard | The 5-step first-run flow: Company → Industry Pack → Calendar → Chart of Accounts → first Model. | UX, Screens | Setup wizard, Getting started |

## 2. Time & Periods

| Term | Definition | Used In | Synonyms (BANNED) |
|---|---|---|---|
| Fiscal Calendar | The configured time structure of a Company/BU: start month, period type (calendar month, 4-5-4, 4-4-5, 5-4-4, 3-3-3-4 / 13-period), week start day, 52/53-week rules. | All time logic | Accounting calendar, Retail calendar (allowed only when meaning 4-5-4 family), Fiscal year config |
| Fiscal Year (FY) | A 12-month (or 52/53-week) reporting year per the Fiscal Calendar (e.g., FY26 = Feb 2026–Jan 2027 for NRF 4-5-4). | Statements, Reports | Financial year, Tax year (banned as synonym; tax year is a different concept) |
| Fiscal Period | A single reporting month/period within a Fiscal Year (P01–P12, or P01–P13 in 13-period calendars). | Everywhere | Period, Close period, Accounting period (banned as synonyms in docs; "close period" only as a verb) |
| Fiscal Quarter | A group of three Fiscal Periods (Q1–Q4); exactly 13 weeks in week-based calendars. | Statements, Reports | Quarter (allowed only in casual UI labels, not spec) |
| YTD | Year-to-date: cumulative from FY start to the selected period. | Statements, Variance | YTD figure |
| PY | Prior Year: the same Fiscal Period one year earlier. | Statements, Variance | Last year, LY |
| PYTD | Prior Year To Date. | Statements, Variance | — |
| LTM | Last Twelve Months (trailing). | Reports, KPI | TTM, Trailing 12 months (banned as synonyms) |
| 53rd Week / 13th Period | The extra week/period added in 52-53 week calendars; must always be flagged in reports so 52-week and 53-week years are never silently compared. | Calendar, Reports | Extra week, 53rd period |
| Seasonality | Recurring within-year pattern used to spread an annual amount into periods (equal, custom curve, weights, historical). | Budgeting, Formulas | Seasonality curve (banned? — use "Seasonality"), S-curve |
| Period Spreading | The action of distributing one annual/summary value across Fiscal Periods using a method (equal/seasonal/lumps). | Budgeting | Spread, Allocation (banned as synonym; Allocation is a different term) |
| Daylight Rule | The app's rule that fiscal period boundaries are computed from the Fiscal Calendar only; wall-clock timezone/DST never changes a period boundary. | Calendar, Engine | — |

## 3. Accounts, Dimensions & Data

| Term | Definition | Used In | Synonyms (BANNED) |
|---|---|---|---|
| Chart of Accounts (COA) | The hierarchical list of Accounts used by a Company/BU, with types (Revenue, COGS, Opex, Asset, Liability, Equity) and report-section mapping. | Statements, Import | Account tree, GL structure, Account list |
| Account | A single COA node with a code and name; target of GL Lines and Budget lines. | Everywhere | GL account, Ledger account, Line item (banned when meaning Account) |
| Account Type | `Revenue`, `COGS`, `Opex`, `Asset`, `Liability`, `Equity` — drives statement placement. | Statements, Import | Category (banned as synonym) |
| Report Section | Where an Account reports: e.g., Revenue, COGS, Gross Profit, OpEx, EBITDA, Operating Income, Pre-tax, Net Income; BS: Current Assets, Non-current Assets, Current Liabilities, Non-current Liabilities, Equity; CF: Operating, Investing, Financing. | Statements, Reports | Statement line, P&L category |
| Dimension | A classification axis orthogonal to Account: Business Unit, Cost Center, Project, Product, Customer, Channel, Fund, Program, or user-defined. | Import, Reports, Variance | Attribute, Tag (banned), Category, Slice |
| Dimension Value | A single value of a Dimension (e.g., Cost Center = "Sales - North"). | Import | Member, Item, Category value |
| GL Line | A single normalized row of Actuals: Fiscal Period, Account, Dimension Values, Amount (decimal string), Source, Posting Reference, Currency, plus import metadata. | Import, DB, Statements | Transaction, Journal line, Row, Record (banned as synonyms) |
| GL Dump | Any file export of a General Ledger (GL) from any ERP/accounting system, imported via the Manual Import pipeline. The primary ingestion path; works for every ERP (rule B19). | Ingestion | Ledger export, GL file, Trial balance dump (banned; a Trial Balance is a different report) |
| Import Batch | One committed Manual Import run (GL Dump or Operational Driver file): immutable, versioned, hash-stamped, with mapping version and row count. | Ingestion, Audit | Import, Upload, Sync event |
| Mapping | The definition of how source columns/rows map to Account/Dimension/Period/Amount fields. | Ingestion | Column map, Field map, Transform |
| Mapping Template | A saved, named Mapping (e.g., "SAP GL dump", "Tally GL") reusable across imports. | Ingestion | Saved import, Import profile |
| Validation Error | A row-level problem: `HARD` blocks Commit; `WARNING` allows Commit with a logged flag. | Ingestion | Import error, Warning (banned as synonyms) |
| Trial Balance Tie-Out | The mandatory pre-Commit check: sum(debits) = sum(credits) (or equals the source-reported balance); mismatch blocks Commit. | Ingestion, Health Check | Balance check, TB check |
| Source Reconciliation | Cross-source comparison report (GL Dump vs Connector vs ERP totals) with mismatch flagging. | Ingestion, Audit | Data reconciliation |
| Source File Vault | Compressed, hash-stamped storage of original imported files inside the Company File. | Audit, Storage | Raw data store, Archive (banned as synonym) |
| Operational Driver Data | Imported non-financial data (units, headcount, volumes, pipeline, backlog, production) written to Driver Tables, not to the ledger. | Ingestion, Drivers | Operational data, Non-financial data |
| Opening Balances | Prior-year closing balances imported as the first Actuals of a Period. | Import, Statements | Prior balances, Beginning balances |

## 4. Ingestion & Connectors

| Term | Definition | Used In | Synonyms (BANNED) |
|---|---|---|---|
| Manual Import | The always-available ingestion path: file → parse → map → validate → tie-out → Commit. | Ingestion | File upload, File import |
| Connector | A live, authenticated integration with QuickBooks Online, Xero, NetSuite, or Sage that pulls Actuals/COA/Budgets through the same Ingestion pipeline. | Ingestion, Integrations | Integration, Sync |
| Connector Adapter | One Rust implementation behind the shared `IngestionAdapter` contract (auth, fetch, paginate, normalize). | Architecture | Driver (banned; Driver is a modeling term) |
| Credential Store | OS-keychain storage of OAuth tokens/API credentials (Windows Credential Manager, macOS Keychain, Linux Secret Service). Tokens never enter the UI layer. | Security, Connectors | Secret store, Vault (banned as synonyms; "Source File Vault" is specific) |
| Sync Run | One Connector pull cycle: paginated fetch → normalize → validation → Commit as an Import Batch. | Ingestion, Audit | Pull, Refresh |
| Rate Limit Policy | Per-Connector throttle/retry/backoff rules (from INTEGRATIONS.md), including exact user-facing messages on exhaustion. | Connectors, Errors | — |

## 5. Planning, Drivers & Assumptions

| Term | Definition | Used In | Synonyms (BANNED) |
|---|---|---|---|
| Budget | A committed plan for a defined Fiscal Year, built from a Planning Method; the **baseline** against which Actuals are analyzed. | Everywhere | Annual plan, Plan (banned as synonym; "Plan" is not a term), Draught |
| Forecast | An updated projection of remaining periods and beyond (rolling or fixed), built from drivers and Actuals; not a commitment. | Everywhere | Projection, Estimate (banned as synonyms; "Estimate" only in construction context for job costing) |
| Long-Range Plan (LRP) | Multi-year (3–5 year) strategic view; v1.1 module; horizon begins at 3-year preset in v1.0.0. | Reports, Roadmap | Strategic plan |
| Scenario | A distinct, user-named set of Assumptions, Drivers, and inputs under one Model (e.g., Base, Upside, Downside, Recession). Scenarios share the Model structure. | Modeling, Variance | Version (banned as synonym; Version is different), Case, What-if (banned as noun), Alternative |
| Version | An immutable snapshot of any Scenario at a point in time (created automatically on lock/export/import or manually). Diffable, auditable. | Audit, Compare | Snapshot (allowed only as verb or UI helper "take snapshot" — the canonical stored object is a Version) |
| Scenario State | One of `Draft → Review → Approved → Locked`; Locked creates a Version and forbids edits. | Workflow, Screens | Status (banned as synonym), Stage |
| Baseline | The Approved Budget Version of the current Fiscal Year; the reference for variance and Commit comparison. | Variance, Workflow | Target, Committed plan |
| Actuals | Committed financial data for occurred periods, in Versioned Import Batches (Actuals are never edited in place). | Everywhere | Live data, Actual |
| Driver | An operational input (e.g., units, price, headcount, utilization, churn) that drives financial lines through formulas. | Modeling | KPI input, Variable (banned as synonym), Assumption (banned; different term) |
| Driver Table | A structured table of Drivers by period/dimension (e.g., "New Customers × ARPU"). | Modeling, Pack | Input sheet, Driver sheet |
| Driver Federation | The engine rule: drivers pull from one source (global override, BU override, input collection, or imported Operational Driver Data) with recorded precedence. | Modeling | — |
| Assumption | An external/global rate or percentage in the Assumption Register (inflation, FX, interest, tax rate, wage inflation, fuel). Not a Driver. | Modeling, Reports | Global variable, Rate assumption |
| Assumption Register | The single versioned list of all Assumptions with name, unit, source, owner, effective periods. Cells reference entries; hardcoding an Assumption is a validation error. | Modeling, Health Check | Assumption sheet, Global inputs |
| Planning Method | One of `Manual`, `Static`, `Driver-based`, `Growth %`, `YoY`, `Seasonal`, `Spread` — declared per planning line and visible. | Budgeting | Calc type, Entry type |
| Input Collection | The Excel/CSV loop for collecting Driver inputs from non-app users (export → fill → re-import, merged with audit). | Workflow | Data collection, Survey |
| Planning Cycle | A saved planning process instance: kickoff → submit → review → approve → baseline, with milestones and a Close Checklist. | Workflow | Budget cycle, Budgeting process |
| Close Checklist | Per-period tasks required before Actuals are considered complete (all BUs imported, tie-outs pass, statements tie). | Workflow, Health Check | Month-end checklist |

## 6. Formulas & Calculation

| Term | Definition | Used In | Synonyms (BANNED) |
|---|---|---|---|
| Formula | An Excel-compatible expression in any Model Cell (HyperFormula engine, standard Excel function set + declared analysis functions). | Modeling | Calculation, Expression |
| Cell | One addressable input/computed value: `Revenue!D12` (Sheet!ColumnRow). | Modeling, Reports | Grid cell |
| Cell Reference | A reference to another Cell (same-Sheet or cross-Sheet). | Modeling | Formula reference |
| Named Range | A user-named reference (usually a Driver or Assumption) usable in Formulas. | Modeling | Named driver, Variable name |
| Precedent / Dependent | The cells a Formula reads (precedents) and the cells that read it (dependents); traceable in Formula Inspection. | Modeling, Audit | Formula trace |
| Circular Reference | A Formula loop; detected and reported as `#CYCLE!` with the cycle path — never silently evaluated. | Modeling, Errors | Loop |
| Formula Inspection | UI to trace precedents/dependents, view dependencies, and diagnose invalid references. | Modeling, Screens | Formula audit (banned; Audit Trail is separate) |
| Recalculation | Incremental recomputation of affected Cells after an edit. | Performance | Recalc, Compute (banned) |
| Analysis Function | Declared extra function set: CAGR, Moving Average, Trend, Seasonality Index (beyond Excel core). | Modeling | — |
| Tie-Out | A validation that a computed total equals its defined counterpart (e.g., BS ties, CF ties to cash, consolidated BS ties to sum of BU statements). | Health Check, Statements | Balancing (banned as synonym) |

## 7. Analysis & Variance

| Term | Definition | Used In | Synonyms (BANNED) |
|---|---|---|---|
| Variance | The difference between two Scenario Versions (normally Actuals vs Budget/Forecast), in Amount and %. | Variance, Reports | Deviation, Gap (banned; "GAP" is a doc word, not finance) |
| Favorable / Unfavorable | Direction of Variance relative to its account nature (revenue up = favorable; cost up = unfavorable). | Variance | Positive/negative (banned as synonyms) |
| Variance Attribution | Decomposition of Variance into Volume, Price, Mix, FX, and Efficiency components when data supports it. | Variance | Variance analysis (banned as synonym of Attribution; the feature name is Variance Analysis) |
| Reason Code | A user-selected explanation tag attached to a Variance (e.g., pricing, seasonality, one-time, FX, efficiency). | Variance, Commentary | Cause code, Note type |
| Waterfall | Chart showing cumulative components of a Variance (Actual vs Budget bridge). | Reports, Variance | Bridge chart |
| Sensitivity | Single-variable impact analysis (one Driver ranges over its Assumption Register bounds). | Modeling | What-if (banned as noun), Stress test (banned as synonym; stress test is a scenario set) |
| Goal Seek | Invert-solve: find the Driver value that makes a target Cell equal a target number. | Modeling | Solver (banned; "solver" implies optimization beyond goal seek) |
| FVA (Forecast Value Added) | Scoring past Forecast Versions against Actuals: MAPE, bias, hit rate. | Reports, Audit | Forecast accuracy (allowed as UI label; canonical term is FVA) |
| MAPE | Mean Absolute Percentage Error of a Forecast vs Actuals. | FVA | — |
| Commit | The Approved Budget as the authoritative reference for Commit-vs-Actual analysis. | Variance | Plan (banned synonym) |
| 3-Way View | Report layout with Plan (Budget) vs Commit (Baseline) vs Actuals columns. | Reports | — |

## 8. Statements & Reporting

| Term | Definition | Used In | Synonyms (BANNED) |
|---|---|---|---|
| Statement Suite | Automated reports: Profit & Loss (P&L), Balance Sheet (BS), Cash Flow Statement (CF, indirect), Statement of Changes in Equity (SoCE), Segment Report. | Statements | Financials, Financial statements (allowed as generic noun only) |
| P&L | Profit & Loss statement (Revenue → COGS → Gross Profit → OpEx → EBITDA → Operating Income → Pre-tax → Net Income). | Statements | Income statement (allowed as UI label), I/S |
| Balance Sheet (BS) | Assets = Liabilities + Equity, with roll-forward verification per period. | Statements | Statement of financial position (banned) |
| Cash Flow (CF) | Indirect method: Operating, Investing, Financing sections; ties to BS cash line. | Statements | Cash flow statement |
| SoCE | Statement of Changes in Equity (including group NCI row). | Statements | — |
| Segment Report | BU-level P&L by period with eliminations column (ASC 280-style), for group Companies. | Statements, Consolidation | Business segment view |
| Management View | Internal presentation, adjusted (e.g., normalizations, management EBITDA). | Statements | Adjusted view |
| Statutory View | GAAP/IFRS presentation (US GAAP vs IAS 1 presets). | Statements | Reporting view |
| Report Layout | A saved user-defined report: rows (model lines), columns (period/YTD/FY/Variance), filters, grouping, formatting (000s, parentheses, decimals). | Reports, Pack | Report template (banned; "Pack Template" is a pack component) |
| Report Builder | UI to create/edit Report Layouts (rows/cols/filter/group only; all math lives in Model Cells). | Reports | Report designer |
| KPI | A defined measure with formula, unit, target, owner, and source; built-in from Packs or user-defined in KPI Builder. | Dashboard, Reports | Metric (banned as synonym), Measure |
| KPI Builder | UI to define user KPIs. | Packs, Reports | — |
| Dashboard | The KPI overview screen: cards, trends, Actual vs Plan, cash position, alerts. | Screens | Home (banned), Overview (banned as synonym) |
| Board Pack | A fixed-layout export set (statements + KPIs + commentary + variances) for leadership, in Excel/PDF. | Reports, Export | Investor pack |
| Drill-Down | Expanding any KPI/report number to its source: Cell → Formula → Driver/Assumption → Mapping → GL Line. | Everywhere | — |
| Audit Trail | Immutable, HMAC-chained event log of all changes (who/what/when/before-after, imports, approvals, exports). | Audit, Security | Change log (allowed as UI label; canonical term is Audit Trail) |
| Auditor Data-Room Export | One-click export: mappings, driver registers, Audit Trail, source files, statements. | Audit | — |

## 9. Consolidation & Multi-Currency

| Term | Definition | Used In | Synonyms (BANNED) |
|---|---|---|---|
| Group | A Company whose Business Units consolidate into one set of statements (the parent/group view). | Consolidation | Parent, Holding (banned as synonyms) |
| Ownership % | Group's economic share of a BU; drives NCI. | Consolidation | Control % (banned; control and ownership differ) |
| NCI (Non-Controlling Interest) | Equity attributable to minority owners of a BU. | Consolidation, SoCE | Minority interest (allowed as UI label; canonical term is NCI) |
| Intercompany Line (IC Line) | A GL Line tagged with source BU and counterparty BU. | Consolidation | IC transaction |
| Elimination | The consolidation adjustment that removes IC Lines (and their balances/profit) from group statements. | Consolidation | IC elimination, Adjustment (banned as synonym) |
| Elimination Matrix | The BU×BU table of IC balances/activity used by the Elimination engine. | Consolidation | — |
| Group Rollup Map | Mapping of BU Accounts (per Pack COA) → Group Account lines. | Consolidation | Mapping table |
| Reporting Currency | The currency of a BU's/Group's statements. | Consolidation, FX | Group currency, Presentation currency |
| Balance Translation | BU reporting-currency amounts translated at Average/Closing rates; Translation Adjustment booked to OCI (or P&L per policy). | Consolidation | FX translation, Currency conversion |
| Transit Period | A BU Fiscal Period that spans a Group Period boundary (mixed calendars); mapped with explicit start/end and flagged in reports. | Consolidation, Calendar | Straddle period |
| Intercompany Tie-Out Check | Validation that every IC Line's counterpart exists with equal amount; mismatches block consolidation. | Consolidation, Health Check | — |

## 10. Quality, Health & Security

| Term | Definition | Used In | Synonyms (BANNED) |
|---|---|---|---|
| Model Health Check | Run before save/export: statement tie-outs, broken references, rounding integrity, missing driver feeds, anomaly flags. | QA, Screens | Model validation |
| Rounding Rule | Display rounding + largest-remainder allocation so every report total sums exactly at every level. | Statements, Reports | Rounding (banned as a bare noun in specs) |
| Anomaly | A flagged deviation (zero/negative out of range, abrupt change) reported by Health Check; never auto-fixed — always surfaced. | QA | Outlier (allowed in KPI context only) |
| Screen State | One of `loading / empty / error / success / populated` — every screen MUST specify all five. | UX, Testing | UI state |
| PIN | The Argon2id-hashed app-unlock password. | Security | Password (banned as synonym; Password is the string a user types, PIN is the stored mechanism) |
| Recovery Phrase | User-held offline key-restore secret created at setup; restores the encryption key if the PIN is lost. | Security | Recovery key (allowed as UI label; canonical term is Recovery Phrase) |
| Encryption Key | AES-256-GCM key protecting the Company File; derived from PIN + Recovery Phrase; never stored plaintext. | Security | Master key, Data key |
| Credential | OAuth token or API key stored in the Credential Store. | Security, Connectors | Secret |
| License Key | Ed25519-signed offline activation credential for one Company File/install. | Licensing | Activation key (allowed as UI label) |
| Activation | Offline license verification (signed payload, machine-bound where required, grace period defined). | Ops, Licensing | License check |
| Money Value | Any financial amount: represented internally as integer minor units or decimal strings; **never** IEEE-754 float across the IPC boundary (rule B18-2). | Everywhere | Amount, Currency value (allowed as UI labels; canonical type is Money Value) |
| Minor Unit | Integer representation of Money Value (e.g., cents; 2 decimals default, configurable per Currency). | DB, Engine | Cents (allowed only when currency has 2 decimals) |
| Engine | A Rust or TypeScript module with a single responsibility (Calendar, Driver, Statement, Consolidation, Variance, Export...). | Architecture | Service (banned as synonym; the app has no microservices), Module (allowed as generic) |
| IPC | Typed Tauri command boundary between Rust core and TypeScript UI. Money crosses only as string/integer. | Architecture | Bridge, Command |
| Demo Company | A bundled, clearly-marked sample Company used to learn the app; never reachable from production data paths (rule B18-3). | Onboarding | Sample data, Mock |
| Sandbox | A clone of a Company/Model for safe experimentation; isolated from the source. | Workflow | Test copy |
| Zero-Compromise Gate | The CI/QA gate set (B1–B20) that must pass before any feature is Done. | QA, CI | — |

## 11. Exports, Files & Ops

| Term | Definition | Used In | Synonyms (BANNED) |
|---|---|---|---|
| Excel Export | `.xlsx` export of a Report Layout/statement/model dump, with formulas preserved where possible. | Export | Export to Excel |
| PDF Export | Typst-rendered, deterministic PDF of a Report Layout/Board Pack, identical on all OS. | Export | Print, PDF report |
| Model Dump | Full Excel export of the entire Model (all Sheets, drivers, assumptions) — re-importable. | Export | Workbook dump |
| Backup | An encrypted, passphrase-protected `.fpa`-backup snapshot created manually or automatically (versioned, rotated). | Storage | Save point, Copy |
| Restore | Loading a Backup into a Company (with explicit pre-restore snapshot). | Storage | Recover |
| Snapshot | Automatic pre-mutation Company state saved before risky operations (imports, restores, migrations, locks). | Storage | Autosave (allowed as UI label) |
| Migration | Versioned SQL schema upgrade with forward test + pre-migration Snapshot + documented rollback. | Ops, DB | Schema update |
| Auto-Update | Signed, per-OS application updater (enabled from v1.0.0; rule R1/B18). | Ops | Updater |
| Local Diagnostics | Opt-in, local-only crash/error log the user can export for support; contains no financial values. | Ops | Crash report |
| Zero-Drift | CI rule: documented claims that are machine-checked must pass (rules B5, B8, Q8; see ZERO-COMPROMISE-RULES.md). | QA, Docs | — |

## 11b. ENGINEERING TERMS (added in ZC revision — used by the 15 supplemental specs)

| Term | Definition | Used In | Synonyms (BANNED) |
|---|---|---|---|
| Currency Scale | Number of minor-unit digits for a currency (e.g., USD/INR = 2, JPY = 0, KWD = 3); scales `amount_minor` values. | Money spec, DB | Decimals (banned), Precision (banned as synonym) |
| Rounding Mode | The exact rule applied when a computation cannot be represented exactly: `HALF_UP` (default money), `HALF_EVEN` (reserved for allocation), `TRUNCATE` (only non-money). | Money spec, Statements | Rounding (banned as bare noun) |
| Largest-Remainder Allocation | Algorithm that distributes a display-rounding residual so every subtotal sums exactly to the unrounded total. | Statements, Reports | Proportional rounding |
| Supported Function | A function in the approved Formula Engine set (Excel core + Analysis Functions); anything else fails with FORMULA_UNSUPPORTED_FUNCTION. | Formula spec | Custom function, UDF |
| Pack Definition | The versioned JSON + SQL seed that fully describes an Industry Pack (COA template, KPIs, Driver Templates, Report Layouts, calendar preset, GL Template, group rollup maps). | Packs | Pack file (allowed as UI label) |
| Canonical GL Template | The documented column layout for a General Ledger export that every Manual Import accepts directly (see GL-TEMPLATE-SPEC.md). | Ingestion, GL | GL standard, Header layout |
| Fixture | A synthetic, deterministic test input/output pair (file + expected values) used by oracle tests; never production data. | Testing | Sample data (banned as synonym) |
| Incident Tier | Severity class (Critical / High / Medium / Low) with defined SLA (see SECURITY-INCIDENT-RESPONSE.md). | Security, Ops | Priority |
| Data-Room Package | One encrypted, indexable bundle (statements, mappings, registers, Audit Trail, source files, chain) for auditors. | Audit, Export | Audit bundle |
| Recovery Point Objective (RPO) | Max acceptable data loss (backup cadence): v1.0.0 = 24h (auto-daily) for lost-file scenarios; 0 for crash (WAL). | DR | — |
| Recovery Time Objective (RTO) | Max acceptable downtime to restore: v1.0.0 target = 15 min (2 GB Company). | DR | — |
| Formula Error Value | One of `#CYCLE!`, `#REF!`, `#VALUE!`, `#DIV/0!`, `#N/A`, `#NAME?`, `#NUM!`, `#UNSUPPORTED!` — never displayed as a raw number. | Formulas, Grid | Error code (banned as synonym) |
| Hybrid Period Label | Report marker for periods mixing Actuals and Forecast (`HYBRID (Actual P01–P04, Forecast P05–P12)`); never silently mixed. | Reports, Planning | Mixed periods |

---

## 12. Locked Invariants (never violated by any document)

| # | Invariant |
|---|---|
| I1 | Money never crosses IPC or stored columns as float. |
| I2 | A Budget is one Fiscal Year, committed; a Forecast is current and rolling; they are never confused. |
| I3 | Actuals are never edited in place — only new Import Batches (or a documented re-classification with a new batch). |
| I4 | Scenario is the editable context; Version is the immutable snapshot; Locked implies a Version exists. |
| I5 | One Money Core, one Calendar Engine, one Formula Engine, one Ingestion pipeline (rules B14/B15). |
| I6 | No per-industry code (B15); Industry Packs are data. |
| I7 | Every screen has all 5 Screen States; every error has a code, message, status, and retry policy. |
| I8 | Every report total sums exactly (Rounding Rule). |
| I9 | Emptiness of a term's "Used In" column = the term must appear in at least two other documents or it is an orphan (Stage 3 audit). |
| I10 | BANNED words never appear in code identifiers, UI strings, or spec prose. |
