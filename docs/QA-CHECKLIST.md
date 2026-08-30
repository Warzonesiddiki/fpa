# QA-CHECKLIST.md

> OneFP&A · v1.0.0 · **Per-feature checklist with ≥8 checkable items per feature.** A feature is NOT Done until every box for it is checked AND the group gates (§12) pass.
> Every item is CI-checkable or has a named manual test (M#). Stage 3 maps features → stories → screens → commands → tests.

---

## 1. BASE CHECKLIST (applies to EVERY feature — 8 items)

| # | Check |
|---|---|
| B1 | 5 Screen States covered (loading/empty/error/success/populated) per SCREENS-SPEC |
| B2 | Every error path returns a code from ERROR-HANDLING.md (+ userMessage, retry flag) |
| B3 | All money paths use Money Value (no float; `npm run money:ast` gate) |
| B4 | Accessibility: axe 0 violations; keyboard-only operation; no color-only |
| B5 | Unit + integration tests added, coverage targets met (≥85% TS, ≥95% engines) |
| B6 | Stats/UX: responds within PERFORMANCE-REQUIREMENTS budget for the feature |
| B7 | Audit Trail event written for every mutation |
| B8 | Docs synced: GLOSSARY terms, PRD/API-SPEC/ERROR-HANDLING updated; DOCS-INDEX passes |

## 2. FEATURE-SPECIFIC CHECKLISTS (≥8 items each)

| Feature | Specific items (8 each — beyond B1–B8) |
|---|---|
| **F-001 Company Manager** | 1 Create/open/switch 3 companies · 2 Clone Sandbox isolation (edit original unaffected) · 3 Archive year w/ reference block · 4 Delete requires reason + 2-step · 5 `.fpa` double-click opens correct Company · 6 Second instance = read-only banner · 7 Company File on network share warns + snapshots · 8 Reopen restores last Company + window state |
| **F-002 COA & Dimensions** | 1 Pack COA imports correct types/sections · 2 Account code normalization (leading zeros, spacing) · 3 Merge accounts remaps references + audit · 4 Dimension tree add/edit/move · 5 Account-level required dimensions · 6 Duplicate code blocked (COA_DUPLICATE_CODE) · 7 COA version history visible · 8 Cross-BU shared vs private accounts |
| **F-003 Calendar** | 1 12-month any-start · 2 4-5-4 preset weeks 4/5/4 per quarter · 3 4-4-5 + 5-4-4 + 3-3-3-4 · 4 53rd-week rule both variants (fixtures) · 5 Leap-year + boundary dates exact · 6 Transit Period mapping partial % · 7 YTD/PY/PYTD/LTM computed correctly · 8 Calendar change warns + diff preview |
| **F-004 First-Run Wizard** | 1 Resume after crash at any step · 2 5 steps ≤ 10 min to Budget · 3 Plan-Only path works w/o Actuals · 4 Pack corruption → core pack fallback · 5 Folder-unwritable error path · 6 Demo Company opens marked clearly · 7 Draft persistence no partial Company · 8 Wizard completion → toast + audit |
| **F-005 Packs & Pack Builder** | 1 12 bundled packs load (schema-validated) · 2 Pack Builder creates/edits + version bump · 3 Invalid pack rejected w/ field path · 4 Pack update diff shown, models unaffected · 5 KPI/Driver/Report seeds present · 6 Pack used by locked model blocked · 7 Pack builder output re-importable · 8 No per-industry code (B15 scan) |
| **F-006 Horizons/Sizing** | 1 13w/1y/3y/5y horizon correct period counts · 2 1M cell limit blocked w/ message · 3 50-BU group limit enforced · 4 Mid-tier laptop recalc < 2s (1M cells) · 5 Grid interactive during 2M-row import · 6 Horizon change cascades sheets · 7 13-week horizon cash sheet works · 8 Limits documented + settings |
| **F-007 GL Dump Import** | 1 XLSX/XLS/CSV/TSV/zip parse · 2 Encodings + locale numbers · 3 Wide + long layouts · 4 Multi-sheet + multi-period split · 5 Mapping template saves/versions · 6 HARD/WARNING per-row report · 7 Tie-out to cent + exclude w/ log · 8 Rollback to previous batch (audited) |
| **F-008 Excel/CSV + Driver Data** | 1 Driver data imports to driver tables · 2 Dimension master import auto-creates · 3 Opening balances once-guarded · 4 Weekly→monthly aggregation choice · 5 Budget bootstrap file maps · 6 Locale decimal conflict preview · 7 Headcount/volume data types validated · 8 Import history filterable |
| **F-009 Connectors** | 1 OAuth completes/stores in keychain only · 2 Refresh works · 3 429 backoff + pause + manual fallback · 4 Partial commits impossible · 5 Health card accurate · 6 Disconnect audited · 7 Empty/malformed payloads rejected · 8 Contract tests per provider pass |
| **F-010 Vault & Reconciliation** | 1 Originals stored compressed + hash · 2 Cross-source diff report · 3 Mismatch persisted until resolved · 4 Rollback retains vault files · 5 Retention policy rolls oldest (audited) · 6 Re-import from vault works · 7 Quota enforcement · 8 Vault encrypted with Company |
| **F-011 Mapping Management** | 1 Column→semantic mapping incl. dims · 2 Period pattern suggestions confirmed · 3 Account normalization rules apply · 4 Sign interpretation 3 ways · 5 Template immutability per batch · 6 Preview rows before commit · 7 Ambiguity → explicit choice · 8 Mapping versions diffable |
| **F-012 Formulas & Multi-Sheet** | 1 Cross-sheet refs resolve · 2 Named ranges usable · 3 Analysis functions (CAGR/MA/Trend/season) · 4 Cycle → `#CYCLE!` + path · 5 Precedent/dependent trace · 6 Sheet rename updates refs atomically · 7 Recalc incremental (dirty-only) · 8 Excel-paste parses (incl. locale) |
| **F-013 Driver Modeling** | 1 volume×rate / headcount / growth / seasonal / spread / ratio types · 2 ≤7 core advisory + log · 3 Federation precedence (global→BU→collection→imported) · 4 Driver change cascades P&L/BS/CF · 5 Bounds enforced · 6 Driver feed missing → explicit · 7 Impact list per driver · 8 Driver values in audit |
| **F-014 Assumption Register** | 1 Versioned register w/ metadata · 2 Cells reference (no hardcode) · 3 Hardcode detection→convert/waive · 4 Locked-baseline edit blocked · 5 Bounds shown in UI · 6 Effective periods honored · 7 Usage list · 8 Change diff before apply |
| **F-015 Methods & Spreading** | 1 All 7 methods render + compute · 2 Seasonal weights ≠100% blocked · 3 Bootstrap copy (values/formulas/re-drive) · 4 PY→Budget YoY · 5 Actuals→budget copy · 6 Spreading traceable per period · 7 Method chip visible · 8 Copy flows audited |
| **F-016 Headcount** | 1 Hires/attrition/comp/benefits · 2 Proration exact in 4-5-4 BU · 3 Overlap dates blocked · 4 HC→Opex link · 5 Import or collection feed · 6 Termination notice handling · 7 Ramp curves · 8 Org tree edits |
| **F-017 Capital/Debt/WC/13w** | 1 Capex in-service validation · 2 SL/DDB/units depreciation exact · 3 Asset roll-forward ties BS · 4 Debt schedule + interest exact · 5 WC from DSO/DPO/DIO · 6 13-week cash ties to CF · 7 Covenant gauge threshold → alert · 8 Overdraft blocked |
| **F-018 Production/Backlog** | 1 Unit plan→COGS/inventory · 2 Scrap line visible · 3 Capacity guard · 4 Backlog % complete · 5 POC method scheduling · 6 Over/under-billing line · 7 Recognition preview · 8 BOM-level cost rollup |
| **F-019 RevRec** | 1 Bookings→revenue bridge · 2 Deferred revenue ties BS · 3 Over-time vs point-in-time · 4 Zero-cost estimate guarded · 5 One-time classification prompts · 6 Product-level granularity · 7 Contract-level = V2 (not MVP) · 8 Early termination scenario |
| **F-020 Excel-parity editing** | 1 Keys (F2/Tab/arrows/Home/End) · 2 Fill (down/right) · 3 Copy/paste/paste-special · 4 Range selection · 5 Undo/redo 100+ survives save · 6 1M-cell performance < 200ms edits · 7 Locale paste preview · 8 Lock boundary clears undo |
| **F-021 Budget/Forecast/Rolling** | 1 Budget per FY committed · 2 Forecast update path · 3 Rolling: actuals roll forward, hybrid label · 4 Cycle manager milestones · 5 Close checklist blocks variance if incomplete · 6 Baseline set on approve · 7 Multi-year horizon · 8 Forecast versioning |
| **F-022 Scenarios/Version/What-if** | 1 Duplicate→full copy · 2 Locked→Version + freeze · 3 Compare 2-way cell diff · 4 Waterfall + overlay · 5 Sensitivity tornado from bounds · 6 Goal Seek converge + no-converge path · 7 States audited · 8 Export diff |
| **F-023 Input Collection** | 1 Export input sheet structure · 2 Re-import merge + attribution · 3 Structural diff surfaced · 4 Conflict queue + resolution recorded · 5 Per-contributor status · 6 Template versioning · 7 No multi-user (single file) · 8 Cycle integration |
| **F-024 Variance/Attribution** | 1 $/% + F/U by nature · 2 3-Way columns · 3 Volume/Price/Mix/FX/Efficiency when data · 4 `not attributable` honest · 5 Reason codes + narrative saved · 6 Drill to source rows · 7 Thresholds · 8 Waterfall export |
| **F-025 FVA** | 1 MAPE/bias/hit rate per line/BU · 2 ≥3 versions empty state · 3 Restatement flag + recompute · 4 Version immutability · 5 Trend chart · 6 Export · 7 Filtering · 8 Scoring method documented |
| **F-026 Alerts** | 1 Rule per KPI/line/covenant · 2 Trigger chain shown · 3 Dedupe + digest · 4 Suppress locked scenarios · 5 Dismiss/90-day log · 6 OS notification opt-in · 7 Rule invalid blocked · 8 Alert center empty state |
| **F-027 Statement Suite** | 1 P&L/BS/CF/SoCE render per period · 2 GAAP/IFRS presets switch · 3 Rounding exact (largest-remainder) · 4 Tie-outs (BS, CF→cash) · 5 Export blocked on fail w/ list · 6 YTD/FY/PY columns · 7 Drills to source · 8 53-week flagged |
| **F-028 Consolidation** | 1 Mixed packs/calendars/currencies · 2 Rollup maps complete gate · 3 IC tie + eliminations net 0 · 4 NCI + SoCE row · 5 FX avg/closing + OCI · 6 Transit mapping explicit · 7 Segment report + drills · 8 Stale banner on re-map |
| **F-029 Report/KPI Builders** | 1 Rows/cols/filters/grouping · 2 000s/parentheses/locale · 3 Saved/versioned layouts · 4 Auto-remap offer on rename · 5 KPI formula validation · 6 `n/a` division guard · 7 Explainers render · 8 Export uses same defs |
| **F-030 Dashboard/Board Pack** | 1 KPI cards + trends + cash + alerts · 2 Plan-Only ranges not blanks · 3 Segment summary (group) · 4 Board pack fixed order · 5 Commentary section · 6 Health gate before export · 7 Card explainers · 8 Quick actions |
| **F-031 Exports** | 1 Excel formulas preserved · 2 PDF deterministic (hash equal 3 OS) · 3 Model dump re-import roundtrip · 4 Data room complete · 5 Injection protection quotes `=` · 6 Background progress · 7 Health gate blocks · 8 Export audited |
| **F-032 Health Check** | 1 5 categories run · 2 Findings clickable → cells · 3 No auto-fix · 4 Waiver requires reason · 5 Block export until green/waiver · 6 History + rerun · 7 Partial results stream · 8 Performance < 30s (50 BU) |
| **F-033 Audit Trail** | 1 HMAC chain verified on unlock · 2 Event before/after shown · 3 Filters + pagination · 4 Tamper → read-only + restore · 5 Data room export · 6 No secrets in events · 7 Archiving preserves verify · 8 Export log |
| **F-034 Security** | 1 Argon2id params exact · 2 PIN weak policy · 3 5-fail lockout · 4 Recovery phrase 12 words + confirm · 5 Decline path logged · 6 Keychain per-OS status · 7 Linux fallback warning · 8 Zero plaintext secrets in DB/logs |
| **F-035 Licensing** | 1 Offline verify · 2 Grace countdown · 3 Bad signature → read-only · 4 Machine change path · 5 Request/response files · 6 Expiry UX no data loss · 7 Activation audited · 8 No network needed |
| **F-036 Auto-update** | 1 Signed updater channel · 2 Pre-migration snapshot · 3 Forward+rollback tested · 4 Interruption recovery · 5 Beta label · 6 Changelog shown · 7 Manual fallback · 8 Update does not touch vault/backups |
| **F-037 Backup/Restore** | 1 Encrypted + passphrase · 2 Auto/manual schedule · 3 Rotation policy · 4 Pre-restore snapshot · 5 Restore transactional + audit · 6 Wrong passphrase safe · 7 Disk full safe · 8 Archive restore |
| **F-038 Help/Search/A11y** | 1 Ctrl+K global search · 2 F1 per screen · 3 KPI explainers correct · 4 Keyboard-only all flows · 5 WCAG AA axe 0 × states · 6 200% zoom no clip · 7 Dark theme contrast ✓ · 8 Error reference in-app |

## 3. RELEASE QA GATES (all features)

1. `npm run check` (tsc + eslint + prettier + vitest coverage) green.
2. `cargo test` + `cargo clippy -D warnings` + `cargo audit` green.
3. Playwright P0 flows ×3 OS green (screenshots attached for release).
4. axe 0 across all screens × states; keyboard E2E green.
5. `money:ast` 0 float violations; `schema:equality` pass; `docs:verify` pass.
6. Migration suite forward + rollback green; Schema manifest current.
7. Perf budget suite green (PERFORMANCE-REQUIREMENTS §numeric).
8. SECURITY-CHECKLIST: OWASP matrix self-audit signed off; secrets scan clean.
9. Zero-mock-data audit (no production path uses fixtures).
10. Release notes + CHANGELOG + docs-index updated.

*Referenced by: DEFINITION-OF-DONE.md, CI-CD.md, ROADMAP.md, FEATURE-TRACEABILITY-MATRIX.md.*
