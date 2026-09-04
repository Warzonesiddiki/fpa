# USER-STORIES.md

> Product: OneFP&A · Terms per GLOSSARY.md · **Every `[MVP]` feature has ≥1 story.** Priority: P0 = release-blocking, P1 = must-have, P2 = important, P3 = nice. Persona tags: (R)avi, (P)riya, (A)lex.
> Each story lists Given/When/Then + ≥2 edge cases. Screen states and error codes are specified in SCREENS-SPEC.md and API-SPEC.md; stories reference those contracts.

---

## D1 — FOUNDATION

### US-001 · F-001 Company Manager · P0 · (P)

**Given** a fresh install of OneFP&A on macOS, **When** the user clicks "New Company", names it "Holding Group", and chooses the Financial Services Pack, **Then** a Company File (`Holding Group.fpa`) is created encrypted, the First-Run Wizard starts at step 2, and the shell title shows the Company name.

**Edge cases**
- File already exists at path → error `STORAGE_FILE_EXISTS` (HTTP-style code, see ERROR-HANDLING.md); user is offered rename or open.
- Double-clicking a second `.fpa` while another instance holds it → second instance opens read-only with banner "Opened read-only — file is in use"; no writes permitted.
- Company File on a network share/removable drive → explicit warning + offline-first notice; writes allowed with snapshot before every mutation.

### US-002 · F-001 Sandbox & Archive · P1 · (R)

**Given** Company "MfgCo" with a locked Budget for FY26, **When** the user selects "Clone as Sandbox", **Then** a fully isolated copy is created with all data, packs, and Audit Trail (chain reset per copy), and the original is untouched.

**Edge cases**
- Clone of a Company with 1M cells → progress indicator with estimated time; background operation; UI stays interactive.
- Archive of a Fiscal Year while forecasts reference it → blocked with error `ARCHIVE_IN_USE` listing referencing models; user must remove references first.

### US-003 · F-002 Chart of Accounts & Dimensions · P0 · (R)

**Given** the Manufacturing Pack COA already contains `410000`, **When** the user imports the SAP GL dump with account `4100-00` and explicitly selects remove-hyphens normalization, **Then** the text code becomes `410000` (leading zeroes would remain) and Validation resolves the existing Account. A missing Account stays HARD-blocked until the later confirmed-create flow exists; mapping never auto-creates it.

**Edge cases**
- Same account name but different code → Validation shows both candidates; unconfirmed duplicates block Commit (HARD error `MAP_ACCOUNT_AMBIGUOUS`).
- Dimension value "Sales - North" vs "Sales-North" → `trim_collapse_whitespace` collapses whitespace only; it does not remove hyphens or guess equivalence.

### US-004 · F-003 Fiscal Calendar · P0 · (P)

**Given** the Retail BU runs 4-5-4 starting Sunday nearest Feb 1, **When** the user picks the 4-5-4 preset for FY2027, **Then** P01–P12 are generated with weeks 4/5/4 per quarter, the 53rd-week rule is applied if required, and every period maps to explicit date ranges.

**Edge cases**
- Leap year in a 52/53-week calendar → internal consistency check passes; 53rd week flagged in every report with `W53` label.
- BU Transit Period where BU period spans two Group periods → mapping screen shows both options with date ranges; unconfirmed ambiguity blocks consolidation (HARD `CAL_TRANSIT_AMBIGUOUS`).

### US-005 · F-004 First-Run Wizard · P0 · (A)

**Given** a new install, **When** Alex completes the wizard choosing Plan-Only mode and SaaS Pack, **Then** within 10 minutes he has a Model with Revenue, Headcount, Opex, and Cash Sheets, SaaS KPIs, and a 3-year horizon.

**Edge cases**
- No actuals yet (Plan-Only) → variance screens show "No Actuals — projected only" state; A/P functions usable; Actuals attach later (US-009).
- Wizard abandoned mid-step → resume at same step; draft saved locally; no partial Company.

### US-006 · F-005 Industry Packs & Pack Builder · P0 · (R)

