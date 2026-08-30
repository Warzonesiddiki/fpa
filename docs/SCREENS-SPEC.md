# SCREENS-SPEC.md

> OneFP&A · v1.0.0 · Terms per GLOSSARY.md · **Every screen: route · purpose · UI elements · all 5 states** (loading / empty / error / success / populated). 42 screens total.
> Routes are hash-free paths in the webview router; the app shell loads `/` → unlock → App Shell.
> Screen IDs (S-001…) are referenced by USER-FLOWS.md, QA-CHECKLIST.md, FEATURE-TRACEABILITY-MATRIX.md.

---

## 1. SHELL & ONBOARDING

### S-001 Unlock | `/unlock`
**Purpose:** Verify PIN (Argon2id) and decrypt the Company File.
**Elements:** Logo, Company name, PIN input (show/hide), "Forgot? Use Recovery Phrase", failed-attempt counter, unlock button.
- **Loading:** spinner + "Decrypting Company…"
- **Empty:** n/a (fixed layout)
- **Error:** `AUTH_PIN_INVALID` — generic "Incorrect PIN" (no user enumeration); after 5 fails → 30s lockout w/ countdown; recovery link.
- **Success:** transition to App Shell.
- **Populated:** last-opened Company + recent Companies list (up to 5) with open buttons.

### S-002 First-Run Wizard | `/welcome` → `/wizard/:step`
**Purpose:** 5 steps (Company → Pack → Calendar → COA → Model) — F-004.
**Elements:** Stepper (5 steps, done/current/locked), Company name/folder picker; Pack cards w/ 12 packs + Pack Builder entry; Calendar preview (12mo/4-5-4/4-4-5/5-4-4/3-3-3-4, FY start, week start); COA review (pack-provided, import, or blank+add); Model page (Plan-Only toggle, horizon, demo data toggle; "Open Demo Company" link).
- **Loading:** wizard resumes from saved draft; spinner on pack load.
- **Empty:** no packs missing — if pack library empty (corrupt install), error state with "Redownload packs".
- **Error:** `PACK_SCHEMA_INVALID` (banner with field path; retry / use core pack); `STORAGE_INSUFFICIENT` on location check.
- **Success:** Company created, toast, navigate to S-010.
- **Populated:** editable re-layout of each step's form with values.

### S-003 Search Palette | `⌘K` overlay (route-less)
**Purpose:** F-038 global search across Accounts, Drivers, KPIs, Reports, Screens, Settings.
**Elements:** input, grouped results, keyboard navigation (↑↓ Enter Esc), "no results" panel.
- **Loading:** debounced spinner (150 ms) on query.
- **Empty:** "No matches for 'x' — see suggestions".
- **Error:** search index unavailable → retry + fallback to Settings search.
- **Success:** grouped list renders with keyboard focus.
- **Populated:** history of 5 recent results at the top of the list.

### S-004 App Shell | `/`
**Purpose:** app chrome: sidebar navigation, top bar, content outlet.
**Elements:** Sidebar (Company switcher, Dashboard, Data, Model, Plan, Analyze, Reports, Governance, Settings; collapsible), top bar (Company name, Global Search, Alerts bell, Theme, Backup indicator, Sync/Connector status), status bar (last snapshot, license, version).
- **Loading:** skeleton shell.
- **Empty:** n/a.
- **Error:** shell-level ErrorBoundary with recover/reload.
- **Success:** route renders.
- **Populated:** Company menu + badges (alerts count, pending imports).

---

## 2. FOUNDATION & DATA

### S-010 Dashboard | `/dashboard`
**Purpose:** F-030 KPI overview.
**Elements:** greeting/fiscal period chip; KPI card grid (Revenue, Gross Margin %, EBITDA, EBITDA margin, Operating Cash, Cash balance, Budget Attainment %, + pack KPIs); trend chart (Actual vs Budget 12 periods); Actual vs Plan by month chart; alerts strip; segment summary (multi-BU); Quick actions (Import, Model, Reports).
- **Loading:** skeletons for cards/charts.
- **Empty:** Plan-Only → cards show driver-based Best/Worst/Base; "Import Actuals" CTA.
- **Error:** `DASHBOARD_QUERY_FAILED` banner; retry; charts container error with fallback table.
- **Success:** all widgets render.
- **Populated:** live values; every card has "?" explainer + Drill-Down.

