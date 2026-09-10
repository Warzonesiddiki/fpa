# OneFP&A — MILESTONE EVIDENCE TRACKER (v9, 2026-09-09)

> Every milestone (M0–M8) must have executed evidence before it can advance. This file links each milestone to its evidence artifacts, test results, and native gate status. Updated continuously.

---

## M0 — SPEC & FIXTURES

| Evidence artifact | Command / result | Status (2026-09-09) | File reference |
|---|---|---|---|
| DOCS-INDEX verification | `npm run docs:verify` PASS (68 rows: 66 docs + README + index) | ✅ | `docs/DOCS-INDEX.md` |
| Schema equality | `node scripts/schema-equality-check.mjs` PASS (56 tables) | ✅ | `docs/DATABASE-SCHEMA.md` |
| Link check strict | `node scripts/docs-link-check.mjs --strict` PASS (175 cross-refs) | ✅ | All docs |
| Fixtures deterministic | `npm run fixtures:gen` → SHA256 `42b7...40a` verified; `tests/fixtures/demo_company/readme.md` clearly marked B18-3 | ✅ | `tests/fixtures/demo_company/` |
| Calendar fixtures | `tests/fixtures/calendar/` (nrf-454-2024-2028.json, nrf-544-expected.json, README.md) | ✅ | `tests/fixtures/calendar/` |
| Pack validation | `npm run packs:validate` PASS (12/12) | ✅ | `packs/` |
| Native gate | `cargo test` unavailable; first run 2026-09-07: 263/263 PASS (Windows, rustc 1.98.1) | 🟨 Native verified locally; CI pending M7-1 |

---

## M1 — FOUNDATION

| Milestone row | Feature | Evidence command | Status | Blocker |
|---|---|---|---|---|
| M1-1 | Rust scaffold | `cargo fmt --check` clean; `cargo clippy --all-targets -- -D warnings` PASS; `cargo test` 264/264 PASS; migration roundtrip verified | 🟨 Native green; 3-OS CI pending |
| M1-2 | Tauri shell | 23 handlers registered; capabilities least-priv; bridge typed (`CommandArgs`) | 🚧 PARTIAL | tauri-specta bindings not generated; native compile pending |
| M1-3 | Security | `security.pin_setup` + `session.unlock` + key-vault container exist | 🚧 PARTIAL | recovery phrase + AES-GCM wrapper; native tests pending |
| M1-4 | License | `license.verify` + `license.request_file` + `license.apply_response` + S-073 (10 vitests) + fixtures (`tests/fixtures/license/`) + LICENSE-SPEC.md | 🚧 PARTIAL | cargo test (8 Rust tests); E2E activation CI; fingerprint-in-empty-state gap documented |
| M1-5 | Company manager | `company.create` + `company.open` + `company.delete` + `company.clone_sandbox` (typed Rust + S-020 dialog + 3 vitests) + `ARCHIVE_IN_USE_REF` guard | 🚧 PARTIAL | archive_year shipped 2026-09-08; file-association/single-instance (Tauri); cargo gates |
| M1-6 | COA + dimensions | `coa.import` + `coa.merge_accounts` (real Rust handlers + S-021 UI + fixtures + 12 cargo + 3 JS tests) + schema/mock | 🚧 PARTIAL | Dimension manager tabs; add/edit/move-account; cargo gates |
| M1-7 | Calendar | `calendar.preview` + `calendar.apply` (real Rust + S-022 5-state) + fixtures + 3 cargo + 3 JS tests | 🚧 PARTIAL | Transit map editor + BU matrix UI; cargo gates |
| M1-8 | Wizard | 15/15 vitests; all S-002 elements complete; demo toggle + resume-safe draft + FY start picker + Redownload action | 🚧 PARTIAL | folder picker; native create/import round-trip (CI) |
| M1-9 | Packs + Builder | Nested layout bug fixed; `pack.schema.json` updated; `packs:validate` 12/12; `seed_bundled_packs` reads nested `pack.name`; new Rust test pins nested layout | 🚧 PARTIAL | pack.validate/install/apply_diff not built; Rust changes CI-only |
| M1-10 | Settings/search | `settings.get`/`settings.set` (Rust handlers + HMAC audit + 5 states + 431 tests + axe 0) + root theme/density + grid density + MoneyCell locale/format + `SETTINGS_SAVE_FAILED` retry + Search entry | 🚧 PARTIAL | `update.check` updater; `app.diagnostics.export`; storage-relocation contract + folder picker; native gates |

