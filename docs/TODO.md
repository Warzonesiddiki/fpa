# TODO.md

> OneFP&A · All remaining work as actionable tasks tagged by milestone. One task = one PR-sized unit.
> Milestones: **M0 Spec** (shared), **M1 Foundation**, **M2 Ingestion**, **M3 Modeling**, **M4 Planning**, **M5 Analysis**, **M6 Reporting**, **M7 Governance/Release** — dependency-ordered per ROADMAP.md.

---

## M0 — SPEC COMPLETION

- [ ] **M0-1** Stage 3 cross-document audit: FEATURE-TRACEABILITY-MATRIX.md, terminology scan, data-flow audit, orphan detection, contradiction scan (per DOCS-INDEX item) — depends: all phases approved
- [ ] **M0-2** Stage 4 build-readiness test: answer 5 gates, fix docs, confirm YES
- [ ] **M0-3** Generate `docs/examples/sample_gl_dump.xlsx` + Demo Company fixture (synthetic; per TEST-FIXTURES-SPEC)
- [ ] **M0-4** Pack schema v1.0 (`packs/schema/pack.schema.json` per INDUSTRY-PACK-SPEC) + 12 packs seed content (per TEST-FIXTURES-SPEC §1 packs/)

## M1 — FOUNDATION (F-001…F-006)

- [ ] **M1-1** Rust scaffold: workspace, `error.rs` (AppError→IPC), `money.rs` (rust_decimal + proptest), migrations `001_initial.sql` + test
- [ ] **M1-2** Tauri app shell: window, capabilities (least-privilege), session store, tauri-specta bindings, S-004 App Shell
- [ ] **M1-3** Security: argon2 PIN + recovery phrase + AES-GCM Company wrapper + keychain (S-072, D-007)
- [ ] **M1-4** License: ed25519 verify + grace + S-073 + request/response files
- [ ] **M1-5** Company manager: create/open/switch/sandbox/archive/delete (S-020), file association + single-instance lock
- [ ] **M1-6** COA + dimensions (S-021) w/ codes normalization + merge + version
- [ ] **M1-7** Calendar engine (S-022): 12mo/4-5-4/4-4-5/5-4-4/3-3-3-4 + 52-53 + transit mapping + oracle fixtures
- [ ] **M1-8** First-Run Wizard (S-002/D-005): 5 steps, plan-only mode, demo company, resume-safe
- [ ] **M1-9** Industry Pack loader + schema validation (INDUSTRY-PACK-SPEC §8) + Pack Builder MVP (S-023)
- [ ] **M1-10** Settings + theme/density + global search skeleton (S-075/S-003)

## M2 — INGESTION (F-007…F-011)

- [ ] **M2-1** Import hub + parser (calamine: xlsx/xls/csv/tsv/zip, encodings, locale numbers) (S-030)
- [ ] **M2-2** Mapping wizard + template versioning + normalization rules (S-031, F-011)
- [ ] **M2-3** Validation + preview + HARD/WARNING engine (S-031)
- [ ] **M2-4** Tie-Out gate + commit as Import Batch + rollback + vault (S-032, F-007/010)
- [ ] **M2-5** Driver/dimension/opening-balance imports (S-030/031 – same pipeline)
- [ ] **M2-6** Connector adapter + QBO connector (contract tests, keychain, rate limiter) (S-033)
- [ ] **M2-7** Xero connector
- [ ] **M2-8** NetSuite connector (OAuth1 TBA)
- [ ] **M2-9** Sage connector
- [ ] **M2-10** Source Reconciliation (S-034) + source vault UI

## M3 — MODELING (F-012…F-020)

- [ ] **M3-1** Multi-sheet model + HyperFormula worker integration + `model.cell.set.v1` (S-040/041; FORMULA-ENGINE-SPEC whitelist + MONEY-ROUNDING-SPEC commit rule)
- [ ] **M3-2** Formula inspection + cycle detection + refs (S-042)
- [ ] **M3-3** Driver tables + federation precedence + bounds (S-043)
- [ ] **M3-4** Assumption Register + hardcode detection (S-044)
- [ ] **M3-5** Planning methods + period spreading + bootstrap/copy (S-041 part; MODELING-METHODS-SPEC)
- [ ] **M3-6** Headcount plan (S-045)
- [ ] **M3-7** Capital/debt/WC/13-week cash + covenant gauges (S-046)
- [ ] **M3-8** Production/inventory/backlog + rev rec schedules (S-047/048)
- [ ] **M3-9** Excel-parity grid UX: keys/fill/paste/undo-redo 100+ (S-041)
- [ ] **M3-10** Analysis functions (CAGR/MA/Trend/season) + named ranges