### S-020 Company Manager | `/companies`
**Purpose:** F-001 create/open/archive/clone Companies.
**Elements:** Company cards (name, size, last opened, license), New Company, Open, Clone as Sandbox, Archive, Delete (2-step confirm + audit).
- **Loading:** list skeleton.
- **Empty:** "No Companies yet — Create your first".
- **Error:** `STORAGE_FILE_CORRUPT` card-level error w/ "Restore from Backup" action.
- **Success:** list renders.
- **Populated:** metadata + snapshot status chips.

### S-021 Chart of Accounts | `/model/coa`
**Purpose:** F-002 COA + Dimensions management.
**Elements:** tree table (code, name, Account Type, Report Section, BU), search/filter, add/edit/merge/move, Dimension manager tabs (Cost Center, Project, Product, Customer, Channel, Fund, Program, Custom), COA import, version history.
- **Loading:** tree skeleton.
- **Empty:** "No Accounts — use Pack template or add".
- **Error:** `COA_REFERENCED` (delete blocked w/ references), `COA_DUPLICATE_CODE`.
- **Success:** tree renders.
- **Populated:** accounts + dimension chips + usage counts.

### S-023 Pack Studio | `/model/packs`
**Purpose:** F-005 Pack Builder — create/edit/version Industry Packs (COA template, KPI definitions, Driver Templates, Report Layouts, calendar preset); schema-validated data only (B15); installed pack list with update diffs.
**Elements:** pack list (version, installed, update-available diffs), editor tabs (COA / KPI / Drivers / Layouts / Calendar), schema validation panel (exact path on error), "Save as new version", "Apply to new Models" (existing Models prompt diff), import/export Pack file.
- **Loading:** pack load/validate spinner.
- **Empty:** "Create a new Pack".
- **Error:** `PACK_SCHEMA_INVALID` (field path), `PACK_IN_USE_LOCKED` (clone first).
- **Success:** saved version toast.
- **Populated:** pack components with counts + version history.

### S-022 Fiscal Calendar | `/model/calendar`
**Purpose:** F-003 calendar config + preview.
**Elements:** preset cards (12mo/4-5-4/4-4-5/5-4-4/3-3-3-4), FY start picker, week start, 53-week rule selector (NRF 4-day / full-week), preview grid (12 or 13 periods w/ date ranges), BU calendar matrix (group), Transit Period map editor.
- **Loading:** preview generation spinner.
- **Empty:** n/a (always shows a default).
- **Error:** `CAL_53WEEK_CONFLICT`, `CAL_TRANSIT_AMBIGUOUS` with mapping prompts.
- **Success:** preview + "Apply to company/BUs" (diff shown).
- **Populated:** saved calendars; BU rows show preset + status.

### S-030 Import Hub | `/import`
**Purpose:** entry to all ingestion — F-007/008/009/010/011.
**Elements:** source tabs (GL Dump / Excel/CSV / Connectors), drop zone, recent mappings, Import Batch history table (date, type, rows, status, hash, rollback), Source Reconciliation link, Source Vault link, Connector health cards.
- **Loading:** batch list skeleton; connector health spinners.
- **Empty:** no batches — onboarding hint "Start with a GL Dump".
- **Error:** batch row error states (`IMPORT_BATCH_HASH_EXISTS`, `REVOKED_SOURCE`).
- **Success:** hub renders; successful batch highlighted; toast.
- **Populated:** history + health chips + vault usage.