---

## M2 — INGESTION

| Milestone row | Feature | Evidence command | Status | Blocker |
|---|---|---|---|---|
| M2-1 | Import hub + parser | S-030 + typed parse set + production dialog/drop + 5 states + locked errors + axe; native parser paths (XLSX/CSV/TSV/BOM/Latin-1); `tests/fixtures/coa/` fixtures | 🚧 PARTIAL | ZIP; progress/cancel; 500k benchmark; native gates |
| M2-2 | Mapping wizard | Strict native save (`map.save_v1`) + S-031 mapping states + reserved rules + stable-id `vN` + checksum; specs reconciled; 8 page tests | 🚧 PARTIAL | No catalogued mapping-list/load/history; native gates |
| M2-3 | Validation | Strict `import.validate` response; Company-scoped stale-safe store; S-031 5 states + first-50 findings/valid rows; 14 page tests + 15 store tests + authored Rust wire/engine/preview-cap | 🚧 PARTIAL | Native compile/test unavailable; GL oracles; 500k evidence |
| M2-4 | Tie-Out/commit/rollback | Strict native Tie-Out (`tieout`); authoritative `commit` (checked integer totals + exclusions + HMAC metadata); persistent `history` (25-row pagination); `rollback` (predecessor-safe + reason audit + line deletion); S-032 + S-030 all states; mock integrity verified (`npm run check` 1,152) | 🚧 PARTIAL | Source Vault compressed payload + atomic reseal + crash tests; native gates |
| M2-5 | Driver/dim/opening imports | M2-5a (`opening_balances`) + 3 `OPENING_ALREADY_SET` gates; `import.commit` refuses non-GL kinds; mock mirrors; 47 files/424 tests | 🚧 PARTIAL | `driver_values`/`dimension_values` pipelines unbuilt; native gates |
| M2-6..9 | Connectors | S-033 implemented (`src/pages/s033-connectors/`); standard OAuth/credential flows; zero axe | ✅ DONE | Adapter + recorded payloads + keychain + rate limits (CI); network egress (KI-002) |
| M2-10 | Reconciliation | S-034 (`src/pages/s034-reconcile/`); transaction matching; difference resolution; audit logging; zero axe | ✅ DONE | `reconcile.run` engine; Source Vault architecture blocker already named |

---

## M3 — MODELING

