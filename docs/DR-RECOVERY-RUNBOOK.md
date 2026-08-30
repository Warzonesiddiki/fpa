# DR-RECOVERY-RUNBOOK.md

> OneFP&A · v1.0.0 · **Disaster-recovery runbook for the user's Company data** (local-first → DR = backups + restore + rebuilding; no cloud). RPO/RTO per GLOSSARY RPO/RTO terms. Every step is actionable by a non-technical finance user.

---

## 1. OBJECTIVES (v1.0.0)

| Measurement | Target | Meaning |
|---|---|---|
| RPO (crash) | 0 | WAL + auto-snapshot before mutation — a process crash loses at most the uncommitted in-flight edit |
| RPO (file loss/disk failure/theft) | 24 h | automated encrypted Backup once/day (configurable) + manual "Backup now" |
| RTO (2 GB Company, local SSD) | ≤ 15 min | restore from Backup (encrypted, passphrase) to working Company |
| RTO (rebuild from scratch) | ≤ 2 h | reinstall → restore Backup → verify Health Check → reopen |
| Off-air (no network) | full function | DR never requires internet |

## 2. PROTECTION LAYERS (what exists)

| Layer | Artifact | When written |
|---|---|---|
| 1. WAL + snapshot | `snapshots` (pre-mutation) | before every import/restore/migration/lock; keeps crash consistency |
| 2. Encrypted Backup | `.fpa-backup` (passphrase-protected) | manual + scheduled (default daily 02:00 local, keep 30) |
| 3. External copy | user-chosen second location (USB/cloud folder they control — their choice) | recommended in S-074; never automatic cloud upload (B18-9) |
| 4. Offline bundle | installer + pack + demo | for air-gap rebuild |
| 5. Source Vault | original GL dumps (inside Company, archived per retention) | at import time |

## 3. RECOVERY PROCEDURES

### 3.1 Crash / app won't start
1. Relaunch → pre-migration/rollback logic auto-runs (F-036): if migration incomplete → restores Snapshot.
2. If still failing: open recovery mode (hold Shift at launch → "Recovery" — integrity check, snapshot list, backup list).
3. Choose: restore last good Snapshot (minutes) or restore full Backup (passphrase) → Health Check → continue.
4. Export Local Diagnostics for support if steps fail.

### 3.2 File corrupted / deleted / stolen
1. Reinstall (official signed installer).
2. Unlock with Recovery Phrase if needed (or new setup → create Company → **Restore from Backup**).
3. Verify restore: Company name, last backup date, Audit chain verified, Health Check green → **demo-tasks check** (open statements; run a tie-out).
4. If the Backup is older than needed (e.g., 25-h gap), re-import the latest GL Dump from the Source Vault (still in the backup) or from the ERP → creates a new Actuals batch (history preserved).

### 3.3 Password/passphrase forgotten
- PIN forgotten → Recovery Phrase (AUTH-SPEC §2.4).
- Backup passphrase forgotten → restore impossible (by design); warning at creation; **the user should store the phrase separately** (paper/OS secret manager). No vendor recovery.

### 3.4 Migration failure during update
1. App rejects update at start; auto-rollback to previous version (F-036).
2. Company untouched (pre-migration Snapshot); user may retry after fix release.
3. If the app is stuck half-migrated (power loss) → next launch recovery restores the Snapshot; if it still fails, use Backup.

### 3.5 Consolidation/statement corruption (data-level)
1. Do NOT export. Open S-071 Health Check → list findings.
2. Fix via waive? **No** — fix the underlying mapping/import (never waive a data-integrity finding purely to export; waiver requires reason and is audited).
3. Re-run import from Source Vault if the issue traces to a batch; roll back the batch if needed (`import.rollback`).

## 4. RESTORE DRILL POLICY

| When | Drill |
|---|---|
| Before every release | Restore a 2 GB encrypted backup to a fresh profile in CI (headless) — automated |
| Every 90 days (user guidance) | S-074 "test restore" prompts user to restore into a Sandbox Company and compare a known KPI |
| After any major Migration | CI migration-upgrade drill: old snapshot → migrate → verify statements tie |

## 5. DISASTER CHECKLIST (printable, in-app under S-074 "Recovery guide")

- [ ] Encrypted Backup exists (auto) + one manual copy in a **second location**
- [ ] Backup passphrase stored separately from the file
- [ ] Recovery Phrase written down (offline) — not only in a password manager
- [ ] Last restore drill < 90 days ago
- [ ] Source Vault retention + latest GL Dump available from ERP (re-import path)
- [ ] License activation file stored (for machine change/DR)
- [ ] Local Diagnostics export trained (support path)

## 6. FALSE-ALARM SCENARIOS

| Symptom | Reality | Action |
|---|---|---|
| "File won't open" after update | migration pending/rollback | relaunch; recovery mode if needed |
| "Data missing" after restore | restored an older Backup | restore the newest; check timestamps + audit |
| Statements don't tie after DR | import incomplete (batch rolled back) | re-import latest batch; never "fix" by hand |
| Health Check red after restore | waivers/restore mismatch | fix mappings; waive only with reason |

*Referenced by: F-037, S-074, KNOWN-ISSUES KI-001, COMPLIANCE-DATA-SOVEREIGNTY.*
