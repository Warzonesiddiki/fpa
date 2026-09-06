# OneFP&A — Full Audit Findings (2026-09-06, 20-agent sweep)

Source: 20 parallel subagents against `TASKBOARD.md`, `HANDOVER.md`, `docs/*`, `src/*`, `src-tauri/*`, `scripts/*`.
Repo: `C:\Users\Tahir\Documents\GitHub\fpa`. Branch `arena/01a07141-fpa`. Research-only, no fixes yet.

## 0. Headline counts

- Main board (58 rows): 26 DONE / 26 PARTIAL / 6 TODO / 0 IN PROGRESS / 0 BLOCKED.
- Screen tracker (42 screens): 27 DONE / 15 PARTIAL. PARTIAL: S-003,010,020,021,023,030,031,032,041,043,044,050,056,073,075.
- API catalog: 97 commands; `lib.rs` 78 handlers; `schema.ts` 80; `mock.ts` 75. 23 catalog commands have no Rust handler. 2 mock-only. 5 mock gaps. 4+1 extra-undocumented.
- Errors: 99 unique codes; ~68 in `core/error.rs`; ~31 unmapped.
- DB: 56 tables match, but checker blind to ALTER/indexes/per-table columns.
- Universal blocker: no cargo/rustc/clippy/fmt + no desktop IPC in sandbox; no CI (`.github/` git-ignored).

## 1. TASKBOARD non-DONE rows

M0-2, M1-1..M1-10 (all PARTIAL), M2-1..M2-5 (PARTIAL), M3-1..M3-5 + M3-9 (PARTIAL), M5-4 (PARTIAL), M7-1/2/3/5/7/8 TODO, M7-4/6 PARTIAL. M3-6 status contradiction (PARTIAL header vs DONE notes). Ledger §15 stale vs §§2-8.

## 2. HANDOVER open items (24)

M6-7: cargo/clippy/fmt, HEALTH_CHECK_BLOCKED from export (blocked M6-6), streaming (Tier-3). M6-8: cargo, audit.export_dataroom (blocked M6-6), 10M archive, virtualization. M5-4: cargo, KPI eval (M6-4/5), dismiss/mute (Tier-3), OS notify, prune job. M6-1: cargo, LRA oracles, S-060 selectors/scope/export/drill. M3-1/3-3/3-4: model_values/driver_values/waive-audit persistence. M4-2: created_at/kind/persistence. Pre-existing: restart-before-company, pin_setup marker scope. Next: native sweep, M6-2, Tier-3 RFCs, M1 acceptance.

## 3. PRD MVP gaps (F-001..F-038)

F-001..F-015 all PARTIAL except F-016 headcount (strongest DONE). F-017/018/019 conflict DONE vs TODO. F-020 PARTIAL. F-021..025 claimed DONE (stale ledger TODO). F-026 PARTIAL. F-027..033 mostly DONE-JS/native-caveat. F-034/035/036/038 GAP. Screens PARTIAL (15). Commands remaining (24). Release M7 TODO/BLOCKED.

## 4. DB schema

Tables 56==56. `packs.description` only in 002, invisible to checker. Checker ignores ALTER/indexes/UNIQUE/CHECK/FK, one-directional, shared-section containment (masks layout_columns.id, report_layouts.company_id). Doc INSERT examples wrong (gl_lines/kpis/alert_rules). fy_start_month contradiction, bu_calendar_map garble, created_at global false, currency seed 3 vs 10, forward FK order fragile. Pending: source_files payload, import_batches UNIQUE, mapping history, timestamp coverage, board_packs scoping, FK indexes.

## 5. Money exactness

Spec §1-8. Gate passes on checked patterns, blind to .toNumber/Math.floor/Intl/Decimal(number)/Value::Real/e2e/scripts. Rust gaps: negative-residual missing (money.rs:110-121), index tie-break vs HALF_EVEN, scale<=4 implicit, §7 vectors incomplete. JS violations: s047-production:349 FLOOR money, s060-statements:78-101 float-ratio split, s051-compare:20-28 second formatter, mock delta_pct float. Hardening: extend money:ast, safe-integer asserts, company.rs:731 text read, debug_assert scale, 10k proptest.

