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
| Import parse/mapping/validation working set | active Company | ephemeral Zustand hand-off (`filePath`, typed parse facts, `mappingStatus/id/version`, `validationStatus/error/result`) + native in-memory parsed rows | On Company/source/kind/mapping change, app-process restart, the native 30-minute parse TTL, or a newer parse/mapping/validation request token. Validation is read-only; expiry returns to S-030 to re-parse and no progress checkpoint/resume is implemented. |
| Import Batch list + statuses | global | persistent DB target; no registered typed `import.history` read cache/UI yet | On `import.commit`/`rollback`, connector `sync` completion once the read side exists |
| Connector health | global | persistent (DB `connectors`) + ephemeral last-pull | On sync run end, auth expiry |
| Mapping templates | active Company | latest body persistent in `mapping_templates`/`mapping_columns`; current S-031 selection ephemeral in import store; historical definitions in HMAC audit events | Same-name save/version bump; no catalogued list/load/history command or template cache |
| Active Company/Model + assumption register | session + global | active model id from Company lifecycle; persistent (DB `assumptions`, `assumption_values`) + read cache | Company open/unlock selects the model; on `assumption.list`/`upsert`; usage cache invalidates after a name change |
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
├── import.ts              # Company-scoped S-030 parse + S-031 mapping and validation working set
├── assumptionsStore.ts    # versioned register + exact period values + usage cache
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
6. Cross-store events are consumed only by their owning store. `audit:event`, `recalc:done`, `connector:status`, and `license:changed` are catalog targets; `import:progress` is **not registered or emitted by the current parser**, so the import store never fabricates it.

## 3. RACE & COHERENCE RULES (zero-compromise)

| Race | Rule |
|---|---|
| Two rapid cell edits on same cell | Serialize via queue; last-write-wins only after both recalc responses; never interleave |
| Import commit while grid editing | Commit takes a model-level Snapshot; edits re-applied on top with conflict dialog if line changed |
| Undo during background recalc | Undo is disabled while recalc in flight (button state); no half-applied states |
| HMR/reload/app restart during Parse/Map | The parse registry and Zustand working set are ephemeral; return to S-030 and re-parse. No checkpoint/resume command exists. A later `import.commit` still guards duplicate source hashes. |
| Company/source/mapping changes while parse, mapping save, or validation is in flight | Independent monotonic request tokens invalidate late responses; validation also rechecks parse id, mapping id, and mapping version before publishing. Stale data cannot repopulate a changed Company/source/mapping. Native mapping writes derive Company from the writable session; validation performs no write. |
| Lock scenario while worker has dirty cells | Flush or discard prompt before lock (audited); lock never applies over unflushed edits silently |
| Export during partial recalc | Export waits for recalc quiescence (max 500ms) or blocks with `RECALC_IN_FLIGHT` |
| Second instance | OS file lock → read-only, zero writes |

*Referenced by: ARCHITECTURE.md, CODING-STANDARDS.md, ERROR-HANDLING.md, FEATURE-TRACEABILITY-MATRIX.md.*