**Given** the user opened the Pack Builder, **When** they modify the Manufacturing Pack's Driver Templates (e.g., add "Scrap %") and save as version v2.1, **Then** the Pack changes apply to new Models only; existing Models flag "Pack update available" with a diff of what changes.

**Edge cases**
- Editing a Pack used by a locked Baseline → blocked edit with `PACK_IN_USE_LOCKED`; clone Pack first.
- Invalid Pack JSON/schema (e.g., KPI formula references missing cell) → schema validation fails at load with exact field path; Pack marked unloadable; app remains usable with the previous Pack version.

### US-007 · F-006 Horizons & Sizing · P1 · (A)

**Given** a 5-year LRP horizon model, **When** a driver table has 500k rows, **Then** grid virtualization keeps interaction < 100 ms/frame and Recalculation completes within 2 s on a mid-tier laptop.

**Edge cases**
- Model exceeds 1M cells → creation blocked with clear `MODEL_SIZE_LIMIT` message; split into multiple Models.
- 50-BU Group limit reached → adding BU 51 blocked with upgrade path note (V2 team/enterprise).

---

## D2 — INGESTION

### US-008 · F-007 GL Dump Import (primary) · P0 · (R) — *the flagship story*

**Given** Ravi has `SAP_GL_Aug2026.xlsx` (3 sheets, 48k lines, debit/credit columns, FY26 P08 period codes), **When** he parses it in S-030 and either selects bundled `canonical-v1` or defines and saves a custom map in S-031, **Then** Parse→Normalize→Map→Validate→Preview→Tie-Out→Commit is reachable through typed production IPC. S-031 shows the exact mapping version, HARD/WARNING counts and scope, valid row count, and at most the first 50 valid rows. A clean nonzero result continues to S-032, where Rust supplies exact totals/currency and attributable differences; the authoritative commit creates audited Import Batch `2026-08-30_001` with the file SHA-256. S-030 then reads its persistent terminal metadata and can roll it back with an audited reason. Variance refresh/navigation remains a later milestone and is not fabricated in M2-4.

**Edge cases**
- Tie-Out fails by five minor units on one attributable line → direct Commit is blocked. S-032 may submit that real line only after Ravi selects it and enters a reason; Rust reapplies the exclusion and reruns validation/Tie-Out. The browser never calculates adjusted financial totals, and the line/reason remains in immutable commit audit metadata rather than being silently dropped.
- Same source hash is committed twice → `IMPORT_BATCH_HASH_EXISTS` hard-blocks it. The immediate transaction prevents concurrent duplicates. Although the locked error text mentions confirmation, no override command exists, so S-032 exposes no fake overwrite/new-batch action.
- Rollback of a committed batch requires a 1–500-character reason, removes only that batch's GL/IC facts, retains the `rolled_back` history row, and links only to a strictly older committed batch of the same kind. A repeat returns `BATCH_ALREADY_ROLLED_BACK`; a broken-audit session is read-only.
- Parse expires before validation, Tie-Out, or Commit → exact `IMPORT_PARSE_EXPIRED` text and a return to S-030 to select/re-parse; Retry never resubmits the expired id.
- 2M-row dump → background streaming/progress/cancellation and memory < 2 GB remain the acceptance target. The current parser is synchronous/in-memory, has no progress/cancel IPC, and has no native benchmark evidence; S-030 does not simulate those controls.
- Encrypted/read-protected workbook → `IMPORT_FILE_LOCKED` with instructions (remove password / export unprotected copy); app never stores the source password.
- ZIP wrapper → visibly unavailable: the registered parser rejects it and the picker excludes it until one-workbook ZIP support is implemented.

### US-009 · F-008 Driver Data & Opening Balances Import · P0 · (A)

**Given** Alex's QBO Actuals arrive at month 4, **When** he imports `QBO_Transactions.csv` (long format, signed Amount) and then `OpeningBalances.xlsx`, **Then** Actuals attach to the existing Plan-Only Model without rebuilding drivers; Opening Balances populate BS opening; the first variance for month 5 computes against a 4-month Actual base.