### S-031 Mapping Wizard | `/import/map`
**Purpose:** F-011 column/field mapping (saved templates).
**Elements:** step indicator (Parse→Normalize→Map→Validate→Preview→Tie-Out→Commit), file info, encoding/delimiter detectors, column cards (source → semantic: Account/Dimension/Period/Debit/Credit/Amount…), period pattern suggestions, Account normalization rules, preview table (first 50 rows), mapping template save/load.
- **Loading:** parse progress (streaming %, cancellable).
- **Empty:** "Drop a file to begin".
- **Error:** row-level HARD/WARNING list w/ exact rows; `FILE_UNREADABLE`, `ENCODING_UNSUPPORTED` (auto-heal Latin-1 → UTF-8 option).
- **Success:** mapping saved / batch committed.
- **Populated:** preview + suggestions + options.

### S-032 Tie-Out & Commit | `/import/commit`
**Purpose:** Trial Balance Tie-Out gate + commit (F-007).
**Elements:** debit/credit totals panel (each to cent), per-source balance, diff table, exclude-row list (logged), commit button (disabled until passes or exclusions acknowledged), batch name/hash preview.
- **Loading:** recompute spinner.
- **Empty:** no rows to commit.
- **Error:** `IMPORT_TIE_OUT_FAILED` — blocked, diff rows clickable.
- **Success:** commit complete → batch summary + "View in Variance".
- **Populated:** totals + counts + mapping version + file hash.

### S-033 Connector Manager | `/import/connectors`
**Purpose:** F-009 connect/sync/manage QuickBooks/Xero/NetSuite/Sage.
**Elements:** provider cards (connect state, health, last Sync Run, rows, rate-limit status), OAuth flow (opens system browser), credentials status (OS keychain), schedule toggle, Sync Run buttons, disconnect (audited).
- **Loading:** "Opening provider authorization…" / sync progress.
- **Empty:** no credentials — "Connect" CTAs.
- **Error:** `CONNECTOR_AUTH_EXPIRED`, `CONNECTOR_RATE_LIMITED` (retry/backoff), `CONNECTOR_NETWORK` — with "Use Manual Import instead" always available.
- **Success:** authorized state, health green.
- **Populated:** run history per connector.

### S-034 Source Reconciliation | `/import/reconcile`
**Purpose:** F-010 cross-source tie report.
**Elements:** source selector (batch A vs batch B / connector), account-level diff table, status chips (match/mismatch), "mark authoritative" action (audited), export.
- **Loading:** compare spinner.
- **Empty:** "Select two sources to compare".
- **Error:** `SRC_MISMATCH_UNRESOLVED` banner persists until resolved.
- **Success:** reconciliation report.
- **Populated:** mismatches highlighted with both values + drill.

---

## 3. MODELING

### S-040 Model Home | `/model`
**Purpose:** F-006 model tree + lifecycle.
**Elements:** Model name/horizon/status chip, Sheet tree (add/rename/reorder/sheet-type badges), Scenario switcher (dropdown + state badge), Period selector (fiscal periods), Health Check chip, last recalculated, Model Dump export.
- **Loading:** tree skeleton.
- **Empty:** "No Sheets — add Revenue, Headcount, Opex, Capex, Cash (or auto-create from Pack)".
- **Error:** `MODEL_SIZE_LIMIT`, `PACK_UPDATE_AVAILABLE`.
- **Success:** tree + summaries.
- **Populated:** sheets + counts + links.

### S-041 Sheet Grid (Budget/Forecast) | `/model/sheet/:sheetId`
**Purpose:** F-012/015/020/021 — the flagship editing surface.
**Elements:** top toolbar (undo/redo, fill, find, formula bar, formatting, sheet tabs, freeze), AG Grid (virtualized): period columns P01…P13 + YTD/FY columns, line rows with Planning Method chip (Manual/Static/Driver/Growth/YoY/Seasonal/Spread), Driver badges, Formula inspection toggle, cell editor (number/date/formula), copy/paste/paste-special, comments/annotations per cell, Drift-to-source drill.
- **Loading:** grid with skeleton rows (or cached).
- **Empty:** "No lines — add from Pack template or + Add line".
- **Error:** `SCENARIO_LOCKED` (edit blocked, create version), `FORMULA_CYCLE` (red cell, path), `REFERENCE_BROKEN` (click → repair).
- **Success:** grid renders w/ values.
- **Populated:** computed values (+ formula icons on derived cells), subtotals exact (Rounding Rule).

