# FEATURE-TRACEABILITY-MATRIX.md

> OneFP&A · Stage 3 audit artifact (doc #38) · **Every `[MVP]` feature must have a checkmark in every column.**
> Columns: User Story (US-xxx) · Screen(s) (S-xxx) · API Commands (API-SPEC) · DB Tables (DATABASE-SCHEMA) · Test Coverage (TESTING-STRATEGY + QA items).
> Legend: ✅ complete · ⚠️ partial (flagged in Notes) · ❌ gap (blocking — must fix before Stage 4).

---

## 1. FEATURE TRACEABILITY MATRIX (F-001…F-038)

| Feature | Story | Screens | API Commands | DB Tables | Test Coverage | Notes |
|---|---|---|---|---|---|---|
| F-001 Company Manager | US-001/002 | S-020, S-004 | company.create/open/list/clone/archive/delete | companies, backups, snapshots | ✅ unit+E2E UF-001/010 | — |
| F-002 COA & Dimensions | US-003 | S-021 | coa.* | accounts, dimensions, dimension_values, account_dimension_map | ✅ unit+integration | — |
| F-003 Calendar | US-004 | S-022 | calendar.* | fiscal_calendars, fiscal_years, fiscal_periods, bu_calendar_map | ✅ oracle fixtures (4-5-4, 52-53) | ⚠️ 5-4-4/3-3-3-4 fixtures scheduled M1-7 (TODO) |
| F-004 First-Run Wizard | US-005 | S-002, D-005 | company.create, model.create | companies, models | ✅ E2E UF-001 | — |
| F-005 Packs & Pack Builder | US-006 | S-023, S-002 | (pack load via company.create; builder commands in M1-9) | packs, pack_components | ✅ schema tests | ⚠️ explicit `pack.*` command group added in M1-9 (API-SPEC note) |
| F-006 Horizons/Sizing | US-007 | S-040 | model.create (horizon) | models.horizon | ✅ bench (PERF §1) | — |
| F-007 GL Dump Import | US-008 | S-030–S-032 | import.parse/validate/tieout/commit/rollback/history | import_batches, source_files, gl_lines | ✅ unit+E2E UF-002 | — |
| F-008 Excel/CSV + Driver Data | US-009 | S-030/031 | driver.import, import.* (kind) | driver_values, import_batches | ✅ unit | — |
| F-009 Connectors | US-010 | S-033 | connector.* | connectors, connector_credentials, connector_sync_runs | ✅ contract tests per provider | ⚠️ E2E auth runs on CI runners (ENV-BOUND) |
| F-010 Vault & Reconciliation | US-011 | S-034, S-030 | reconcile.run, import.history | source_files | ✅ unit+integration | — |
| F-011 Mapping Management | US-012 | S-031 | import.map.save_v1, validate | mapping_templates, mapping_columns | ✅ unit | — |
| F-012 Formulas & Multi-Sheet | US-013 | S-040–S-042 | model.cell.set.v1, inspect, recalc | model_sheets, model_lines, model_values | ✅ unit+property (cycles) | — |
| F-013 Driver Modeling | US-014 | S-043 | driver.upsert/set_value/import | drivers, driver_values | ✅ unit+integration | — |
| F-014 Assumption Register | US-015 | S-044 | assumption.* | assumptions, assumption_values | ✅ unit | — |
| F-015 Methods & Spreading | US-016 | S-041 | model.cell.set.v1 (method), spread via engine | model_lines.method | ✅ unit | — |
| F-016 Headcount Plan | US-017 | S-045 | driver.* + model.cell | drivers(headcount), driver_values | ✅ unit | — |
| F-017 Capital/Debt/WC/13w | US-018 | S-046 | model.cell + report.get (cash) | model_lines/values, gl_lines | ✅ property (roll-forward) | — |
| F-018 Production/Backlog | US-019 | S-047 | driver.* + model.schedule | drivers, model_values | ✅ unit | — |
| F-019 RevRec | US-020 | S-048 | model.cell (policy) | model_lines/values | ✅ unit | — |
| F-020 Excel-parity editing | US-021 | S-041 | (UI layer; cell.set under it) | model_values | ✅ unit+E2E (keyboard) | — |
| F-021 Budget/Forecast/Rolling | US-022 | S-053, S-041 | scene.*, plan.* | scenarios, scenario_versions | ✅ unit+E2E UF-005 | — |
| F-022 Scenarios/Compare/What-if | US-023 | S-050–S-052 | scene.create/duplicate/approve/lock, model.diff, goal_seek | scenarios, scenario_versions | ✅ unit+E2E UF-007 | ⚠️ `goal_seek` + `sensitivity` commands documented under plan.* (API-SPEC §2 — made explicit M4-4) |
| F-023 Input Collection | US-024 | S-053 | import.commit (kind=collection) | import_batches, driver_values | ✅ integration | — |
| F-024 Variance & Attribution | US-025 | S-054 | variance.get, set_reason_code | gl_lines, model_values, drivers | ✅ unit+property (sum of parts) | — |
| F-025 FVA | US-026 | S-055 | fva.get | scenario_versions, gl_lines | ✅ unit | — |
| F-026 Alerts | US-027 | S-056, S-010 | alerts.* | alerts, alert_rules | ✅ unit | — |
| F-027 Statement Suite | US-028 | S-060 | statement.get.v1 | accounts, model_values, gl_lines | ✅ property (tie-outs) + oracle | — |
| F-028 Consolidation | US-029 | S-061, S-060 | consolidation.run/status | business_units, bu_ownership, ic_lines, fx_rates, group_rollup_maps | ✅ oracle (2-BU) + property (IC=0) | ⚠️ 50-BU perf fixture in M6-3 (TODO) |
| F-029 Report/KPI Builders | US-030 | S-062/063 | report.layout.*, kpi.define | kpis, report_layouts, layout_columns | ✅ unit | — |
| F-030 Dashboard/Board Pack | US-031 | S-010, S-064 | statement.get, kpi, board_pack.generate | kpis, board_packs | ✅ unit+E2E UF-005 | — |
| F-031 Export Suite | US-032 | D-003, S-060–064 | export.excel/pdf/model_dump, audit.export_dataroom | audit_events, gl_lines | ✅ unit+E2E (hash parity 3 OS) | — |
| F-032 Health Check | US-033 | S-071 | health.run/waive | health_checks, health_findings, waivers | ✅ integration | — |
| F-033 Audit Trail | US-034 | S-070 | audit.list, audit.export_dataroom | audit_events | ✅ property (chain) + E2E tamper | — |
| F-034 Security (PIN/Recovery) | US-035 | S-072, D-007, S-001 | session.*, security.* | pin_metadata | ✅ unit+E2E UF-010/011 | — |
| F-035 Licensing | US-036 | S-073, D-006 | license.* | licenses | ✅ unit (signature vectors) | — |
| F-036 Auto-update | US-037 | D-009, S-075 | update.check | — (binary) | ✅ integration (bad-sig fixture) | — |
| F-037 Backup/Restore | US-038 | S-074 | backup.create/restore | backups, snapshots | ✅ integration+E2E UF-010 | — |
| F-038 Help/Search/A11y | US-039 | S-003, S-076, F1 overlays | app.diagnostics.export, settings.* | settings | ✅ unit+axe sweep | — |

**Result: 38/38 features have story + screens + commands + tables + tests. 5 ⚠️ intentional schedule notes (M1-7, M1-9, M4-4, M6-3, ENV-BOUND) — all with explicit TODO tasks. 0 ❌ gaps.**

---

## 2. TERMINOLOGY AUDIT RESULT

| Check | Status | Issues Found | Auto-Fixed? |
|---|---|---|---|
| BANNED synonym `Entity` (as BU) | ✅ Fixed | PROJECT-BRIEF, USER-PERSONAS, SCREENS S-054, DATABASE-SCHEMA audit columns | ✅ Yes (→ Business Unit / object_type/object_id) |
| BANNED `Workspace` (as Company) | ✅ Fixed | PRD F-001, V-015, SCREENS S-004 + prose | ✅ Yes (→ Company Manager / App Shell / Team collaboration) |
| BANNED `Metric` (as KPI) | ✅ Fixed | SCREENS S-055, COMPONENT-LIBRARY CovenantGauge | ✅ Yes (→ score cards / kpiRef) |
| BANNED `Upload` (as Import) | ✅ Fixed | USER-FLOWS UF-012, SCREENS S-073 | ✅ Yes (→ load/open license file) |
| "workspace root" (Cargo) | ✅ Allowed | ARCHITECTURE tree comment | N/A — Rust workspace concept, not product term |
| All other 150 glossary terms | ✅ PASS | None | — |

## 3. DATA-FLOW AUDIT (sample — full set in CI `docs:verify`)

| Command | Request fields ↔ DB | Response ↔ Screens | Auth ↔ AUTH-SPEC |
|---|---|---|---|
| `model.cell.set.v1` | ✅ line/scenario/period exist in model_values | ✅ recalc.changed_cells → S-041 grid | ✅ ScenarioState gate |
| `import.commit` | ✅ import_batches + gl_lines + exclusions | ✅ S-032 totals → S-030 history | ✅ session only |
| `consolidation.run` | ✅ BUs, ic_lines, fx_rates, group_rollup_maps | ✅ S-061 segment + S-060 group | ✅ session; HARD gates |
| `statement.get.v1` | ✅ accounts + model_values/gl_lines | ✅ S-060 rows/totals/tieout | ✅ session |
| `license.verify` | ✅ licenses + signature payload | ✅ S-073 status/days_left | ✅ none (pre-unlock) |
| `session.unlock` | ✅ pin_metadata (never stores PIN) | ✅ S-001 → S-004 | ✅ per §2.2 |

**Result: PASS — no request field missing from schema; no response field missing from screens; no authorization mismatch.**

## 4. ORPHAN DETECTION

| Candidate | Status |
|---|---|
| Screen S-005 (referenced in UF-001/U-006) | ❌ Found → fixed to S-002 (wizard) |
| Screen S-006 (Pack Builder ref) | ❌ Found → S-023 Pack Studio added (47 screens) + TODO/ROADMAP updated |
| Command `goal_seek`/`sensitivity` in stories but not catalog | ⚠️ Found → covered under `plan.*`; made explicit in M4-4 TODO |
| Table `fiscal_calendars` in GLOSSARY? (yes) · `pack_components` covered in API? (loaded by company.create) | ✅ PASS |
| Any doc outside DOCS-INDEX | ✅ PASS — 38 files = 38 index rows (verified by ls) |

## 5. CONTRADICTION SCAN

| Check | Status |
|---|---|
| PRD F-001 name vs SCREENS S-020 name (after fix) | ✅ consistent |
| Screens count (47) everywhere (USER-FLOWS matrix, DOCS-INDEX, this file) | ✅ consistent |
| Calendar family in PRD F-003 vs DATABASE presets vs DESIGN — identical 5 presets | ✅ PASS |
| Money rule: TECH-STACK (decimal.js display) vs STATE-MANAGEMENT (i64/string) vs DB (INTEGER) vs GLOSSARY I1 | ✅ PASS — one story |
| Auth: AUTH-SPEC §3 matrix vs API auth column vs SCREENS lock states | ✅ PASS |
| PERFORMANCE targets vs TESTING bench vs ROADMAP exit criteria (recalc 2s / consol 10s) | ✅ PASS |
| Error codes: API-SPEC list ⊆ ERROR-HANDLING taxonomy; no code invented outside | ✅ PASS — 6 new codes added explicitly in taxonomy |
| README quickstart vs TECH-STACK versions/commands | ✅ PASS |
| v1.0.0 feature count: PRD 38 vs QA 38 vs matrix 38 vs TODO milestones | ✅ PASS |

---

## 6. AUDIT SUMMARY

| Check | Status | Issues Found | Auto-Fixed? |
|---|---|---|---|
| 3.1 Feature traceability | ✅ PASS (0 gaps; 5 scheduled notes w/ TODOs) | — | — |
| 3.2 Terminology audit | ✅ PASS → fixed 4 | 4 (Entity/Workspace/Metric/Upload) | ✅ |
| 3.3 Data-flow audit | ✅ PASS | 0 | — |
| 3.4 Orphan detection | ✅ PASS → fixed 2 | 2 (S-005, S-006) | ✅ |
| 3.5 Contradiction scan | ✅ PASS | 0 | — |

**Verdict: DOCUMENTATION SUITE IS CONSISTENT. Stage 4 (build-readiness test) may proceed.**

*Referenced by: DOCS-INDEX.md, DEFINITION-OF-DONE.md, QA-CHECKLIST.md.*
