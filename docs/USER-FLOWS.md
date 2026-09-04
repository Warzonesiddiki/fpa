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

1. **S-030 Import Hub** → "GL Dump" tab → drop `SAP_GL_Aug2026.xlsx` and run the real
   Company-scoped `import.parse` command.
2. S-030 reports parsed sheets/row counts, encoding, source hash, size, and headers, then hands the
   same ephemeral `parse_id` working set to **S-031 Mapping Wizard** at `/app/import/map`.
   `import.parse` does not return a delimiter value or raw source samples, so S-031 does not invent
   either.
   - *Branch:* unreadable file → `IMPORT_FILE_UNREADABLE` → instructions; never partial parse.
   - *Branch:* `.zip` → currently rejected by the registered parser and excluded from the picker;
     one-workbook ZIP support is explicitly gated rather than simulated.
3. Normalize: user explicitly chooses the versioned rules. `FY26-P08` stays on the documented
   parser; optional `MMMYY` maps `AUG26` → `2026-08`; account `4100-00` → `410000` only when the
   remove-hyphens rule is selected. Codes remain text and keep leading zeroes.
4. Map: source headers → Period/Account code/Debit/Credit (or Amount) and optional Dimensions.
   Canonical headers may select bundled `canonical-v1` with no write. A custom same-name save uses
   audited `import.map.save_v1`, keeps the Company-scoped mapping id, and advances `vN`.
   Saved-template loading/history is unavailable because the locked command catalog has no mapping
   list/load command; S-031 visibly gates it rather than claiming to load "SAP GL dump v3".
5. Validate through the registered `import.validate {parse_id,mapping_id}` path. S-031 reports the
   exact mapping version and valid mapped row count, then separates HARD from WARNING and row scope
   from batch scope. An unmapped account such as `99999` is HARD; a repeated non-empty posting
   reference on another valid row is the currently implemented WARNING. Missing names are not
   fabricated as findings.
   - *Branch HARD:* the later Tie-Out/Commit path is blocked. S-031 offers only Edit mapping or
     Return to Import Hub to correct/re-select and re-parse the source; there is no fake account
     creation, row-remap, exclusion, or acknowledgement action.
   - *Branch expired parse:* `IMPORT_PARSE_EXPIRED` shows “This parse session expired. Re-run the
     import.” and returns to S-030; it never retries the expired id.
6. Preview: at most the first 50 **valid mapped** rows plus counts, formatted from integer minor
   units. Invalid raw rows are represented by HARD findings and are not reconstructed in the UI.
7. **S-032 Tie-Out:** the registered Rust command reports exact integer-minor-unit debit/credit/
   difference totals, valid rows, currency, mapping version, source hash, and only source rows it
   can actually attribute by posting reference.
   - *Branch balanced:* a valid batch name enables authoritative Commit.
   - *Branch unbalanced:* Commit remains engine-blocked. The user may select only an attributed row
     and must enter a reason. Because `import.tieout` accepts no exclusions, the browser does not
     invent adjusted totals; `import.commit` reapplies the exclusions and reruns validation and
     Tie-Out before it can write anything.
8. Commit batch `2026-08-30_001`: one immediate transaction persists retained GL/IC rows and an
   HMAC audit event containing SHA-256, mapping id/version, exact totals/currency, batch name, and
   every excluded line/reason. A duplicate hash hard-fails with `IMPORT_BATCH_HASH_EXISTS`; the
   locked catalog has no override action.
9. Return to **S-030**: registered, Company-scoped history shows exact persisted terminal metadata
   in 25-row pages. A currently committed row may be rolled back with a required reason; Rust
   deletes only that batch's facts, preserves its terminal history row, and links to the strictly
   older committed batch of the same kind. Audit-degraded sessions can inspect but cannot mutate.
10. Post-verify in **S-054/S-060/S-070** remains a later milestone. M2-4 does not fabricate a
    Variance route from Commit success. **Success target:** monthly actuals loaded < 5 min.

**Current implementation boundary (M2-4):** steps 1–9 are reachable through typed production IPC,
with stale Company/source/mapping/Tie-Out/history/rollback responses invalidated. Validation and
Tie-Out are read-only; Commit and rollback are transactionally audited and blocked by a broken
audit chain. Warning acknowledgement, duplicate override, post-exclusion preview, and Variance
navigation are not catalogued and are not simulated. The current parser remains synchronous and
in-memory, with no progress/cancel command, ZIP support, or 500k benchmark evidence. Source Vault
persistence is also gated: `source_files` is metadata-only and there is no compressed payload
mutation plus authenticated Company-container reseal path, so no plaintext or sidecar copy is
written.

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
4. **S-045 Headcount**: 18 FTEs, 2 hires; comp 100% → 120% with benefits. The schedule write
   returns `schedule_id`, `recalc`, and a positive `audit_id`; the browser renders the exact
   Decimal-string/day-count preview only after that audited command succeeds.
   - *Branch:* hire date before/after the loaded fiscal horizon or invalid termination window →
     `HC_DATE_INVALID`; retain the form and correct the date.
   - *Branch:* same role and cost center overlaps in a fiscal period → `HC_OVERLAP` with the two row
     ids; revise the schedule rather than silently replacing a row.
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
4. **Consolidation settings (S-021 BU setup, S-022 Transit Map — group scope S-061/S-060)**: Group Rollup Maps per BU; FX rates (average/closing per period, OCI policy); IC Tags in mappings.
   - *Branch:* IC Line unmatched → `IC_UNMATCHED` → consolidation blocked; pair or classify.
5. Run consolidation → progress; post-run: IC Tie-Out Check, Group BS tie, eliminations report.
6. **S-061 Segment Report** + **S-060** group statements + SoCE with NCI.
   - *Branch:* translation pending → `SEGMENT_TRANSLATION_PENDING` banner; re-run with complete rates.
7. **Success:** group numbers drill to BU → Account → GL Line; Board Pack with segment page.

---

## UF-007 · Scenario What-If + Goal Seek (Alex) · P1

1. **S-050**: Base = Draft → drive values → Approve → Lock (Version v1 created, immutable).
2. Duplicate → "Upside" (Draft); set reps 6 → 8.
   - *Branch:* editing Locked Base → `MODEL_CELL_LOCKED`; create Version instead.
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