**Edge cases**
- Operational driver data (units/headcount) imported with weekly periods against a monthly calendar → batch-scope HARD `UNIT_PERIOD_MISMATCH`. S-031 offers source correction/re-parse, not an invented aggregate/reject command; the dedicated driver-source UI remains M2-5.
- Opening Balances imported twice → HARD `OPENING_ALREADY_SET`; second batch rejected; manual override requires Audit Trail note.

### US-010 · F-009 Connectors · P0 · (P)

**Given** Priya connects the hospital BU to QuickBooks Online, **When** she completes the OAuth flow in the system browser, **Then** the token is stored in the OS keychain (never in the DB or logs); Sync Run pulls COA + transactions; the result commits as a normal Import Batch; connector health shows last run, rows, and rate-limit status.

**Edge cases**
- OAuth token expired → auto-refresh; if refresh fails → error `CONNECTOR_AUTH_EXPIRED` with exact re-auth UI and zero data loss (previous batches intact).
- NetSuite rate limit hit (e.g., 429) → Rate Limit Policy backs off with retry; after 3 failures the Sync Run pauses with `CONNECTOR_RATE_LIMITED` and the user can fall back to Manual Import at any time; no partial commit.

### US-011 · F-010 Source Vault & Reconciliation · P1 · (R)

**Given** a Month-end with both a GL Dump and a QBO Sync Run, **When** Source Reconciliation runs, **Then** a report shows per-account totals by source and flags the 2 accounts where they differ.

**Edge cases**
- Source files exceed vault quota → retention policy rolls off oldest compressed imports with an audited deletion; never deletes the newest.
- Mismatch flagged, user resolves by choosing a source as authoritative for those accounts → recorded in Audit Trail; statement export does not block, but mismatch banner persists until resolved.

**M2-4 boundary:** persistent `import.history` now supplies the real Company-scoped Import Batch side
of this story, including rollback lineage. Reconciliation remains M2-10. Vault payload persistence
is explicitly blocked rather than faked: `source_files` has only metadata/path fields and the current
lifecycle cannot compress source bytes into the SQLite image and atomically authenticate/reseal the
encrypted Company File. No original, plaintext sidecar, metadata-only vault row, or retention claim
is created until that storage path and its crash/rollback tests exist.

### US-012 · F-011 Mapping Management · P1 · (R)

**Given** Ravi has parsed next month's Tally dump, **When** S-031 auto-suggests its header map and he explicitly selects `month_name_mmm_yy` (`AUG26` → `2026-08`), **Then** saving exact Company/name "Tally GL" keeps the mapping id and advances the checked label to v3. Before validation, the screen shows rule examples only because `import.parse` exposes no source samples. After selection/save, the real `import.validate` response supplies HARD/WARNING evidence and the first 50 valid mapped rows; the browser never fabricates normalized source rows.

**Edge cases**
- An input outside the selected exact period patterns remains unchanged and becomes a normal Validation finding; the mapper never chooses between fuzzy interpretations.
- Mapping template used by a Commit → editing advances `vN`; the latest body replaces the materialized rows, while full old/new definitions remain immutable in the HMAC audit chain. `import_batches.mapping_version` and the Commit audit payload retain what the batch used.
- Saved template/history browsing → visibly unavailable. The locked 97-command catalog defines only `import.map.save_v1`, not a mapping list/load/history command; S-031 can select bundled canonical or use the map saved in the current working session.

---

## D3 — MODELING

### US-013 · F-012 Formulas & Multi-Sheet Model · P0 · (A)

**Given** a Model with Sheets `Revenue`, `Headcount`, `Capex`, `Cash`, **When** Alex types `=SUM(Revenue!D12:D48)` in Cell `Cash!D5`, **Then** the formula resolves cross-Sheet, Recalculation is incremental, and Formula Inspection shows both precedents and dependents for the Cell.

**Edge cases**
- Circular Reference created (`Cash!D5 = Revenue!D5 + Cash!D5`) → app shows `#CYCLE!` with the full cycle path and a one-click "show cycle"; the value is never mistaken for a number.
- Sheet renamed while referenced → all references update atomically with a change report; nothing silently breaks; broken references appear in Health Check as HARD.

### US-014 · F-013 Driver-Based Modeling · P0 · (R)