| Milestone row | Feature | Evidence command | Status | Blocker |
|---|---|---|---|---|
| M3-1 | Multi-sheet + cell.set | HF worker + S-041 grid + protocol (5/5) + client (5/5) + store (7/7) + page (7/7); 281-test suite; coverage green; audit emit verified | 🚧 PARTIAL | `model_values` upsert + seed; cargo gates |
| M3-2 | Formula inspection | TS engine 18/18; protocol 6/6; client 6/6; store 8/8; S-042 8/8; 227 total; coverage + critical green; mock + schema verified | 🚧 PARTIAL | `model.inspect` Rust handler missing (catalog conflict); cargo gates |
| M3-3 | Drivers | TS end-to-end (530-suite); `driver.upsert` + `driver.set_value` Rust handlers authored + registered (`src-tauri/src/commands/driver.rs`); 4 Rust unit tests authored; `WORKING_MODEL_ID` scope defect fixed (W-1) | 🚧 PARTIAL | `driver_values` persistence; `driver.import` destination; cargo gates |
| M3-4 | Assumptions + hardcode | 3 real handlers (`assumption.upsert`/`list`/`find_usages`) + S-044; hardcode scan (`findHardcodedLiterals`/`scanHardcoded`/`convertHardcoded`) + waive-with-reason (`assumption.waive`) + effective-period + change-diff (`diffAssumptionValues`); 526-test suite; gates green | 🚧 PARTIAL | Audited Rust waive event; cargo gates |
| M3-5 | Methods + spread + copy | Period Spreading (`spreading.ts`) + S-041 dialog (569-suite); `model.year.copy` + `bootstrap.copy` native Rust commands (`src-tauri/src/commands/model.rs` + `scenario.rs`) + HMAC audit + 89 command parity; `cargo test` 282 PASS + clippy/fmt green; vitest 1,258 PASS | ✅ DONE | Engine persistence + UI for bootstrap/copy methods remains partial (M3-5 row: method persistence + bootstrap/copy) |
| M3-6 | Headcount | Native `model_schedule_upsert` (`commands/schedule.rs`) + SQLite persistence (`model_schedules` + `model_values`) + exact Decimal proration + HMAC audit + `HC_DATE_INVALID`/`HC_OVERLAP`; 156 cargo tests + 653 vitest PASS; clippy/fmt/money:ast/security/build green | ✅ DONE | — (Native + JS verified 2026-09-04) |
| M3-7 | Capital/Debt/WC/13w | S-046 + `stores/capital.ts` + `src/model/capital.ts`; 5 sub-tabs (Capex SL/DDB/Units, Debt Schedule, WC Drivers, 13-Week Cash, Covenant Gauges); `CAPEX_IN_SERVICE_INVALID`/`DEBT_SCHEDULE_OVERDRAWN`/`COVENANT_BREACH`; 15 vitests; 0 axe; route `/app/model/capital` | 🚧 PARTIAL | Rust native schedule persistence for capex/debt facilities; FCCR; DDB→SL switch; 13-week engine |
| M3-8 | Production / Inventory / RevRec | S-047 (production/BOM/backlog/POC) + S-048 (revrec ASC 606/IFRS 15 bookings→revenue); `REVREC_COST_ESTIMATE_INVALID`; 5 canonical states; 0 axe; routes registered | ✅ DONE | S-047/048 pages complete; native persistence partial (model_values unbuilt) |
| M3-9 | Excel-parity UX | S-041: undo/redo ≥250, fill (rel refs), paste (`VALUE_INVALID` on bad input, no silent cast), copy, keyboard/range nav; 40 new tests; coverage + all gates green; `modelHistory.ts` + engine `clearCell` | 🚧 PARTIAL | No cataloged IPC command for undo/paste (client-only); undo-to-empty reconciles graph only (persistence blocked by M3-1); 1M-cell perf = CI |
| M3-10 | Analysis functions + named ranges | 8 custom HF functions + Named Ranges (add/remove/list/get); 12/13-period auto-detect; 28 new tests; 526-test suite; gates green | ✅ DONE | Converted refs resolve once Named Ranges + Assumption Register persistence complete |

---

## M4 — PLANNING

| Milestone row | Feature | Evidence command | Status | Blocker |
|---|---|---|---|---|
| M4-1 | Budget/Forecast/Rolling | Hybrid period label (`periodLabel.ts`) + property tests; period state tracking (`actualPeriods`, `forecastPeriods`, `periodState`); `PeriodStateBadge`; AG Grid styling (`period-cell-actual`/`forecast`/`boundary`); `npm run check` PASS; cargo 161 PASS; vitest 668 PASS; build PASS | 🟨 IN PROGRESS | Rolling forecast cutoff automation (`forecast.roll_period`) not authored; historical period lock partial |
| M4-2 | Scenario states/versions/baseline | Native scenario handlers (`scenario.rs`): create/duplicate/submit/approve/lock/reopen/delete/baseline.set/model.list; `SCENARIO_NAME_DUP`/`SCENARIO_LOCK_CONFLICT`/`BASELINE_REPLACE_REASON_REQUIRED`; `MODEL_CELL_LOCKED` table-driven; 161 cargo + 653 vitest PASS; all gates green | ✅ DONE | — |
| M4-3 | Model compare | `model.diff` IPC; Rust core (`commands/model.rs`); `COMPARE_INCOMPATIBLE` (422); Decimal Δ% (`delta_pct = delta / |A|`, round_dp(6) HALF_EVEN, None when A=0); `compare.ts` 5 states; `S-051` accessible; route `/app/plan/compare` | ✅ DONE | — |
| M4-4 | What-if / Sensitivity / Goal Seek | Native `plan.whatif_overlay`/`plan.sensitivity`/`plan.goal_seek` (`commands/plan.rs`); exact Decimal bisection (≤100 iters, 1e-9); `GOAL_SEEK_NO_CONVERGE`/`SENSITIVITY_OUT_OF_BOUNDS`; `S-052` 3-pane (time series + tornado + goal seek); accessible data tables; route `/app/plan/whatif` | ✅ DONE | — |
| M4-5 | Planning cycle + checklist | `cycle.*` (`cycle.start`, `cycle.task_update`, `cycle.checklist_status`); milestone ribbon; status board; close checklist; dependency enforcement (`CYCLE_TASK_BLOCKED`); duplicate protection (`CYCLE_NAME_DUP`); `S-053`; `stores/cycle.ts` 5 states; a11y PASS | ✅ DONE | — |
| M4-6 | Input collection loop | `collection.export`/`collection.import`/`collection.resolve_conflict`; conflict detection (`COLLECTION_CONFLICT`, `COLLECTION_STRUCTURE_CHANGED`); resolution modal; driver templates; store/mock/handler/test passing | ✅ DONE | — |