### S-042 Formula Inspection | `/model/inspect`
**Purpose:** F-012 precedents/dependents/cycles.
**Elements:** highlight-on-grid precedents/dependents, dependency list (cell → sources), cycle path panel, fix suggestions (change ref / change method), expression view.
- **Loading:** trace spinner.
- **Empty:** "Select a Cell with a Formula".
- **Error:** `FORMULA_OUT_OF_SCOPE` — cross-Model references forbidden.
- **Success:** trace highlights.
- **Populated:** traces + counts.

### S-043 Driver Tables | `/model/drivers`
**Purpose:** F-013/019 driver definition & values.
**Elements:** driver table (name, type: volume×rate/headcount/growth/seasonal/spread/ratio, unit, source: Global/BU/Collection/Imported, period values, bounds from Registers), driver → lines impact list, core-driver count indicator (≤7 advisory), add/edit/import.
- **Loading:** skeleton.
- **Empty:** "Create your first Driver — e.g., Units, Price".
- **Error:** `DRIVER_OUT_OF_BOUNDS`, `DRIVER_FEED_MISSING`.
- **Success:** values render.
- **Populated:** table + impact + badges.

### S-044 Assumption Register | `/model/assumptions`
**Purpose:** F-014 single versioned register.
**Elements:** table (name, unit, value, source, owner, effective periods, bounds, last change), "find usages" (cells referencing), add/edit w/ required metadata, version history, validation (hardcoded-value scan).
- **Loading:** skeleton.
- **Empty:** "Add assumptions (e.g., wage_inflation 4%)".
- **Error:** `ASSUMPTION_IN_USE_LOCKED` (edit blocked on locked Scenario).
- **Success:** register renders.
- **Populated:** rows + usage counts + status.

### S-045 Headcount Plan | `/model/headcount`
**Purpose:** F-016 workforce plan (org, hires/attrition, comp).
**Elements:** org structure tree, hire/termination schedule table (role, cost center, start, comp, benefits %, load), cost rollup preview by period, proration display, import from driver data.
- **Loading:** skeleton.
- **Empty:** "Add roles or import headcount".
- **Error:** `HC_DATE_INVALID`, `HC_OVERLAP` (same role/period).
- **Success:** plan renders.
- **Populated:** totals + monthly cost.

### S-046 Capital, Debt & Working Capital | `/model/capital`
**Purpose:** F-017 capex/depreciation/debt/13-week cash.
**Elements:** tabs (Capital Projects / Debt Schedule / Working Capital Drivers / 13-Week Cash / Covenant Gauges); project table (amount, in-service, life, method SL/DDB/units, depreciation preview); debt table (facility, rate, draws, repayments, interest calc, balances); WC drivers (DSO/DPO/DIO); cash sheet (13 weeks, opening, inflows/outflows, financing, closing); covenant gauges (net debt/EBITDA ≤ 3.5x, interest cover ≥ 2.5x).
- **Loading:** roll-forward computation spinner.
- **Empty:** "Add a Capital Project or Debt Facility".
- **Error:** `CAPEX_IN_SERVICE_INVALID`, `COVENANT_BREACH` (gauge red + alert), `DEBT_SCHEDULE_OVERDRAWN`.
- **Success:** schedules render.
- **Populated:** balances + cash + gauges.

### S-047 Production & Backlog | `/model/production`
**Purpose:** F-018 production/inventory plan + backlog/pipeline.
**Elements:** production plan table (product, units, scrap %, material cost, BOM lines), inventory build (units, value → BS), backlog/pipeline table (contract/customer, value, % complete, expected timing, POC method), recognition preview.
- **Loading:** skeleton.
- **Empty:** "No production plan".
- **Error:** `PRODUCTION_CAPACITY`, `POC_ESTIMATE_INVALID`.
- **Success:** renders.
- **Populated:** COGS/inventory/recognition lines.