**Given** Ravi's manufacturing Model, **When** he sets Revenue Drivers (units 12,000 × price ₹860) and Opex Drivers (headcount × salary + utilization), **Then** P&L lines auto-compute; changing `units` to 10,000 cascades through P&L, Working Capital, Cash, and BS in one Recalculation.

**Edge cases**
- More than 7 core Drivers in one Model → advisory flag "driver count high" shown once, not blocking; Governance log records the dismiss.
- Driver value outside Assumption Register bounds → HARD Validation Error with bounds shown; user changes bounds first (audited).

### US-015 · F-014 Assumption Register · P0 · (R)

**Given** the register contains `wage_inflation` (4.0%, source: HR, effective FY26 P01), **When** any Model Cell references it, **Then** the Cell shows the register value; changing it to 5.0% updates every dependent Cell with a diff list.

**Edge cases**
- Cell contains a hardcoded 4% instead of the register reference → Health Check flags `HARDCODED_ASSUMPTION` with the exact Cell; user converts to reference (recommended) or logs a waiver with reason (waiver appears in Audit Trail).
- Assumption edited after Baseline Locked → edit blocked; user must create a new Scenario Version (commentary required).

### US-016 · F-015 Planning Methods & Spreading · P0 · (A)

**Given** Alex's annual revenue target of ₹12M, **When** he applies `Seasonal` spreading with the SaaS seasonality curve (Q4-heavy), **Then** monthly targets distribute with the curve; each month shows method + weight in the grid; total sums exactly to ₹12M (Rounding Rule).

**Edge cases**
- Sum of custom weights ≠ 100% → HARD `SPREAD_WEIGHTS_INVALID` with normalization offer (normalize OR fix); never silently normalizes without choice.
- Copy PY→Budget with `YoY` method where a prior-year line is missing → mapped as `Manual` with a WARNING; user confirms per line.

### US-017 · F-016 Headcount Plan · P0 · (A)

**Given** a hiring plan (3 hires: month 2, 4, 6; salaries; benefits 20%), **When** the plan runs, **Then** Headcount sheet and Opex lines compute monthly, prorated by start date, and Cash reflects payroll timing.

**Edge cases**
- Hire date in a 4-5-4 BU mid-period → proration via inclusive day-count of the Fiscal Period, exact;
  S-045 shows the active-days/period-days denominator used.
- A start date outside the loaded fiscal horizon, malformed ISO date, or termination before hire →
  `HC_DATE_INVALID` (422, non-retryable) with row details; the form remains open for correction.
- Two rows with the same role and cost center active in one fiscal period → `HC_OVERLAP` (422,
  non-retryable) with both row ids and the period; sequential attrition ending the day before the next
  start is valid.
- Termination/attrition with notice period → modeled as a separate event with effective month+1;
  never double-counted. Base compensation, bonus, benefits, and employer load remain exact decimal
  strings; no browser float totals are authoritative.

### US-018 · F-017 Capital, Debt & Working Capital · P0 · (R)

**Given** a ₹40M capex project (in-service P05, 10-year SL depreciation) and a ₹25M term loan (6.5% interest, quarterly repayments), **When** the Model recalculates, **Then** the BS asset roll-forward and debt balance match; interest hits P&L and CF; the 13-Week Cash sheet shows the loan draw and repayments.

**Edge cases**
- Depreciation start date before asset received → blocked `CAPEX_IN_SERVICE_INVALID`; asks for in-service date.
- Covenant breach (net debt/EBITDA > 3.5x) → Covenant Gauge turns red with a threshold-defined alert; no auto-fix; report note generated.

### US-019 · F-018 Production, Inventory & Backlog · P1 · (R)

**Given** a production plan (5,000 units/month, 2% scrap, ₹210 material per unit), **When** the plan runs, **Then** COGS and inventory build to the BS; scrap cost is visible as a separate line.

**Edge cases**
- Production exceeds capacity driver → HARD `PRODUCTION_CAPACITY`; capacity must be raised (audited) or plan reduced.
- Backlog (construction) with % complete → revenue recognition picks the POC method per contract; under/over-billing line computed from billings vs earned revenue.

### US-020 · F-019 Revenue Recognition · P1 · (A)