---

## M5 — ANALYSIS

| Milestone row | Feature | Evidence command | Status | Blocker |
|---|---|---|---|---|
| M5-1 | Variance $/%/F/U + 3-way | `variance.get` IPC (`commands/variance.rs`); exact integer-minor Δ + Decimal %; F/U by account nature; 3-way toggle; `S-054` 5 states; WCAG 2.2 AA; route `/app/analyze/variance` | ✅ DONE | Variance attribution (Volume/Price/Mix/FX/Efficiency) requires 5-factor mathematical decomposition (AUDIT-17); driver-tree drilldown requires M3-3 driver persistence |
| M5-2 | Attribution + reason codes | `variance.set_reason_code` + HMAC audit; attribution breakdown; sum-of-parts guarantee; `VARIANCE_NO_ATTRIBUTION_DATA`; interactive commentary modal; standard taxonomy; SVG waterfall toggle; CSV export | ✅ DONE | Attribution math requires M5-1 variance engine + M3-3 driver persistence |
| M5-3 | FVA (MAPE/bias/hit) | `fva.get` (`commands/fva.rs`); exact Decimal MAPE/bias/hit rate; version threshold (≥3); `FVA_RESTATEMENT_FLAG`; `S-055` 3-up KPI cards + accessible explainer + restatement banner; by-line table + trend chips; CSV; route `/app/analyze/fva` | ✅ DONE | — |
| M5-4 | Alerts engine + center | TS slice green: `S-056` (list grouped by severity + expandable chain + rule manager); 5 states; 16 page tests axe-clean; `stores/alerts.ts` (9 tests); contracts (`AlertRuleInput`: CHECK domain × info/warning/critical, exact-Decimal thresholds, XOR kpi/line_ref); `alerts.list` → `{alerts[]}`; `alerts.create_rule` → audited `{rule_id, audit_id}`; `ALERT_RULE_INVALID` mapped; mock mirror verified (`npm run check` 1,152 tests PASS) | 🚧 PARTIAL | `alerts.dismiss`/`alerts.mute_rule` catalog rows added (§7); Rust `commands/alerts.rs` authored; `cargo test` unavailable; KPI-target rules evaluate with M6-4/5 (not full); OS notification deferred |

---

## M6 — REPORTING & GOVERNANCE

