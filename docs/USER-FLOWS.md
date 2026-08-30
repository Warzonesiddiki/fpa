# USER-FLOWS.md

> OneFP&A · v1.0.0 · Terms per GLOSSARY.md · **Every journey: step-by-step including ALL failure/recovery branches.**
> Screen IDs reference SCREENS-SPEC.md. Error codes reference ERROR-HANDLING.md. Flow IDs (UF-001…) are used by QA-CHECKLIST.md.

---

## UF-001 · First Run → First Working Budget (< 10 min) · P0

1. Launch → **S-001 Unlock** (no Company yet → continue).
2. **S-002/D-005 First-Run Wizard** — step 1 Company: name "Acme", choose folder.
   - *Branch:* folder unwritable → `STORAGE_INSUFFICIENT` → choose another folder (no silent fallback).
3. Step 2 Industry Pack: 12 cards; select Manufacturing.
   - *Branch:* Pack corrupt/schema invalid → `PACK_SCHEMA_INVALID` with field path → retry load or fall back to **Generic Core Pack** (always bundled).
4. Step 3 Calendar: pick 12-month, FY start Apr 1.
5. Step 4 COA: use pack COA (preview). Offer "Import COA" or "Edit later".
6. Step 5 Model: name "FY26 Model"; **Plan-Only ON** (no Actuals yet — Alex path); Horizon 1-year; "Finish".
7. **S-040 Model Home** renders with pack Sheets (Revenue, COGS, Opex, Capex, Cash).
8. **S-041 Sheet Grid**: open Revenue; drivers (Units × Price) already wired; type driver values.
9. **S-044 Assumption Register**: set wage_inflation 4.0%; okay.
10. Health chip green → **S-064 Board Pack** preview → export PDF.
11. **Success:** first Budget exists. Toast "Company created" + Audit Trail entry.

**Failure branches** (all recoverable, no data loss): wizard crash at any step → resume same step (draft persisted). Pack load error → core pack fallback. Disk full → explicit error (never partial Company).

---

## UF-002 · GL Dump Import (flagship — manufacturing manufacturing monthly close) · P0

1. **S-030 Import Hub** → "GL Dump" tab → drop `SAP_GL_Aug2026.xlsx`.
2. **S-031 Mapping Wizard** Parse: 3 sheets, 48k rows, encoding UTF-8, delimiter auto.
   - *Branch:* unreadable file → `IMPORT_FILE_UNREADABLE` → instructions; never partial parse.
   - *Branch:* zip contains multiple files → file picker with warning.
3. Normalize: period codes `FY26-P08` → P08 confirmed; account `4100-00` → `410000` (normalization rule shown).
   - *Branch:* ambiguous period `2026-08` (calendar vs fiscal) → WARNING requires explicit choice.