### S-048 Revenue Recognition | `/model/revrec`
**Purpose:** F-019 bookings→revenue bridge.
**Elements:** bookings table, policy select (over-time/point-in-time), recognition schedule by period, deferred revenue balance vs BS, contract tracking (product-level).
- **Loading:** bridge computation.
- **Empty:** "No bookings".
- **Error:** `REVREC_COST_ESTIMATE_INVALID`, `REVREC_POLICY_MIX` (warning).
- **Success:** bridge renders.
- **Populated:** recognized/deferred values.

---

## 4. PLANNING & ANALYSIS

### S-050 Scenario Manager | `/plan/scenarios`
**Purpose:** F-022 scenario lifecycle.
**Elements:** scenario cards/table (name, type, state Draft/Review/Approved/Locked, base-of, created), actions (New, Duplicate, Approve, Lock, Compare), baseline marker, BU override list (groups), probability pointer (v1.1).
- **Loading:** skeleton.
- **Empty:** "Create Base scenario".
- **Error:** `SCENARIO_NAME_DUP`, `SCENARIO_LOCK_CONFLICT`.
- **Success:** list renders.
- **Populated:** states + versions + counts.

### S-051 Model Compare | `/plan/compare`
**Purpose:** F-022 two-way cell diff.
**Elements:** A/B selectors + Version selectors, diff table (line, period, A, B, Δ, Δ%), grouped by driver change, filters (only-changed), export, "apply A to B" (audited).
- **Loading:** diff spinner (virtualized).
- **Empty:** "Select two Scenarios/Versions".
- **Error:** `COMPARE_INCOMPATIBLE` (different COA/horizon).
- **Success:** diff renders.
- **Populated:** changed cells highlighted.

### S-052 What-If & Sensitivity | `/plan/whatif`
**Purpose:** F-022 overlay/waterfall + Sensitivity (tornado) + Goal Seek.
**Elements:** scenario overlay chart (2–3 scenarios by period), waterfall (Baseline→Scenario), sensitivity panel (driver → ±range, tornado bars), Goal Seek panel (target cell, target value, driver to solve, iterations, result).
- **Loading:** compute spinner.
- **Empty:** "Choose a driver to vary".
- **Error:** `GOAL_SEEK_NO_CONVERGE` with last value; `SENSITIVITY_OUT_OF_BOUNDS`.
- **Success:** charts + goal result.
- **Populated:** results + export.

### S-053 Planning Cycle | `/plan/cycle`
**Purpose:** F-021 cycle manager + Input Collection.
**Elements:** cycle timeline (kickoff/submit/review/approve/baseline with dates), status board, Close Checklist (per-period tasks), Input Collection tab (export sheet buttons, returned collections, per-contributor status, conflict queue), milestone approvals.
- **Loading:** skeleton.
- **Empty:** "Start a planning cycle".
- **Error:** `CYCLE_TASK_BLOCKED`, `COLLECTION_CONFLICT` (queue).
- **Success:** timeline + checklist.
- **Populated:** tasks, contributors, statuses.

### S-054 Variance & Attribution | `/analyze/variance`
**Purpose:** F-024 variance + attribution + reason codes.
**Elements:** period/Business Unit/accounts filters, variance table (Actual vs Budget/Forecast/Commit, $, %, F/U badges), 3-Way View columns toggle, Attribution columns (Volume/Price/Mix/FX/Efficiency), Reason Code picker + narrative notes, waterfall chart, drill-to-source, thresholds.
- **Loading:** skeleton.
- **Empty:** "No Actuals yet" (Plan-Only state) / "Nothing to compare".
- **Error:** `VARIANCE_SOURCE_MIXED` (currency/calendar mismatch), `VARIANCE_NO_ATTRIBUTION_DATA` (columns show not attributable).
- **Success:** table + chart.
- **Populated:** values + notes + tags.

### S-055 FVA | `/analyze/fva`
**Purpose:** F-025 forecast-versus-actual scoring.
**Elements:** version selector set, score cards (MAPE, bias, hit rate), by-line table, trend chart (improving?), export.
- **Loading:** compute.
- **Empty:** "Need ≥3 Forecast Versions to score a line".
- **Error:** `FVA_RESTATEMENT_FLAG`.
- **Success:** scores render.
- **Populated:** per-line + per-BU scores.

