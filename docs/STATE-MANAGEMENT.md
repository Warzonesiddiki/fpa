# STATE-MANAGEMENT.md

> OneFP&A · v1.0.0 · **Table: state item → scope → storage → invalidation rule.**
> Scope: `global` (app-wide) / `local` (component/screen) / `server` — **no server exists**; mapped `persistent` (SQLite) vs `ephemeral` (in-memory) vs `cache` (derived).
> Rules: one owner per state (B14); no duplicate state between stores; dirty-write coherence; money never stored as float anywhere.

---

## 1. STATE TABLE

| State item | Scope | Storage | Invalidation rule |
|---|---|---|---|
| Session (unlocked, session_token) | global | ephemeral (Rust memory only — never UI-localStorage) | On `session.lock`, auto-lock, app close; re-unlock required |
| Current Company ID | global | persistent (settings, app scope) | On `company.open` failure / file moved |
| Current Model ID / Scenario ID / Period IDs | global | ephemeral (UI router + store) | On ScenarioLock (must create Version), model switch, period calendar change |
| Model Sheets + Lines (structure) | global | persistent (DB `model_sheets`, `model_lines`) — cached in store | Invalidate on `model.cell.set.v1` recalc response (structure rarely changes: sheet add/rename event) |
| Cell values (visible window) | local (grid) | cache — shadows DB; source of truth = DB after each `model.cell.set.v1` | On recalc response, undo/redo, scenario switch; window scroll evicts (virtualized) |
| Dirty cell queue (pending writes) | local (grid) | ephemeral | Flush on commit, blur, save, lock, app close (with confirm) |
| Recalculation status (dirty cells, cycles, duration) | global | ephemeral | On recalc completion / edit enqueue |
| Formula worker instance (HyperFormula) | global | ephemeral (webview worker) | Rebuilt on Model/Scenario switch; disposed on lock |
| Import pipeline state (stage, pct, row counts) | global | ephemeral + progress persisted in `import_batches` for resume | On commit, cancel, app restart (resume from checkpoint) |
| Import Batch list + statuses | global | persistent (DB, read cache) | On `import.commit`/`rollback`, connector `sync` completion |
| Connector health | global | persistent (DB `connectors`) + ephemeral last-pull | On sync run end, auth expiry |
| Mapping templates (list) | global | persistent (DB, cache) | On template save/version bump |
| Scenario list + states | global | persistent (DB, cache) | On create/duplicate/approve/lock; state changes pushed by Rust event |
| Scenario Version list | global | persistent (DB) | On lock/export/import |
| Audit Trail feed (recent) | global | persistent (DB, cache, virtualized) | On any event (server push via Tauri event `audit:event`); pagination for old |
| Dashboard KPIs & charts data | local (dashboard) | cache (computed via `statement.get`/`kpi`) | On period change, recalc, scenario switch, data import |
| Variance / Attribution view | local (analysis screen) | cache | On period/compare change; attribution data missing → `not attributable` |
| Report Layout being edited | local (builder) | ephemeral; saved layouts persistent (DB) | On save/version; broken refs → HARD |
| KPI definitions | global | persistent (DB) | On `kpi.define`/pack update |
| Alerts (center) | global | persistent (DB) + ephemeral unread count | On rule fire, dismiss, rule change |
| Health Check findings | global | persistent (DB, latest run) | On `health.run` completion; waivers update |
| Theme / density / locale format | global | persistent (settings) | On change |
| License state | global | persistent (DB `licenses`) + ephemeral cached verify | On unlock/startup verify, activation, expiry boundary |
| Backup status list | global | persistent (DB) | On backup/restore/rotation |
| Undo/redo stack | local (grid + model) | ephemeral (command pattern; 100 steps; model-level snapshot refs) | On scenario/model switch, lock (cleared), restore/migration |
| Left drawer / right drawer / modal stack | local | ephemeral | On close/navigation |
| Input Collection statuses (contributors) | global | persistent (DB via collection imports) | On export/import/conflict resolution |
| First-run wizard draft | global | ephemeral (session only; restart = resume from persisted Company state if created) | On completion, cancel |

---

## 2. STORE ARCHITECTURE (exact)

```text
src/stores/
├── sessionStore.ts        # session, company, lock (ephemeral)
├── modelStore.ts          # model/sheets/lines/current scenario+period (cache of DB)
├── gridStore.ts           # visible cell cache + dirty queue + undo stack (virtualized)
├── importStore.ts         # pipeline progress + batches + mapping list
├── connectorStore.ts      # health, runs, auth status
├── scenarioStore.ts       # scenarios, versions, states
├── analysisStore.ts       # variance/attribution/FVA/alerts view
├── reportStore.ts         # statements, layouts, kpis, board pack state
├── governanceStore.ts     # audit feed, health, security, license, backups
└── uiStore.ts             # theme, density, drawers, modal stack, toasts
```

**Rules:**
1. Stores never hold Money math results as floats from IPC — values are `i64`/string; display formatting only via `moneyFormat` (decimal.js).
2. Stores are read-through caches: source of truth = Rust/DB; every IPC response invalidates the relevant store slice (never full-store refetch except on explicit "refresh").
3. No writing to DB from stores — mutations always `invoke` (single write path, audit guaranteed).
4. Zustand selectors are memoized; grid virtualization means the grid store holds only the visible window (≤ 5k cells), not 1M.
5. Undo is command-based (operator pattern) + occasional model snapshot refs; undo never crosses a lock boundary.
6. Cross-store events: `audit:event`, `recalc:done`, `import:progress`, `connector:status`, `license:changed` — typed Tauri events, consumed only by owning store.

## 3. RACE & COHERENCE RULES (zero-compromise)

| Race | Rule |
|---|---|
| Two rapid cell edits on same cell | Serialize via queue; last-write-wins only after both recalc responses; never interleave |
| Import commit while grid editing | Commit takes a model-level Snapshot; edits re-applied on top with conflict dialog if line changed |
| Undo during background recalc | Undo is disabled while recalc in flight (button state); no half-applied states |
| HMR/reload during import | `import.parse` checkpoints; resume with same hash (no duplicate commit) |
| Lock scenario while worker has dirty cells | Flush or discard prompt before lock (audited); lock never applies over unflushed edits silently |
| Export during partial recalc | Export waits for recalc quiescence (max 500ms) or blocks with `RECALC_IN_FLIGHT` |
| Second instance | OS file lock → read-only, zero writes |

*Referenced by: ARCHITECTURE.md, CODING-STANDARDS.md, ERROR-HANDLING.md, FEATURE-TRACEABILITY-MATRIX.md.*