4. Map: columns → Account/Period/Debit/Credit/Dimension. Load saved template "SAP GL dump v3" → auto-fills.
5. Validate: 2 HARD (unmapped account `99999`, duplicate invoice # row), 12 WARNING (missing names).
   - *Branch HARD:* unresolved → commit blocked; fix mapping or exclude-with-log (never silent).
6. Preview: first 50 rows + counts; user scroll-checks.
7. **S-032 Tie-Out:** debits ₹41,283,000.00 vs credits ₹41,283,000.05.
   - *Branch:* diff ₹0.05 → exact row highlighted (one credit line rounding) → user selects "Exclude row (logged)" → tie passes; excluded row retained in batch metadata + Audit Trail.
8. Commit: batch `2026-08-30_001`, SHA-256 shown, mapping version v3, 47,999 rows.
9. Post-verify: **S-054 Variance** for P08 — Actuals appear; **S-060 P&L** ties; Health Check green; **S-070 Audit** shows batch.
10. **Success:** monthly actuals loaded < 5 min.

**Fallback path (always available):** any connector failure → Manual Import; any file failure → "Download GL dump from your ERP following the GL Template" (help link).

---

## UF-003 · Connect QuickBooks (Small-business SaaS path) · P0

1. **S-033 Connector Manager** → QBO card → "Connect".
2. OAuth: system browser opens → user authorizes → callback.
   - *Branch:* user cancels → card returns to "Not connected"; no partial state.
   - *Branch:* token expired at refresh → `CONNECTOR_AUTH_EXPIRED` → "Reconnect" (previous data intact).
3. Credential stored **only** in OS keychain (S-072 status shows "OS keychain: OK").
4. Choose scope (COA + Transactions), Sync Run.
   - *Branch:* 429 rate limit → Rate Limit Policy backs off; 3 failures → `CONNECTOR_RATE_LIMITED`, paused; user may "Use Manual Import".
5. Sync commits as Import Batch; connector health green.
6. **Success:** Actuals + COA live; reconciliation (S-034) available vs GL dump if both exist.

---

## UF-004 · Build Driver-Based Model (Ravi) · P0

1. **S-043 Driver Tables**: add Drivers `units` (volume×rate), `price`, `scrap_pct`, `utilization`, `ftes` (headcount) — ≤7 core rule (advisory).
   - *Branch:* 8th core driver → advisory banner; acknowledge (logged).
2. **S-041 Grid**: Revenue line method = Driver-based → `=units*price`; Opex = headcount × salary; each line shows method chip.
   - *Branch:* driver out of bounds → HARD `DRIVER_OUT_OF_BOUNDS` (set bounds in Assumption Register first).
3. **S-044**: global assumptions (wage_inflation, copper_price).
4. **S-045 Headcount**: 18 FTEs, 2 hires; comp 100% → 120% with benefits.
   - *Branch:* hire date before period start → `HC_DATE_INVALID`.
5. **S-046 Capital**: ₹40M capex, 10-yr SL; debt ₹25M 6.5%.
6. **Success:** P&L, BS, CF, 13-week cash all derive from drivers; Change units → whole model recalculates < 2 s.

---

## UF-005 · Monthly Cycle: Actuals → Variance → Commentary → Board Pack · P0

1. Close tasks (S-053 Close Checklist): all BUs imported (S-030), tie-outs pass (S-032), Health Check (S-071) green.
   - *Branch:* checklist item missing → dashboard alert; variance labeled "incomplete data" until resolved.
2. **S-054 Variance**: period P08; 3-Way (Plan/Commit/Actuals); Attribution (Volume/Price/Mix/FX/Efficiency).
   - *Branch:* attribution data missing → "not attributable" (never fabricated).
3. Add Reason Codes + narrative per major variance.
4. **S-070 Audit** auto-records all.
5. **S-064 Board Pack** → generate → export Excel + PDF.
   - *Branch:* Health Check fails → `HEALTH_CHECK_BLOCKED` list; fix or audited waiver; export remains blocked until green or waiver.
6. **Success:** pack in inbox < 60 min.

---

## UF-006 · Group Consolidation (Priya — 5 BUs, mixed calendars/currencies) · P0

1. **S-004 → S-021**: Group company; add 5 BUs; each select Pack (Manufacturing/Retail/Healthcare/SaaS/FinSvc) + calendar (4-5-4 for retail) + currency (EUR/GBP/USD).
2. **S-022** BU calendar matrix → Transit Periods mapped (retail P06 spans group P05–P06) — explicit mapping screen.
   - *Branch:* ambiguous transit mapping → `CAL_TRANSIT_AMBIGUOUS` → resolve or consolidation blocked.
3. **S-030**: import per-BU Actuals (dumps or connectors); Source Reconciliation per BU.
4. **S-028 consolidation settings (S-061/S-060 group scope)**: Group Rollup Maps per BU; FX rates (average/closing per period, OCI policy); IC Tags in mappings.
   - *Branch:* IC Line unmatched → `IC_UNMATCHED` → consolidation blocked; pair or classify.
5. Run consolidation → progress; post-run: IC Tie-Out Check, Group BS tie, eliminations report.
6. **S-061 Segment Report** + **S-060** group statements + SoCE with NCI.
   - *Branch:* translation pending → `SEGMENT_TRANSLATION_PENDING` banner; re-run with complete rates.
7. **Success:** group numbers drill to BU → Account → GL Line; Board Pack with segment page.

---

## UF-007 · Scenario What-If + Goal Seek (Alex) · P1

1. **S-050**: Base = Draft → drive values → Approve → Lock (Version v1 created, immutable).
2. Duplicate → "Upside" (Draft); set reps 6 → 8.
   - *Branch:* editing Locked Base → `SCENARIO_LOCKED`; create Version instead.
3. **S-052 Sensitivity**: tornado over `reps` ±25% (bounds from register) → impact chart.
   - *Branch:* out-of-range → `SENSITIVITY_OUT_OF_BOUNDS`.
4. Goal Seek: target `Revenue P12` = ₹300M, solve `reps` → 9.4 (converged, iterations shown).
   - *Branch:* no convergence → `GOAL_SEEK_NO_CONVERGE` (last value, never fake).
5. **S-051 Compare**: Base v1 vs Upside v1 — cell diff; export.
6. **Success:** decision-ready what-if packet.

---

## UF-008 · Input Collection (Sales Director contributions) · P1

1. **S-053 Input Collection** → "Export input sheet" (Sales drivers per month).
2. Director fills Excel; returns file.
3. Re-import → merge w/ audit; per-cell attribution.
   - *Branch:* structural edit (new rows) → diff view; map or reject; never silent.
   - *Branch:* conflict (two contributors same driver) → conflict queue; choose or average; recorded.
4. **Success:** values in driver tables w/ attribution.

---

## UF-009 · Forecast Accuracy Feedback Loop · P2

1. Monthly: save Forecast Version (auto on Lock).
2. After Actuals: **S-055 FVA** → MAPE/bias/hit rate by line.
   - *Branch:* < 3 versions → "Need ≥3" empty state.
   - *Branch:* restatement later → flag + recompute.
3. Review → adjust drivers/driver count.

---

## UF-010 · Security & Backup: Setup, Backup, Restore · P0

1. First run (S-072/D-007): set PIN (≥8 chars, policy); Reveal Recovery Phrase (12 words, user writes down; app warns "cannot be recovered").
   - *Branch:* user declines phrase → 2nd warning; logged; path marked non-recoverable (KNOWN-ISSUES design decision).
2. **S-074**: "Backup now" → encrypted `.fpa-backup` passphrase-protected; rotation (daily×30) visible.
   - *Branch:* disk full → `BACKUP_DISK_FULL`; no Company mutation.
3. Restore: pick backup → passphrase → **pre-restore Snapshot** → transactional restore → Audit entry.
   - *Branch:* passphrase wrong → `BACKUP_PASSPHRASE_INVALID` (no data change).
4. **Success:** verified restore in Demo Company first (best practice prompt).

---

## UF-011 · Unlock & PIN Recovery · P0

1. **S-001**: PIN entry → wrong → generic error; 5 fails → 30s lockout.
2. "Use Recovery Phrase" → 12-word entry → verify → **PIN reset** (new PIN set) → unlock.
   - *Branch:* phrase wrong twice → lockout + "contact support" path (offline manual verified by activation file).
3. **Success:** Company decrypted, Audit records unlock/reset (no PIN stored).

---

## UF-012 · License Activation (offline) · P0

1. **S-073**: status "Not activated" → "Generate request file" (Company fingerprint).
2. User sends file to vendor (email/portal — out of app).
3. Vendor signs (Ed25519) → returns `.fpa-license`.
4. Load the license file → verify → activated; grace period (60d default) documented on screen.
   - *Branch:* bad signature → `LICENSE_INVALID_SIGNATURE` (read-only).
   - *Branch:* machine change → new request file; no data loss.
5. **Success:** full functionality, offline.

---

## UF-013 · Auto-Update & Migration · P1

1. Update available → **D-009** → download (signed) → install.
2. Pre-migration Snapshot → Migration runs (forward-tested) → reopen w/ changelog.
   - *Branch:* migration fails → automatic rollback + recovery next launch (never half-migrated).
   - *Branch:* interrupted (power loss) → recovery restores Snapshot.
3. **Success:** version + schema consistent; backups unaffected.

---

## UF-014 · Export Variants (Excel / PDF / Model Dump / Auditor Data Room) · P1

1. Any Report → **D-003 Export**: type, scope, options (000s, decimals, parentheses), destination.
2. Generate: Excel (formulas preserved where authored), PDF (typst, deterministic), Model Dump (full, re-importable), Data Room (all governance artifacts).
   - *Branch:* Health Check fails → blocked with fix list (never export wrong numbers).
   - *Branch:* formula-injection risk (cell starts with `=` but is text) → auto-quoted + note.
3. **Success:** file + Audit entry (export documented).

---

## FLOW MATRIX (Stage 3 verification)

| Flow | Covers | Screens | Failure branches tested |
|---|---|---|---|
| UF-001 | First run/wizard | S-004, S-002, S-040, S-041, S-044 | 4 |
| UF-002 | GL dump | S-030–S-032, S-054, S-060, S-070 | 6 |
| UF-003 | Connector | S-033 | 3 |
| UF-004 | Model build | S-041–S-046 | 4 |
| UF-005 | Monthly cycle | S-053, S-054, S-070, S-064 | 3 |
| UF-006 | Consolidation | S-021–S-022, S-030, S-060–S-061 | 4 |
| UF-007 | What-if | S-050–S-052 | 3 |
| UF-008 | Collection | S-053 | 2 |
| UF-009 | FVA | S-055 | 2 |
| UF-010 | Backup | S-072, S-074 | 3 |
| UF-011 | Unlock | S-001 | 2 |
| UF-012 | License | S-073 | 3 |
| UF-013 | Update | D-009 | 2 |
| UF-014 | Export | D-003, S-060–S-064, S-071 | 2 |

*Referenced by: QA-CHECKLIST.md, TESTING-STRATEGY.md, FEATURE-TRACEABILITY-MATRIX.md.*