### S-056 Alerts Center | `/analyze/alerts`
**Purpose:** F-026 threshold alerts.
**Elements:** alert list (type, trigger chain, time, dismiss), filters, alert rule manager (create threshold per KPI/line/covenant), digest settings, 90-day log.
- **Loading:** skeleton.
- **Empty:** "All clear".
- **Error:** `ALERT_RULE_INVALID`.
- **Success:** list.
- **Populated:** grouped alerts w/ drill.

---

## 5. REPORTING & GOVERNANCE

### S-060 Statements | `/reports/statements/:type` (P&L, BS, CF, SoCE, Segment)
**Purpose:** F-027 statement suite; **type** ∈ `pl|bs|cf|soce|segment`.
**Elements:** statement tabs; period column selector (single/YTD/FY/PY), presentation preset (GAAP/IFRS), BU/Group scope, 000s toggle, decimals per line, sign style (parentheses), export buttons, tie-out status chip, rounding integrity chip, drill-down on every line to source.
- **Loading:** skeleton + recompute.
- **Empty:** "No data for period" (also Plan-Only notice).
- **Error:** `STATEMENT_TIE_OUT_FAILED` (export blocked, fix list).
- **Success:** statement renders.
- **Populated:** exact totals + footnotes.

### S-061 Segment Report | `/reports/segment`
**Purpose:** F-028 ASC 280-style BU × lines.
**Elements:** BU columns (own currency + translated), eliminations column, group total, period selector, drill to BU statement, export.
- **Loading:** consolidation spinner.
- **Empty:** "No BUs in Group".
- **Error:** `SEGMENT_TRANSLATION_PENDING`, `IC_UNMATCHED`.
- **Success:** renders.
- **Populated:** BU + eliminations + group.

### S-062 Report Builder | `/reports/builder`
**Purpose:** F-029 custom Report Layouts.
**Elements:** layout canvas (rows from model lines/tree; columns Period/YTD/FY/Variance/3-Way), filters (BU/Dimension), grouping, format controls (000s, decimals, parentheses, locale), save/version, preview, export.
- **Loading:** preview compute.
- **Empty:** "New blank layout".
- **Error:** `LAYOUT_REFERENCE_BROKEN` (auto-remap offer), `LAYOUT_INVALID`.
- **Success:** preview renders.
- **Populated:** saved layouts list.

### S-063 KPI Builder | `/reports/kpis`
**Purpose:** F-029 user KPIs.
**Elements:** KPI table (name, formula, unit, target, owner), formula editor (model cells + functions), validation, explainer preview, dashboard pinning.
- **Loading:** skeleton.
- **Empty:** "No custom KPIs".
- **Error:** `KPI_FORMULA_INVALID`, `KPI_DIV_ZERO` (n/a handling).
- **Success:** renders.
- **Populated:** list + usage.

### S-064 Board Pack | `/reports/boardpack`
**Purpose:** F-030 fixed-layout pack.
**Elements:** pack template list (Monthly, Quarterly, Investor), section order (Cover, KPIs, P&L, BS, CF, Segment, Variance w/ commentary, Waterfalls, Notes), source selectors, generation preview, export Excel/PDF.
- **Loading:** generation progress.
- **Empty:** "Create a Board Pack template".
- **Error:** `HEALTH_CHECK_BLOCKED` (export blocked w/ list); `PACK_NO_COMMENTARY`.
- **Success:** preview.
- **Populated:** sections + commentary.

### S-070 Audit Trail | `/governance/audit`
**Purpose:** F-033 HMAC-chained log.
**Elements:** event table (timestamp, actor, action, object, before/after), filters, chain verification status badge, Auditor Data-Room Export, export log, per-event drill.
- **Loading:** skeleton.
- **Empty:** "No events yet".
- **Error:** `AUDIT_CHAIN_BREAK` — read-only mode + restore offer.
- **Success:** renders.
- **Populated:** events + verified badge.