**Given** SaaSoft has bookings with 12-month subscriptions, **When** the model runs, **Then** deferred revenue builds and releases per the recognition policy; P&L recognizes revenue monthly, correctly.

**Edge cases**
- Over-time policy with an invalid estimation (total cost = 0) → `REVREC_COST_ESTIMATE_INVALID`; recognition paused for that contract with a clear fix list.
- One-time vs recurring booking misclassified → mapping prompt; classification errors produce HARD import errors, not silent math.

### US-021 · F-020 Excel-parity editing · P0 · (A)

**Given** a 200k-row grid, **When** Alex selects D5:D5000, presses Ctrl+D (fill down), then undoes, **Then** fill and undo both complete < 2 s; undo history survives Ctrl+S; keyboard navigation matches Excel expectations.

**Edge cases**
- Undo beyond 100 steps → oldest step is dropped with a one-time notice; model-level snapshot restore is offered instead.
- Paste from Excel with locale `1.234,56` → parse is locale-aware; ambiguous values show a preview dialog before commit.

---

## D4 — PLANNING

### US-022 · F-021 Budget / Forecast / Rolling · P0 · (R)

**Given** FY26 Budget Approved and P01–P04 Actuals imported, **When** Ravi starts the Rolling Forecast, **Then** P05–P12 re-forecast from drivers; periods P01–P04 show Actuals; the Model is labeled `HYBRID (Actual P01–P04, Forecast P05–P12)` in every report.

**Edge cases**
- Rolling start date mid-quarter → remaining periods forecast; quarter totals show `PY forecast` + `P05–P06 actual` components clearly.
- Forecast created with no Actuals at all → `Plan-Only` label; variance screens never show Actuals for missing periods (empty state per SCREENS-SPEC).

### US-023 · F-022 Scenarios & Versions · P0 · (A)

**Given** Base Scenario Approved (Locked → Version v2), **When** Alex duplicates it to "Upside" and changes `reps` 6→8, **Then** Upside opens as Draft with a full copy; Base stays locked; Model Compare shows a cell-level diff (`reps +2` → revenue +₹18M → EBITDA +₹6M); Goal Seek computes "reps needed for ₹300M revenue" = 9.4.

**Edge cases**
- Editing a Locked Scenario via direct grid → edit blocked with `MODEL_CELL_LOCKED`; "Create Version" offered; no silent edits.
- Goal Seek does not converge within 100 iterations → `GOAL_SEEK_NO_CONVERGE` with last value and target; never returns a non-converged number as if valid.

### US-024 · F-023 Input Collection · P1 · (R)

**Given** the Budget cycle is open, **When** Ravi exports the "Sales input sheet" and the Sales Director returns it filled, **Then** import merges values into Driver Tables by contributor; every cell change is in the Audit Trail with owner attribution.

**Edge cases**
- Contributor edits the structure (adds rows) → structural diff shown; new rows must map to Dimensions or be rejected; never silently ignored.
- Same driver filled by two people → conflict view (both values, timestamps); user picks or "average"; decision recorded.

---

## D5 — ANALYSIS

### US-025 · F-024 Variance & Attribution · P0 · (R)

**Given** P05 Actuals vs Budget, **When** Ravi opens Variance, **Then** he sees $ and % by Account with Favorable/Unfavorable coloring, and Attribution shows Revenue: Volume −₹30K, Price −₹10K, Mix −₹5K, FX −₹5K; he tags `Reason Code: Volume shortfall` with narrative.

**Edge cases**
- Attribution inputs incomplete (no unit data) → attribution columns show `not attributable` rather than a fake split; variance by $ only for those accounts.
- Favorable cost variance sign convention → always shown with a legend example (`(₹) = favorable for costs`); HTML title/aria explains it (a11y).

### US-026 · F-025 FVA · P1 · (R)

**Given** 6 monthly Forecast Versions saved over H1, **When** FVA runs, **Then** each is scored vs Actuals (MAPE, bias, hit rate) by line and BU, showing whether forecasts are improving.

**Edge cases**
- Fewer than 3 Forecast Versions for a line → empty state "Need ≥3 versions to score" (never a fake 0%). 
- Actual for a period restated later → FVA recomputes and the restatement is flagged; Versions are never mutated.