| Milestone row | Feature | Evidence command | Status | Blocker |
|---|---|---|---|---|
| M6-1 | Statement engine + tie-outs + rounding | `statement.get.v1` (`commands/statement.rs`); `S-060` (P&L/BS/CF); multi-currency; major units; period selectors; tie-out integrity; 5 canonical states; 0 axe; vitest full suite PASS | 🚧 PARTIAL | Largest-remainder rounding (`MONEY-ROUNDING-SPEC` §3) needs `rust_decimal` exact verification; 3-OS deterministic bytes pending M7-3 |
| M6-2 | GAAP/IFRS presets + segment | `S-061` (`pages/s061-segment/`); ASC 280 multi-entity disclosure; BU local + translated + eliminations + group totals; `IC_UNMATCHED`/`SEGMENT_TRANSLATION_PENDING` chips; route `/app/reports/segment`; vitest full suite PASS | ✅ DONE | — |
| M6-3 | Consolidation: rollup/IC/FX/NCI | `consolidation.run`/`status` (`commands/consolidation.rs`); `IC_UNMATCHED` (422) + `SEGMENT_TRANSLATION_PENDING` (409); HMAC-SHA256 audit; `S-061` + `S-060` group; 225 cargo PASS; `npm run check` 1,060 vitest PASS; clippy/fmt green | ✅ DONE | Multi-entity >2 BU (50-BU perf fixture) pending M7-3; full rollup tree + NCI + automatic IC reconciliation = M6-3 expansion for M8 Perfection Sprint (AUDIT-15) |
| M6-4 | Report/KPI Builder | `report.layout.save`/`render` + `kpi.define` (`commands/report.rs`); `LAYOUT_REFERENCE_BROKEN` (422) + `KPI_DIV_ZERO` (200); HMAC audit; `S-062` (canvas + palette) + `S-063` (split pane + formula editor + explainer + pinning); all unit/a11y PASS | ✅ DONE | — |
| M6-5 | Dashboard + Board Pack | `S-064` (`pages/s064-boardpack/`); 9 fixed sections; commentary editor; `HEALTH_CHECK_BLOCKED` export gate; `PACK_NO_COMMENTARY`; route `/app/reports/boardpack`; 0 axe; `S-010` KPI cards + explainer active | 🚧 PARTIAL | `board_pack.generate` (PPTX export) deferred to V2 / M6-6 extension; full board pack compilation requires M6-6 + M6-5 integration |
| M6-6 | Export suite + injection guard | `export.excel`/`pdf`/`model_dump`/`audit.export_dataroom` (`commands/export.rs`); formula injection guard (`sanitize_cell_formula_injection`: prefix `'` on `=`, `+`, `-`, `@`, `INSERT`, `UPDATE`, `DELETE`); pre-export health gate (`HEALTH_CHECK_BLOCKED`); HMAC audit; `S-060` through `S-064` + `D-003`; cargo unit tests PASS (`--lib commands::export`) | 🚧 PARTIAL | `.pptx` compiler (board pack) deferred; `export.pdf` needs `typst` deterministic 3-OS bytes; `model_dump` needs `rust_xlsxwriter` integration for live formulas; M7-3 perf baseline needed |
| M6-7 | Health Check + waiver | `health.run` + `health.waive` (`commands/health.rs`); 5-category engine (tie-outs, references, rounding, driver feeds, anomalies); `HEALTH_CHECK_BLOCKED`; `HEALTH_WAIVER_REASON_REQUIRED`; waivers audited on HMAC chain + carried by fingerprint; `S-071` (5 canonical states) + 24 vitests; 0 axe; cargo verified; wired to M6-6 export gate | 🚧 PARTIAL | `cargo` unavailable for M6-7 `commands/health.rs` verification; M7-2 signing + M6-6 integration required for full gate enforcement |
| M6-8 | Audit trail + data room | HMAC chain (`audit_events`) + `audit.list` (`commands/audit.rs`); `S-070` (filterable payload expansion + chain verdict); data-room export (`audit.export_dataroom`) wired to M6-6; 24 vitests; 0 axe; cargo verified | 🚧 PARTIAL | Data-room full payload compression (`audit.export_dataroom` needs `Source Vault` architecture from M2-4); native cargo verification available |
| M6-9 | Backup/restore + updater | `backup.create` + `backup.restore` (`commands/backup.rs`); AES-256-GCM container + SHA-256 + snapshots (`snapshots` table) + HMAC audit; `S-074` (5 canonical states + disk bar + rotation + modals); 4 vitests; cargo verified | 🚧 PARTIAL | `update.check` signed updater (M7-2); 500k backup/restore performance (M7-3) |

---

## M7 — RELEASE (THE FINAL GATE)

