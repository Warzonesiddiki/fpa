# TODO.md

> OneFP&A · All remaining work as actionable tasks tagged by milestone. One task = one PR-sized unit.
> Milestones: **M0 Spec** (shared), **M1 Foundation**, **M2 Ingestion**, **M3 Modeling**, **M4 Planning**, **M5 Analysis**, **M6 Reporting**, **M7 Governance/Release** — dependency-ordered per ROADMAP.md.

---

## M0 — SPEC COMPLETION

- [ ] **M0-1** Stage 3 cross-document audit: FEATURE-TRACEABILITY-MATRIX.md, terminology scan, data-flow audit, orphan detection, contradiction scan (per DOCS-INDEX item) — depends: all phases approved
- [ ] **M0-2** Stage 4 build-readiness test: answer 5 gates, fix docs, confirm YES
- [x] **M0-3** Generate `docs/examples/sample_gl_dump.xlsx` + Demo Company fixture (synthetic; per TEST-FIXTURES-SPEC) — DONE 2026-08-31: canonical 3-sheet xlsx (valid inline-string OOXML) + CSV + `.expected.json` oracle (480 rows, tie-out 937,976.64, SHA256) + `tests/fixtures/demo_company/` (clearly-marked, byte-identical GL dump, P&L rollup to the cent); evidence in TASKBOARD M0-3
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

- [ ] **M2-1** Import hub + parser (calamine: xlsx/xls/csv/tsv/zip, encodings, locale numbers) (S-030) — bounded UI/IPC path built: S-030 real-IPC parse entry, Company-scoped store, native picker/drop, exact parser states/errors, XLSX/XLS/ODS/CSV/TSV/TXT, and S-031 hand-off. Persistent `import.history` subsequently landed in M2-4. ZIP, progress/cancel/streaming, 500k benchmark, and native cargo gates remain.
- [x] **M2-2** Mapping wizard + template versioning + normalization rules (S-031, F-011) — `/app/import/map`, strict typed `import.map.save_v1`, native invoke, stable-id `vN`, deterministic checksum, reserved rule rows, one-transaction HMAC audit, finite text/period/sign normalization, real S-030 hand-off, route/search wiring, five states + edge/success/read-only/a11y tests. Historical full definitions are immutable audit payloads; latest rows only are materialized. No map-list/load/history command exists, so browsing is visibly gated. Available JS/docs/security/build/coverage gates pass. Native compile/test/rustfmt/Clippy and IPC E2E are blocked by missing `cargo`, `rustc`, `rustfmt`, and `clippy-driver`; the parser benchmark remains outstanding.
- [x] **M2-3** Validation + preview + HARD/WARNING engine (S-031) — strict snake_case response lock; real `import.validate {parse_id,mapping_id}` store path with Company/source/mapping stale-response invalidation and version check; HARD/WARNING row-vs-batch findings; full counts with first-50 finding rendering; first 50 valid mapped rows through integer-minor-unit `MoneyCell`; clean/empty/populated/loading/error/expired-parse/read-only/edge/a11y tests; and only real edit-map or correct/re-parse remediation. S-031 itself still invents no account-create/remap/exclusion/acknowledgement controls; a clean nonzero result now hands off to the M2-4 S-032 route. Available JS/docs/security/build/coverage gates pass. Native validation/wire/preview-cap tests are authored, but local `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check`, and native IPC E2E remain blocked by missing `cargo`, `rustc`, `rustfmt`, and `clippy-driver`; GL layout oracles and the 500k benchmark remain follow-up evidence.
- [x] **M2-4** Tie-Out gate + commit as Import Batch + rollback + vault (S-032, F-007/010) — bounded S-032 and S-030 history unit implemented through registered production IPC: strict checked-integer Tie-Out; only Rust-attributable exclusions with mandatory audited reasons; authoritative transactional commit/duplicate gate; exact batch metadata; Company-scoped 25-row persistent history; immediate, predecessor-safe audited rollback; stale/read-only/error/empty/loading/success/edge/a11y coverage. No duplicate override, warning acknowledgement, adjusted-total browser math, or Variance link is fabricated. Source Vault payload persistence is explicitly blocked (and no source copy/row is written): `source_files` is metadata-only and the current lifecycle lacks compressed SQLite-payload mutation plus atomic authenticated Company-container resealing. Native compile/test/rustfmt/Clippy and desktop IPC E2E remain unavailable because `cargo`, `rustc`, `rustfmt`, and `clippy-driver` are missing; ZIP/progress/cancel, GL oracles, and 500k evidence remain broader ingestion gates.
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
- [ ] **M3-4** Assumption Register + hardcode detection (S-044) — persisted `assumption.list/upsert/find_usages` (exact decimal values, audited writes, Company/Model scoping, five UI states, usage lookup) AND TS hardcode detection are implemented: engine `findHardcodedLiterals`/`scanHardcoded`/`convertHardcoded` + worker ops, store `scanHardcoded`/`convertHardcoded`/`waiveHardcoded` (session-scoped reason; audited event is a native follow-on) + `assumptionEffectiveForPeriod`/`diffAssumptionValues`, and the S-044 hardcoded-values panel + edit-form change diff. Remaining: converted named-range references resolve once M3-10 named ranges land; Rust audited waiver event; cargo gates.
- [ ] **M3-5** Planning methods + period spreading + bootstrap/copy (S-041 part; MODELING-METHODS-SPEC)
- [ ] **M3-6** Headcount plan (S-045) — TS Decimal/day-count/rollup/UI slice and typed audited response are implemented; native schedule handler, SQLite persistence, HMAC audit, cargo and desktop IPC gates remain (PARTIAL/NATIVE-UNVERIFIED).
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
- [ ] **M6-3** Consolidation: rollup maps, IC Tie-Out + Elimination, Balance Translation, NCI (S-021/S-061)
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