### US-027 · F-026 Alerts · P1 · (P)

**Given** a cash alert threshold (13-week cash < ₹25M), **When** the forecast crosses it, **Then** an alert appears in the Alert Center with the trigger chain (driver → model → cash); opt-in OS notification sent once (dedupe); digest every 24h max.

**Edge cases**
- Alert fires on a Locked scenario only → suppressed (alerts evaluate the current working Model, not locked history).
- 100+ alerts → grouped digest; per-alert dismiss; alert log retains 90 days.

---

## D6 — REPORTING & CONSOLIDATION

### US-028 · F-027 Statement Suite · P0 · (R)

**Given** P08 actuals, **When** Ravi opens P&L (GAAP preset, 000s), **Then** every subtotal sums exactly (Rounding Rule); BS ties (Assets = Liabilities + Equity) to the cent; CF reconciles to BS cash; a statement inconsistency blocks export with a list (never "looks fine").

**Edge cases**
- 13-period calendar in a fiscal year with 53 periods → P&L has 13 columns; W53 flagged; YoY comparison excludes W53 by default with an explicit toggle.
- GAAP/IFRS switch mid-report-view → presentation changes without touching numbers; mapping per line is validated before switch.

### US-029 · F-028 Group Consolidation · P0 · (P)

**Given** a Group with 5 BUs (different Packs/currencies/calendars), **When** Priority consolidation runs, **Then** Group Rollup Maps apply, IC Lines are eliminated (yes, with the IC Tie-Out Check), Balance Translation uses Average/Closing rates with OCI treatment, NCI is computed for the 80% BU, and Group BS ties; every group line drillable to BU → Account → GL Line.

**Edge cases**
- IC Line without a matching counterpart → HARD `IC_UNMATCHED`; consolidation blocked until resolved (pair or tag as external); no blind elimination.
- BU calendar change after consolidation (e.g., retail adds W53) → Transit Period mapping re-prompts; previously approved numbers display "stale — re-run consolidation" banner.

### US-030 · F-029 Report & KPI Builders · P1 · (R)

**Given** Ravi wants "Gross Margin by Product by Quarter [YTD, 000s]", **When** he builds the layout in Report Builder, **Then** rows/columns/filters/grouping produce the report; the KPI Builder defines `GM% = Gross Profit / Revenue` with target 38%; both save as versioned layouts/KPIs.

**Edge cases**
- Layout references a renamed Sheet → HARD validation with auto-remap offer (recorded); broken layouts never export.
- KPI divides by zero → KPI shows `n/a` + tooltip explaining; never `Infinity`; Health Check flags the driver.

### US-031 · F-030 Dashboard & Board Pack · P0 · (P)

**Given** the monthly close pack, **When** Priya opens Dashboard, **Then** KPI cards, trends, Actual vs Plan, cash position, alerts, and segment summary render from live Model data; Board Pack export (Excel+PDF) contains statements, KPIs, variance commentary, wateralls in fixed order.

**Edge cases**
- Dashboard with no Actuals (Plan-Only) → cards show Best/Worst/Base ranges instead of "blank"; every card explains its computation in the "?" panel.
- Board Pack export while Health Check fails → blocked with the exact fix list (never export plausibly wrong numbers).

### US-032 · F-031 Export Suite · P0 · (A)

**Given** Alex's investor report, **When** he exports Excel and PDF, **Then** both are deterministic and identical across OS; Excel preserves formulas where possible; Model Dump is re-importable; `=`-prefixed text cells are quoted on export (injection-safe).

**Edge cases**
- Export with 1M rows → background export with progress; PDF pagination handles 30+ pages with headers/footers; memory < 1.5 GB.
- Corrupt/unlinkable PDF font (system) → typst uses embedded fonts; fallback path tested on all three OS (never a broken PDF).

### US-033 · F-032 Model Health Check · P0 · (R)

**Given** Health Check runs before export, **When** it finds 3 broken references, 1 BS tie failure, and 1 anomaly (overnight 400% spike in fuel), **Then** export is blocked and the fix list shows each with exact Cells; user fixes or files a documented waiver (audited); anomalies are never auto-adjusted.