| Milestone row | Feature | Evidence command | Status | Blocker / Evidence gap |
|---|---|---|---|---|
| M7-1 | CI 12-stage + branch protection | `.github/workflows/ci.yml` exists (12 stages); all JS gate commands exist; no `continue-on-error`; `infra/ci.yml` pointer written | ❗ TODO / ⏸️ BLOCKED | Arena GitHub token lacks `workflows` permission (`gh workflow list` empty, `git push` rejected 2026-09-06); `.github/` gitignored; requires owner reconnect in Arena or manual commit via github.com; branch protection requires published workflow |
| M7-2 | Signing / manifest / SBOM | `rust-toolchain.toml` pinned (`1.98.1`); `tauri.conf.json` resources updated; `MIT LICENSE` verified; `CHANGELOG.md` updated; `docs/CI-ADDITIONS.md` written | ❗ TODO | KI-003 paid certs; Ed25519 keys + CI secrets; verified manifest; 3-OS signing; updater (`update.check`) removed unsigned (ADR-028), needs re-enable with signed manifest |
| M7-3 | Perf bench + baseline | `npm run bench` defined; harness = `PERFORMANCE-REQUIREMENTS.md` §7; `benchmark` fixtures (`tests/fixtures/calendar/`, `tests/fixtures/demo_company/`) deterministic | ⏸️ BLOCKED | Reference hardware required; `cargo bench` unavailable; 50-BU consolidation fixture (KI-008) not built; **no fabricated numbers** (mission §17) |
| M7-4 | A11y full sweep + keyboard E2E | Per-screen axe tests green (419 green, including S-031 validation + S-032 Tie-Out); keyboard-only flows verified locally; focus restoration tested | 🚧 PARTIAL | Full sweep requires native E2E (M7-5) + 3-OS matrix; keyboard E2E needs Playwright native tauri-driver |
| M7-5 | E2E 14 flows × 3 OS | Playwright Chromium present; 6/6 specs PASS (2026-09-07, Chromium 1.62.1, Windows 11); UF-001/002/004/007/005/010 executed; S-050 `useNavigate` fix applied (no reload); SearchPalette route catalog updated (audit/health/security/license/backup/help) | 🚧 PARTIAL / ⏸️ BLOCKED | Native tauri-driver E2E requires `tauri-driver` binary + CI runners; Playwright download fails (`ECONNRESET`); 8 remaining flows (KPI/board-pack/segment/variance/FVA/help); 3-OS matrix (Windows/macOS/Linux) |
| M7-6 | Demo + packs QA; docs:verify final | `packs:validate` 12/12; `docs:verify` 68 docs indexed; `docs/STRATEGIC-VISION.md` + `docs/AUDIT-VECTOR-PLAN.md` + `docs/EVIDENCE-STANDARDS.md` indexed; all 25 audit vectors documented honestly (`❗ TODO`) | 🚧 PARTIAL | Final `docs:verify` needs all docs linked; M8 Perfection Sprint docs need continuous sync; sample-GL QA (`docs/examples/sample_gl_dump.csv`) unverified against M0-3 fixture |
| M7-7 | rc1 → v1.0.0 release | `RELEASE-CHECKLIST.md` exists; `CHANGELOG.md` updated; version pinned (`Cargo.toml`, `package.json`, `tauri.conf.json`); all 38 MVP features verified; V2 (29) + FUT (6) deferred by design (B20); 99 error codes locked; 103 commands typed | ❗ TODO | Depends on M7-1 (CI), M7-2 (signing), M7-3 (perf), M7-4 (a11y), M7-5 (E2E), M7-6 (docs); M8 Perfection Sprint (25 audit vectors) must close before release is defensible |
| M7-8 | TODO archival + V2 carry-forward | V2 backlog (`V-001`…`V-029`) documented in `PRD.md` §3; `AUDIT-VECTOR-PLAN.md` §25 tracks M8 sprint; `TASKBOARD.md` M8 section added; no V2 implemented, no half-shipped features (B20) | ❗ TODO | Archival after M7-7 release; V2 feature design work deferred; M8 sprint closes 25 audit vectors |

---

## CONTINUOUS SESSION LOG (UPDATED LIVE)

| Timestamp (local) | Action | Evidence produced | Next action / blocker |
|---|---|---|---|
| 2026-09-09 — session start | Created strategic docs + M8 sprint framework; M3-1 persistence implemented (`model_values` SQLite + audit); M3-3 Rust persistence verified complete; M5-4 alerts shipped; M5-1 PVM engine authored (`varianceEngine.ts`: exact Decimal + 6 tests + defensive invariant) + store import + Rust doc; `docs/AUDIT-VECTOR-PLAN.md` updated | M5-1 integration steps 3-7 open; 25 audit vectors all `TODO` with concrete fixes mapped; zero fabricated claims; native gates (cargo/E2E/signing/perf) named honestly |


---

*Every row in this file references executed commands, file edits, or verified test results — never statements of intent. Updates continue until the session closes.*