## 6. Formula engine

103 whitelist matches but: FPERIOD/FQTR/FYEAR/FPERIODSTART/PERIODLEN zero impl (#NAME?); NPV/IRR/XNPV/XIRR/PMT/... delegated unverified; OFFSET/INDIRECT/RAND constraints unenforced; driver D[expr] grammar no parser; growth/yoy/seasonal/spread/rollup types-only; bootstrap.copy/year.copy missing; YOY/PRIORPERIOD owned by TS not Rust (I5); TREND/MOVINGAVG/SEASONALITY dual impl + float; spreading mirrors money core; headcount dual calc; whitelist x3; error collapse (#CYCLE etc). M3-1..M3-5/M3-7/M3-8 pending.

## 7. API IPC (97 catalog)

23 no-handler: company.archive*year, model.create/sheet.add/dump_export/inspect/year.copy, bootstrap.copy, driver.import, connector.\* x4, reconcile.run/mark_authoritative, pack.validate/install/builder.save/apply_diff x4, board_pack.generate, update.check, app.diagnostics.export, security.recovery*\* x2. Mock-only: model.inspect, driver.import. Mock gaps: export.pdf/model_dump, alerts.dismiss/mute_rule, archive_year. Extras: security.pin_setup, alerts.dismiss/mute_rule, assumption.waive (fully undocumented), audit.export_dataroom stale text.

## 8. Screens (42/42 files present, numbering sparse by design)

Routes: only S-030/031/032 verbatim; rest /app prefix + renames; S-041 lost :sheetId; extra /app/model/sheets + /welcome PIN page. S-003 scoped to 12 screens, no fallback. Shell missing TOPBAR/STATUSBAR/collapse. S-010 static only. S-040 fork. FOOTSTRIP only 9 pages. 5-state gaps: S-004/S-010/S-003/S-040 + invented codes. D-001..010 ad-hoc not shared.

## 9. Errors/copy

31 unmapped (A2/B2/D2/E15/F6/H4). TS-only shadows: PACK*SCHEMA_INVALID, DRIVER_FEED_MISSING, SPREAD_WEIGHTS_INVALID, CONNECTOR*\*, HELP_TOPIC_MISSING, PACK_NO_COMMENTARY. Invented: READ_ONLY_MODE, MONEY_FORMAT_INVALID, etc. Non-verbatim VALUE_INVALID/INTERNAL/CAL_TRANSIT/COA_TYPE + bridge/mock/i18n fallbacks. Retryable missing (5 codes); unconditional onRetry; no retryAfterMs UI; s054 invert. COPY §8b keys zero hits; en.json no catalog; i18n EN-only correct.

## 10. Security

B1/B2/B18-9 hold; no .env/server/telemetry/secrets. Scans narrow (secret 6 patterns; telemetry src-only; license name-only, no SBOM). Argon2/AES/keychain/HMAC/license implemented native-unverified. Recovery/connectors/diagnostics/updater/storage-relocation not built. Updater endpoint Warzonesiddiki + pubkey "". Pending list §5 in subagent report.

## 11. Tests/DoD

TS ~100 suites strong; Rust mod tests unexecuted. Coverage thresholds not in `check`; coverage-gate.mjs unwired; critical 5 files only; no Rust llvm-cov; no waiver file. Missing: migration rollback, import 2M/ZIP/500k native, connectors httpmock, consolidation/dump/backup/export oracles, gl/drivers/statements/consolidation/connectors/model/exports/audit/security/packs fixtures. E2E 6 files, missing UF-003/006/012 + branches; 1 OS chromium only; no tauri-driver. A11y per-screen only. Perf 2/30 metrics, extrapolated.

## 12. Packs/B15

12/12 validate. Spec violations: logo_ref/seed_sql/assets 0/12; default_calendar example/enum/data drift; sections 0/12; formula/bands 0/48; links [] 36/36; rollup.maps [] 12/12; validator misses KPI/formula/layout/seed/checksum. Builder emits invalid driver types + partial files. B15: no engine fork; 1 UI smell (STARTER_COA_TEMPLATES).

## 13. B7 audit

Mechanism compliant. With audit: list in report. Gaps: (1) change_pin no audit/gate, (2) collection export/import audit-less, (3) audit.export_dataroom no audit + policy inconsistent, (4) 5 mutations bypass read-only, (5) open/unlock timestamp touches unaudited, (6) company.delete excises trail, (7) driver.set_value no locked check, (8) license.request_file sidecar, (9) dataroom doc drift + missing audit_id.

## 14. 5-states/B18

Compliant: S-030/031/032/056/070/071/075. Missing: S-010 (worst), S-062/063/064 no success, S-033/034/040 simulated, S-047/048/055 constants, read-only almost everywhere. Invented: s033 auth/sync, s034 audit claim, s040 CRUD, s060 GL decomposition, s055 CSV, s054 fake load, s041 permanent disabled, s052 no-title, s072 sample phrase. Disabled-title minor gaps. No rendered placeholder; 1 code TODO.

## 15. Build health

`check` omits fmt:check/critical/e2e/coverage-gate/schema/link/cargo/preflight. lint/typecheck src-only. BROKEN lucide-react@1.37.0 (latest 1.28.0). Suspicious @types/node@26. Vitest 4 behind v5. Dual lockfiles. Specta promised, hand-mirrored. Updater pubkey empty. CSP ok. Vitest thresholds razor (80.07 vs 80). Playwright chromium only. Gates sound but coverage-gate/schema/link unwired; build-desktop has --skip escapes + fmt path divergence. Native unverifiable; CI disabled.

## 16. ADRs

Waiver fingerprint code+API agree, DECISIONS silent (message-embedding orphans, no fingerprint column, WAIVER_ALREADY_RECORDED unchecked, 10-200 unenforced). ADR-011 understates read-as-data. ADR-010 understates report-not-exception; export persists health run (undocumented) + primary-model .ok() swallow. ADR-002/014/015/018/022 contradicted or unbuilt. Updates needed: 011,010,015,002,014,022 + KI-012/017/018 RFCs.

## 17. Glossary

Prompt terms clean. Live debt H1-H12 + M1-M2 (Workbook, Upload, Sync, Metric, What-if, Recalc, Bridge/Command, GL account, Plan, Workspace/Entity/Department, Multi-Entity, Secret/Vault/Password, Overview/Decimals/Category/Attribute/Tag, Transaction/Journal bleed).

## 18. Offline/perf/a11y/i18n

Offline implemented; pending update/diagnostics/relocation/.fpa lock/archive/Vault/ZIP/connectors/export/health-gate/keychain. Perf spec vs 50k/10k only; 50-BU/1M/500k-native/2M-mem/watchdog/startup/audit/autosave/export/bundle pending. AG Grid client-only; tanstack installed zero-imports; S-070 paginated not virtualized. A11y per-screen only; sweep/keyboard/zoom/motion/PDF pending. i18n EN-only + 12 locales correct; V-011 translations/RTL/CJK/auto-detect pending. 10M archive KI-009; OS notify present-but-no-surface.

## 19. Docs traceability

64 files on disk == 64 rows (coincidental 64==64 swaps README for DOCS-INDEX). link-check --strict FAIL 2x BENCHMARKS file:///. Matrix header stale (54/60 vs 64). DOCS-INDEX header stale (61 vs 64), wrong script name, stale ~70 commands, map ends at row 39. docs-verify presence-not-equality, banned scan 3 terms only. 7 root .md unindexed (by scope), docs-index.json gitignored yet required.

## 20. Tech-debt P0-P2

P0: 2,642-line uncommitted tree, no CI, bench mislabel + extrapolation, READY vs TODO. P1: stale CONTINUE-PROMPT, catalog drift, core-loop PARTIAL. P2: README gate omission, ANALYSIS historical, coverage/ HTML + thin margin.

## 21. Work plan for 30 agents (partitioned, no overlap)

See task prompts: docs-link, DOCS-INDEX, matrix, README, CONTINUE stamp, s047, s060, s051, money.rs, money:ast, error batches x3, bridge/retry, StatePanel, B7 x4, schema-check, schema-docs, S-010, S-033/034 gating, S-060 drill, S-003, glossary x2, builder/packs, build-health.