**Edge cases**
- Health Check on a 50-BU Group takes > 30 s → progress + partial results as checked; a stalled check never blocks the UI.
- All checks pass but the export is from a locked Version → allowed with version stamp on the file.

---

## D7 — GOVERNANCE & PLATFORM

### US-034 · F-033 Audit Trail · P0 · (P)

**Given** the group consolidation, **When** Priya opens Audit Trail, **Then** she sees every import/approval/lock/export/waiver with before/after and HMAC chain verification status; Auditor Data-Room Export produces one package with the chain + sources.

**Edge cases**
- Audit chain tamper detected (hash mismatch) → `AUDIT_CHAIN_BREAK` — app enters read-only mode for the Company; restore from last good Snapshot offered; never silent.
- 10M audit events → chain stored append-only with automatic archiving (compressed, still verifiable).

### US-035 · F-034 Security at Rest · P0 · (R)

**Given** first-run with PIN + Recovery Phrase, **When** the user reopens the app, **Then** unlock verifies the PIN against Argon2id; wrong PIN shows generic error (no user enumeration); failed attempts count with lockout + recovery path.

**Edge cases**
- Recovery Phrase lost AND PIN forgotten → recovery impossible by design; app explains the trade-off clearly at setup (this is the one non-recoverable path — documented in KNOWN-ISSUES as a design decision).
- Keychain unavailable on Linux (no Secret Service) → explicit warning + documented fallback (encrypted local file with user-created unlock passphrase); never plaintext.

### US-036 · F-035 Licensing & Activation · P0 · (P)

**Given** a licensed Company File, **When** the app starts offline for 45 days, **Then** license verifies offline (signed, machine-bound where configured) and works; at grace-period end (configurable, 60 days default), a clear activation screen appears without data loss.

**Edge cases**
- Machine change (new laptop) → activation re-request via offline activation file exchange (no network needed); success path tested; failure keeps read-only access.
- Tampered License Key (bad Ed25519 signature) → `LICENSE_INVALID_SIGNATURE`, never partial functionality.

### US-037 · F-036 Auto-Update & Migrations · P1 · (P)

**Given** v1.0.0 → v1.0.1 with schema Migration, **When** update applies, **Then** pre-migration Snapshot is taken, migration runs, forward tests pass, and the app reopens with a changelog. Failed migration rolls back automatically.

**Edge cases**
- Update interrupted mid-migration → recovery on next launch restores Snapshot; never a half-migrated Company.
- Beta channel selected → update available only from Beta, with clear channel label in About.

### US-038 · F-037 Backup & Restore · P0 · (R)

**Given** scheduled encrypted Backup (daily, keep 30), **When** Restore is chosen, **Then** a pre-restore Snapshot is taken first, restore is transactional, and the Audit Trail records the restore event.

**Edge cases**
- Backup passphrase forgotten → restore impossible (by design, warned at backup creation); a newer unencrypted-option disabled by default (configurable, default off).
- Disk full during backup → error `BACKUP_DISK_FULL` with cleanup suggestions; Company data untouched.

### US-039 · F-038 Help, Search, Accessibility · P1 · (A)

**Given** Alex sees the KPI "MBR" in the dashboard, **When** he presses F1 or hits the "?", **Then** an in-app explainer opens (definition, formula, source, target, calculation example); Ctrl+K search jumps to any Account/Driver/KPI/Report/Screen; the whole flow is keyboard-only and passes axe (WCAG 2.2 AA) checks.

**Edge cases**
- Search with no results → explicit empty state with "create/navigate" options (never silent).
- Screen reader on a chart → chart has an accessible data table alternative (toggleable) + aria label; color is never the only signal (contrast + shape + pattern).

---

## COVERAGE CHECK (Stage 3 will verify)

| Feature | Story | Edge cases |
|---|---|---|
| F-001…F-038 | US-001…US-039 | 78 listed (≥2 each) |

*Referenced by: FEATURE-TRACEABILITY-MATRIX.md (Stage 3), QA-CHECKLIST.md, TESTING-STRATEGY.md.*