## M4 — PLANNING (F-021…F-023)

- [ ] **M4-1** Budget/Forecast/Rolling + hybrid labeling (S-041/053)
- [ ] **M4-2** Scenario states + versions + baseline freeze (S-050; SCENARIO-VERSION-SPEC)
- [ ] **M4-3** Model compare (S-051)
- [ ] **M4-4** What-if overlay + waterfall + sensitivity tornado + goal seek (S-052)
- [ ] **M4-5** Planning cycle manager + close checklist (S-053)
- [ ] **M4-6** Input collection loop (S-053)

## M5 — ANALYSIS (F-024…F-026)

- [ ] **M5-1** Variance engine: $/% + F/U + 3-way (S-054)
- [ ] **M5-2** Attribution engine (volume/price/mix/FX/efficiency) + reason codes (S-054)
- [ ] **M5-3** FVA engine (MAPE/bias/hit) (S-055)
- [ ] **M5-4** Alerts engine + center + rules (S-056)

## M6 — REPORTING & GOV (F-027…F-033)

- [ ] **M6-1** Statement engine (P&L/BS/CF/SoCE) + tie-outs + rounding largest-remainder (S-060)
- [ ] **M6-2** GAAP/IFRS presets + segment report (S-060/061)
- [ ] **M6-3** Consolidation: rollup maps, IC tie/elimination, FX translation, NCI (S-021/S-061)
- [ ] **M6-4** Report Builder + KPI Builder (S-062/063)
- [ ] **M6-5** Dashboard + Board Pack + explainers (S-010/064)
- [ ] **M6-6** Export suite: xlsx/typst PDF/model dump/data room + injection guard (S-031/D-003; EXPORT-FORMAT-SPEC)
- [ ] **M6-7** Health Check engine + waiver (S-071)
- [ ] **M6-8** Audit trail engine (HMAC chain) + data room (S-070)
- [ ] **M6-9** Backup/restore/retention (S-074) + updater integration (F-036)

## M7 — RELEASE

- [ ] **M7-1** CI 12-stage pipeline (3 OS) + branch protection + scanners
- [ ] **M7-2** Signing/notarization per OS + update manifest + SHA256SUMS + SBOM
- [ ] **M7-3** Perf bench suite + baseline (PERFORMANCE-REQUIREMENTS)
- [ ] **M7-4** A11y full sweep + keyboard E2E at 200% + dark theme
- [ ] **M7-5** E2E 14 flows × 3 OS; P0 evidence package
- [ ] **M7-6** Demo Company + pack content QA; docs:verify final
- [ ] **M7-7** v1.0.0-rc1 → v1.0.0 release (CHANGELOG, release notes)
- [ ] **M7-8** TODO.md archival of completed items + carry-forward to V2 (V-001…V-020)

---

## V2 BACKLOG (v1.1.0, referenced from PRD §3 / not started)

- [ ] V-001 AI Copilot (on-device, explainable) · V-002 Monte Carlo · V-003 contract-level revrec · V-004 valuation · V-005 HRIS/CRM connectors · V-006 watch-folder · V-007 direct CF · V-008 live FX · V-009 benchmarks · V-010 PPTX · V-011 i18n · V-012 API · V-013 allocations · V-014 merge files · V-015 team collaboration · V-016 tax calendar · V-017 legal hold · V-018 probability weighting · V-019 hedging views · V-020 payroll presets
- [ ] V-021 lease accounting · V-022 tax provision · V-023 ESG reporting · V-024 treasury/banking · V-025 insurance/financial-instruments · V-026 advanced period-close · V-027 data governance suite · V-028 report scheduling/distribution · V-029 plugin marketplace
- (v9 revision 2026-08-31: V-021…V-029 promoted from the scrapped FinPlan Pro backlog; MVP set F-001…F-038 unchanged.)

*Referenced by: ROADMAP.md, DEFINITION-OF-DONE.md, DOCS-INDEX.md.*