### S-071 Health Check | `/governance/health`
**Purpose:** F-032 pre-export gate.
**Elements:** check categories (tie-outs, refs, rounding, driver feeds, anomalies), per-check status, fix list (clickable cells), waiver button (requires reason), run now, history.
- **Loading:** running progress (partial results stream).
- **Empty:** "No issues".
- **Error:** findings; waivers logged, never silent.
- **Success:** all green.
- **Populated:** full report.

### S-072 Security (PIN/Recovery) | `/governance/security`
**Purpose:** F-034 PIN/Recovery Phrase/keychain.
**Elements:** PIN change (~old PIN), Recovery Phrase display (one-time reveal w/ copy, never stored by app after setup), keychain status per OS, encryption status, failed-attempt log.
- **Loading:** spinner.
- **Empty:** n/a.
- **Error:** `PIN_POLICY_WEAK`, `KEYCHAIN_UNAVAILABLE` (Linux warning + fallback setup).
- **Success:** settings render.
- **Populated:** status rows.

### S-073 License & Activation | `/governance/license`
**Purpose:** F-035 offline Ed25519 activation.
**Elements:** license status (valid/grace/expired), machine fingerprint, activation via load of a license file or manual code entry, request file generator, grace countdown, About/version.
- **Loading:** verify spinner.
- **Empty:** "Not activated".
- **Error:** `LICENSE_INVALID_SIGNATURE`, `LICENSE_EXPIRED` — read-only access only.
- **Success:** activated badge.
- **Populated:** terms + history.

### S-074 Backup & Restore | `/governance/backup`
**Purpose:** F-037 encrypted backups/restore/retention.
**Elements:** backup list (auto/manual, size, encrypted, rotation), "Backup now", restore (pre-restore snapshot note), retention config, disk usage bar, archive manager.
- **Loading:** list skeleton.
- **Empty:** "No backups".
- **Error:** `BACKUP_DISK_FULL`, `BACKUP_PASSPHRASE_INVALID`.
- **Success:** renders.
- **Populated:** backups + rotation.

### S-075 Settings | `/settings`
**Purpose:** app/account/UI preferences (F-038, F-001).
**Elements:** Appearance (theme), Language (v1.0.0: English UI; locale-aware formats), Currency defaults, formatting (parentheses, 000s, decimals), keyboard shortcuts, Auto-update channel, Local Diagnostics export, storage location.
- **Loading:** skeleton.
- **Empty:** n/a.
- **Error:** `SETTINGS_SAVE_FAILED`.
- **Success:** rendered.
- **Populated:** values.

### S-076 Help & Explainers | `/help/:topic` (+ F1 overlays)
**Purpose:** F-038 in-app help; KPI/driver explainers; keyboard shortcuts; glossary (mirror GLOSSARY.md).
**Elements:** topic list, search, explainer cards (definition, formula, example), shortcuts table, keyboard-only navigation.
- **Loading:** skeleton.
- **Empty:** "No help topics yet".
- **Error:** `HELP_TOPIC_MISSING` → search suggestion.
- **Success:** renders.
- **Populated:** topics.

---

## 6. DIALOGS (modal overlay — states apply to their content)

| ID | Dialog | Purpose | Trigger |
|---|---|---|---|
| D-001 | Import wizard (full-screen modal) | S-031–S-032 | Import Hub |
| D-002 | Cell editor | Grid edit (number/date/formula/comment) | Grid |
| D-003 | Export dialog (format, scope, options, progress) | F-031 | Any export button |
| D-004 | Confirm dangerous (delete/archive/restore/reclassify) | 2-step + reason | Various |
| D-005 | Brand/onboarding first-run | F-004 | First launch |
| D-006 | License request/response | F-035 | License screen |
| D-007 | Recovery Phrase setup/verify | F-034 | First run / recovery |
| D-008 | KPI/explainer | Help, dashboard "?" | Any KPI |
| D-009 | Update available | F-036 | Auto-update |
| D-010 | Audit waive | F-032/033 | Health Check |

*Referenced by: USER-FLOWS.md, COMPONENT-LIBRARY.md, FEATURE-TRACEABILITY-MATRIX.md.*
