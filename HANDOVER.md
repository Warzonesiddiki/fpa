# OneFP&A — Session Handover

> Read this file first, then continue the next milestone task. It is written to be self-contained:
> state, design decisions, gates, and pitfalls. The current session shipped **M6-8a (F-033) Audit
> Trail** — the `audit.list` native read handler (`src-tauri/src/commands/audit.rs`) plus the S-070
> Audit Trail screen at `/app/governance/audit` — on working branch `arena/01a07141-fpa`. It is
> **PARTIAL/NATIVE-UNVERIFIED**: this sandbox has no Rust toolchain and no network to install one, so
> `audit.rs` (like `statement.rs` and `alerts.rs` before it) has never been compiled. M3-6's native
> follow-on was verified on the Rust-equipped Windows desktop 2026-09-04 and is ✅ DONE (TASKBOARD §12).
> The authoritative tracker is the root `TASKBOARD.md` (82 files / 1002 tests; JS gates pass; native
> gates unavailable in-sandbox).

---

## 0. START HERE (do this exact order, then STOP and read §1–§4)

1. `cd /home/user/fpa && git status --short && git log --oneline -1`
   Clean tree expected. If refs reset (see §6 Recovery), recover before any edit.
2. `ls node_modules | wc -l` — if `0`, run `npm install`. **The sandbox wipes `node_modules`
   mid-session** (it is excluded from snapshots). This is normal, not an error. Expect it to
   happen again _during_ your session: if `npx vitest` suddenly reports `eslint: not found`,
   reinstall first and re-run the gates — do not chase phantom code failures.
3. Baseline gates (~8 min) — all must PASS before you edit:
   `npm run check && npx vitest run --coverage && npm run build && npx prettier --check .`
   Expect the current **82 files / 1002 tests** after the M6-8a slice. Counts drift as tests are added —
   the invariant is that every gate PASSES on a clean tree, not the exact number. The global coverage
   gate sits at branches 80.07% against a threshold of 80 — **new pages/stores need their own tests**,
   or it will dip red again.

---

## 1. STATE OF THE WORK

### Latest — M6-8a Audit Trail: `audit.list` + S-070 (2026-09-05, `arena/01a07141-fpa`)

- **Why this unit:** it was the highest-value _unblocked_ row left. `audit.list` sat in the locked catalog with no handler,
  S-070 was ❗ TODO, and F-033 is a P0 story (US-034) whose data (`audit_events`) was already fully written by every other
  command — so the whole slice could be built against real persisted data with no new schema and no Tier-3 RFC.
- **Contract (`docs/API-SPEC.md` §15, new):** `{company_id, filters?, page}` → `{events[], chain_status, meta, facets}`.
  Every filter field maps 1:1 to an `audit_events` column; blank/whitespace means _absent_, never a literal empty match;
  `from`/`to` are inclusive ISO-8601 bounds.
- **The one design decision worth knowing:** a broken chain is returned as **data** (`chain_status {verified,
broken_at_seq, event_count}`), not as a thrown `AUDIT_CHAIN_BREAK`. US-034 requires the tamper to be _shown_ — if the read
  path threw, an auditor could never inspect the very log that failed verification. `AUDIT_CHAIN_BREAK` as an error stays
  reserved for mutations (`require_session_write`), which is where read-only mode is enforced (AUTH-SPEC §2.5). Do not
  "fix" this into an error path.
- **Rust (`src-tauri/src/commands/audit.rs`, registered in `lib.rs` → 62 handlers):** read-only (zero writes against
  `audit_events` — B7); Company-scoped or `VALUE_INVALID`; count + page + facets on ONE transaction snapshot (the
  `import.history` discipline); stable `seq DESC` window at 50/page; filter values are **bound**, never interpolated;
  facets are computed over the WHOLE chain so a zero-result filter is always reversible from the toolbar; verification
  delegates to the existing `company::verify_company_chain` keychain replay (ADR-011/B14 — no second implementation);
  `before_json`/`after_json` are returned verbatim because they are the exact hashed bytes (re-serializing would break
  byte-for-byte verifiability, and it keeps money off every parse path — B3/B6). 8 unit tests included.
- **TS:** `AuditListArgs`/`AuditListData`/`AuditEventRecord`/`AuditChainStatus`/`AuditFilters` in `src/api/schema.ts`
  (`.strict()` — an unknown filter key is rejected at the boundary); a dev mirror in `src/api/mock.ts` whose fixture is a
  genuinely chain-linked sequence (each `prev_hash` equals its predecessor's `hash`; a contract test asserts it), with the
  chain verdict following the app's single documented tamper trigger (`MOCK_CHAIN_BREAK_PIN`) rather than a random verdict;
  `src/stores/audit.ts` (filter change resets to page 1, pagination guards, stale rows cleared on error).
- **Screen (`src/pages/s070-audit/`, code-split; `/app/governance` now lands on it):** WIREFRAMES-ANALYTICS §S-070 geometry —
  toolbar (date range · actor ▾ · action ▾ · object ▾ · chain chip), event rows (ts · actor · action · object) expanding to
  the verbatim before/after payload + the hash link to the previous event, footstrip with the event count. Five states incl.
  a distinct "No events match these filters" empty with a clear-filters action. **No edit/delete affordance exists anywhere**
  (asserted by a test, not just by omission). Data-Room / Export-log buttons ship DISABLED with an explanatory title because
  `audit.export_dataroom` has no handler (B18-5/7).
- **Tests:** 45 new (19 page incl. 4 axe states, 13 store, 13 contract). Full run: **82 files / 1002 tests**; coverage
  88.11/80.20/87.07/89.95 (≥85/80/80/85); critical 98.52/97.15/100/98.96; lint/tsc/build/prettier/docs:verify 60/42/97/99/
  packs 12/12/money:ast/security all green.
- **Open (why M6-8 stays PARTIAL):** cargo + clippy + fmt over `commands/audit.rs` and a desktop round-trip — **this sandbox
  has no Rust toolchain and no network to install one** (`sh.rustup.rs` and `static.rust-lang.org` both refuse the TLS
  connection), so the native gate is UNVERIFIED, never falsely green. Also open: `audit.export_dataroom` (blocked on the M6-6
  export layer), event archiving for the 10M-event edge case (US-034), and list virtualization (the wireframe says
  "virtualized"; paging at 50/page keeps it correct today, `@tanstack/react-virtual` is already a dependency when the row
  count justifies it).

### Latest — M5-4 Alerts engine + Alerts Center, TS slice (2026-09-05, `arena/01a070a4-fpa`)

- **Contract (locked catalog honored exactly):** only `alerts.list` `{filter}` → `{alerts[]}` and `alerts.create_rule` `{rule}` →
  audited `{rule_id, audit_id}` exist — so Dismiss/Mute-rule buttons ship DISABLED with explanatory titles; enabling them needs new
  API-SPEC rows + schema columns = Tier-3 RFC, never invented commands or local-fake persistence. `ALERT_RULE_INVALID` (422,
  non-retryable, "Alert rule invalid: {detail}") was already catalogued — implemented, not added.
- **Schemas:** `AlertRuleInput` mirrors the `alert_rules` DB CHECK domains verbatim (ops `lt|lte|gt|gte|eq`; severity
  `info|warning|critical`), XOR `kpi_id`/`line_ref` via refine, `threshold_value: DecimalString` only (money never floats);
  `AlertTriggerChain` pins `value`/`threshold` as exact decimal strings. Mock mirrors native `validate_rule` ORDER and detail
  strings — the contract test asserts equality of every message, so drift is a test failure.
- **Store (`src/stores/alerts.ts`):** populated/empty("All clear")/error/loading states; filter changes reload; create errors are
  INLINE (`createError`) and never blank the loaded list; `retry()` re-runs the READ only (no silent mutation replay — B4/audit).
- **Page (`src/pages/s056-alerts/`):** severity-grouped list with h2 sections (axe), expandable trigger chain (button
  aria-expanded), `<time dateTime>` stamps, disabled dismiss/mute, rule form with radio target switch, policy copy as facts
  (digest ≤1/24h · 90-day retention), KPI-evaluation pending note (M6-4/5).
- **Rust (authored, NEVER compiled here):** `commands/alerts.rs` — list fires due rules before selecting (draft scenarios only:
  locked/review/approved history never fires, US-027), dedupe = at most one OPEN alert per rule per UTC day (`date(fired_at) =
date('now')`), 90-day window via `datetime('now','-90 day')`, create = single tx insert + HMAC-chained audit (`next_hash`/
  `audited_hash` pattern from schedule.rs). `core/error.rs` variant + mapping + §H user text. Brace hand gate 34/34 — NOT a compile
  claim. `alerts`/`alert_rules` have NO company_id column (001_initial.sql locked) → rules are per-store; firing resolution IS
  company-scoped (join `models.company_id`); documented in the module header.
- **Tests:** 34 new (16 page incl. axe, 9 store, 9 contract) + 3 schema cases. Full run: 79 files / 957 tests; coverage
  88.05/80.19/87.05/89.84 (thresholds 85/80/80/85); critical 98.5/97.15/100/98.95; check/build/prettier green.
- **Open (why PARTIAL):** cargo + clippy + fmt + desktop round-trip; KPI-target evaluation with M6-4/5; dismiss/mute catalog rows;
  OS-notification opt-in surface (PRD mentions it; nothing was faked); retention pruning (prune job = native concern).

### Previous — M6-1 Statement suite, TS slice + gate restoration (2026-09-05, `arena/01a070a4-fpa`)

- **S-060 page (`src/pages/s060-statements/`):** was broken against the real `StatePanel` API (it passed a
  nonexistent `variant` prop) and failed the installed axe ruleset (missing region-level headings). Now: five
  canonical states; h2-sectioned tables; every monetary value renders ONLY through `MoneyCell`/`formatMinor`
  from engine `amount_text`/minor strings (B6 — no arithmetic or re-derivation in the UI); "Tie-out: Pass/Fail"
  and "Rounding: Exact/Approximate" chips; IFRS/US-GAAP preset with URL round-trip (`?preset=`),
  zero-decimals/thousands toggles + LRA switch; CF/SoCE/segment honestly disabled "(pending)". Preset &
  route-param branches run through `MemoryRouter` fixtures (BrowserRouter+pushState without a matching `<Route>`
  leaves `useParams()` empty — branches silently never executed). 20 + 5 edge tests, axe-clean.
- **Stores/contracts:** `src/stores/statements.test.ts` (13) covers state machine, typed `BridgeError` mapping
  (`STATEMENT_TIE_OUT_FAILED` fix_list detail), stale-row clearing on failed retry, reset, selectors;
  `src/api/statements.test.ts` (11) pins typed args + populated P&L/BS envelopes + `STATEMENT_SOURCE_MIXED`
  dev triggers; new `StatementGetArgsSchema` refine makes `bu_scope.kind:"single"` require `bu_id` (VALUE_INVALID
  at the boundary — +1 schema test). Store edge suites added for FVA (13) and What-if (12); model-history guard
  tests and a bridge `{code: undefined}` normalization test close the coverage gap.
- **Rust (hand-review only — never compiled here):** `commands/statement.rs` flat command arg renamed `r#type`
  (Tauri 2 `unraw()` maps it to the catalog key `type`; struct-destructured single-arg payloads would NOT —
  verified against tauri-macros 2.6.3 `parse_arg`) and `BuScope` switched to internally tagged `{kind:…}` to
  match the wire shape. `npm run check` includes the Rust brace-balance hand gate (26/26) — that is NOT a
  compile claim.
- **Gate restoration:** the tree arrived failing global branches coverage (79.17% vs 80) and prettier (~28
  legacy files + TASKBOARD.md itself). Prettier-synced everything (`pnpm-lock.yaml` added to
  `.prettierignore` — prettier reformats it and `--write` on it is FORBIDDEN), then added the real tests above.
  Final: 76 files / 920 tests; coverage 87.9/80.07/87.03/89.74 (≥85/80/80/85); critical 98.46/97.15/100/98.92;
  build/lint/tsc/prettier/docs:verify 60/42/97/99/money:ast/security all green.
- **Still open (why M6-1 is PARTIAL):** cargo compile + native round-trip for `statement.get.v1`;
  largest-remainder oracle fixtures vs MONEY-ROUNDING-SPEC §3–5; SCREENS-SPEC S-060 elements not built —
  period selector (single/YTD/FY/PY), BU/Group scope UI, per-line decimals/sign style, export (M6-6),
  line drill-down; dev-only trigger paths in `mock.ts` stay dev-only (no padding tests).

### Earlier — M3-6 Headcount/S-045 (F-016), TS slice (2026-09-04) — native since verified; ✅ DONE per TASKBOARD §12

- **Contract:** `model.schedule.upsert` is specialized to `schedule_type: "headcount"` with strict
  row fields and strict `{schedule_id, recalc, audit_id}` success data. `audit_id` is a positive
  integer and is asserted in schema/mock/store tests; the mutation sends the complete validated
  schedule, not a silent local-only edit.
- **Model:** `src/model/headcount.ts` keeps compensation and percentage inputs as Decimal strings;
  it validates ISO/calendar dates and same-role/cost-center overlap (`HC_DATE_INVALID`, `HC_OVERLAP`),
  prorates inclusive active days over period days, spreads annual base across loaded periods, applies
  additive bonus/benefits/employer-load percentages, and applies optional linear ramp before the
  explicit currency output rounding boundary.
- **Store/UI:** `stores/headcount.ts` loads `calendar.preview`, scopes the session cache to the active
  Company/Model, writes through the audited command, and hands driver data to `driver.import`.
  S-045 (`src/pages/s045-headcount/`) has loading/empty/error/success/populated states, typed error
  rendering/retry behavior, org tree, hire/termination table, edit/remove, import hand-off, exact
  proration display, rollups, ARIA semantics, and axe coverage. Route/nav/i18n are wired.
- **Docs:** API-SPEC, SCREENS-SPEC, USER-STORIES, USER-FLOWS, MODELING-METHODS-SPEC,
  FEATURE-TRACEABILITY-MATRIX, ERROR-HANDLING, TASKBOARD, TODO, CHANGELOG, and this handover are
  synchronized. ADR-026 deliberately admits the two headcount codes, taking the canonical catalog
  from 97 to 99; this is not a silent error-code invention.
- **Validation:** `npm run check` (59 files/653 tests; docs 60/42/97/99), `npx vitest run --coverage`
  (89.84/81.72/90.02/92.30), `npm run test:coverage:critical` (98.49/96.98/100/98.72),
  `npm run build`, and `npx prettier --check .` all pass after the final code/docs edits. The matching
  coverage-gate proxy passes at main 89.85/81.73/90.03/89.27 and critical 98.49/96.98/100/98.41. Rust `cargo`/`rustc` are unavailable, so the native handler, SQLite persistence/calculation,
  native HMAC audit wiring, desktop IPC, and cargo tests remain **NATIVE-UNVERIFIED/PARTIAL**. Do not
  mark M3-6 DONE while the browser mock is involved.

### Earlier — M4-2 scenario lifecycle (F-022), PR A/A2/B (2026-09-04)

Typed scenario contract + mock state machine (`model.list`, `scenario.create|duplicate|submit|approve|lock|
reopen|delete`, `baseline.set`), `stores/scenarios.ts`, grid-store `setScenario` + `activeScenarioId()`, the
**S-050 Scenario Manager** at `/app/plan/scenarios` (all 5 states, D-004 lock/delete confirm, written-reason
reopen/baseline-replace, typed inline errors, axe-clean) and the **S-041 ScenarioPicker** (shared read side,
state badge, Manage link, worker rebuild on switch). Gates green: `npm run check` (56 files/628 tests),
coverage 90.22/82.22/90.86/92.58, build, prettier. **Open Tier-3 items** (need a human or a Rust toolchain):
`scenarios.created_at` column absent from DATABASE-SCHEMA (S-050 ships without the Created column —
DECISIONS ADR-023); scenario `kind` not in the catalogued create args; scenario Rust handlers + `model_values`
persistence pending cargo (§6 Recovery).

Merged to `main`: **M0** (`902af9d`), **PR #4** (Rust core: company/coa/calendar/session, 12
commands, `rust_decimal`, HMAC audit chains, `src/api/schema.ts` + `mock.ts`), **PR #5**
(`5733c6b`) = F-004 first-run PIN, **PR #6** (`d8f6a98`) = A02 encrypted `.fpa` container
(key hierarchy PIN→KEK→VK→CEK, checkpoint-then-seal single file, `SESSION_LOCKED` on
`company.create` with an empty vault).

**Merged: AUTH-SPEC §2.5 on unlock (branch `arena/01a05468-fpa`, PR #7 → `ece8b31`).** Commits:

| Commit    | Scope                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| `2bf24d8` | Rust: `core/error.rs` (+`AuditChainBreak`), `commands/company.rs`, `commands/session.rs`, `commands/calendar.rs` |
| `376ef7d` | TS: `schema.ts`, `mock.ts`, `stores/session.ts`, `s004-shell` banner, `en.json`, tests (+9 → 146)                |

### What §2.5 changed (do not re-derive)

- **On every `session.unlock`** (after PIN verify + container header proof) and every
  **`company.open`**, the Company's audit chain is replayed against the keychain-held HMAC
  key (`company.rs::verify_company_chain` → `core/audit.rs::verify_chain`). Result rides the
  session as `chain_broken_at: Option<i64>` (seq of the first unverifiable event).
- **Break semantics = degraded success, not refusal** (`AUDIT_CHAIN_BREAK → read-only +
restore offer`, ADR-011): unlock still succeeds (data may be intact and must stay
  readable), the Company opens **read-only**, and the restore offer surfaces in the UI.
  Payload is **additive** (the API-SPEC table stays at 96 commands / locked shapes):
  `session.unlock` + `company.open` gain `read_only: bool` and
  `integrity: { audit_chain_ok: bool, broken_at_seq: int|null }`; `session.status` gains
  `read_only: bool`. Zod mirrors were extended in the same PR (never let them drift —
  mock↔Rust envelope drift is a tested failure).
- **Writes to the compromised Company are gated in Rust** (`session.rs::require_company_write`)
  returning `AppError::AuditChainBreak` → `AUDIT_CHAIN_BREAK` 409 with the exact
  ERROR-HANDLING §H text and `details.brokenAtSeq`. Currently wired into `calendar.apply` and
  `company.delete` (the only session-company mutations that exist in M1); `company.create`
  intentionally stays open (a fresh Company starts its own fresh chain). Every FUTURE
  session-company mutation must call `require_company_write` first.
- **Per-Company chains (latent defect fixed):** audit prev-hashes chained **globally** across
  companies while `company.delete` excises the deleted Company's events — any interleaved
  history would have broken the surviving Company's chain forever at the first §2.5
  verification. `audited_hash` now scopes by `company_id` (F-033 "surviving Companies keep
  their own chain"); `calendar.apply`, `company.create`, `company.delete` all write
  per-Company. Docs never stated global; the code comment documented per-Company intent.
- **UI (S-004):** persistent `role="alert"` banner with the exact documented
  `AUDIT_CHAIN_BREAK` user text + `Read-only` badge, driven by `sessionStore.readOnly`.
  Never dismissible (tamper evidence is never silenceable, B18-5/6). Content stays mounted
  beneath it — read-only ≠ hidden. The actual `backup.restore` action is M6-9; the banner IS
  the M1 restore offer.
- **Mock:** dev trigger PIN `AuditBrk9!` answers the degraded read-only session (parallels
  `WrongPin9!`); `session.lock`/`company.open`/`company.create` reset the mock flag.
- Rust integrity on unlock otherwise unchanged: app-DB `PRAGMA integrity_check` at open
  (`db::init`) + container header authentication via `container::read_key` (A02) already cover
  DATABASE-SCHEMA §11.1 / SECURITY-CHECKLIST §3.

### Model grid contract (F-012 · `arena/01a0552b-fpa`) — DONE this session

M1 task #2 is green on the contract/Gates side (Rust echo + TS schema/mock + tests). The
HyperFormula worker + S-041 grid UI are explicitly follow-ups (M3-1). What shipped:

- **`model.cell.set.v1`** — args `{line_id, scenario_id, period_id, value?, formula?,
manual_override?}` (API-SPEC §2/§3; **no `model_id`** — the cell is addressed by
  line+scenario+period). Returns `{recalc, cell, audit_id}`. Rust gate = `require_session_write`
  (AUTH-SPEC §3 rule 2) → `SESSION_LOCKED` on a locked session / `AUDIT_CHAIN_BREAK` on a broken
  chain, before any validation. Value-or-formula required (`VALUE_INVALID`, never an empty edit);
  formula `=`-prefixed, ≤2048 chars, whitelist-checked (`FORMULA_UNSUPPORTED_FUNCTION` with
  `details.function`). Money = `MoneyValue::from_decimal` → exact `i64` minor units (B3/B18-2);
  optional Rust-only `currency` defaults `USD` (mirror-only, not in the API args). Cell write is
  HMAC-audited with `model.cell.set.v1` per-Company (before/after `ModelCellPayload`, reuse
  `audited_hash`/`next_hash`/`audit_hmac_key`).
- **`model.recalc`** — args `{model_id, scenario_id}`; **flat** response `{duration_ms,
changed_cells, issues[]}` (API-SPEC §2 list row), not the §3 `recalc` wrapper. Read-only gate
  (`require_unlocked`); no audit. Additive `dirty_cells`/`cycles` are included for the grid.
- **Formula whitelist = 85 functions** mirrored in `src/api/schema.ts` (`SUPPORTED_FUNCTIONS`) +
  `src-tauri/src/core/model.rs`. `findUnsupportedFunction` regex + Rust `function_calls` scan
  (case-insensitive, whitespace-tolerant). Tests guard `FPERIOD`/`CAGR` accepted,
  `LAMBDA`/`sql()` rejected.
- **`core/model.rs`** `recalc_report(dirty, cycles, changed, duration_ms)` sorts/dedups
  `changed_cells`, wraps cycles as `[{path:[…]}]`, emits `issues: []`. `ModelCellStore` is
  `Mutex<HashMap<"scenario:line:period", StoredCell>>` with `get/put/changed_lines/count_for_scenario`.
- **New `AppError` variants** all 422/non-retryable with exact ERROR-HANDLING §E user text:
  `FORMULA_UNSUPPORTED_FUNCTION`, `MODEL_CELL_LOCKED`, `FORMULA_CYCLE`, `REFERENCE_BROKEN`,
  `DRIVER_OUT_OF_BOUNDS`, `HARDCODED_ASSUMPTION`.
- **Mock:** in-memory `modelCells` Map keyed `scenario:line:period`, `modelAuditSeq` from 100
  (assert ≥101), locked check `scenario_id.includes("locked")`, `mockToMinorUnits` pads fraction
  two digits via `parseInt(x,10)` (money-ast clean — no `Number(`).
- **Contract-read discipline:** the first pass had `model_id` in `cell.set` and nested
  `{recalc}` on `model.recalc`; both were removed to match the locked API-SPEC rows and are now
  covered by schema tests (don't re-add them without opening API-SPEC).

### Known gaps (pre-existing; unchanged by §2.5)

- **Restart before first Company:** lands on S-001 with no companies → `/welcome` →
  `security.pin_setup` → `PIN_ALREADY_SET`; and `company.create` needs the vault
  (empty after restart → `SESSION_LOCKED`). Root cause: no app-scope (pre-Company) unlock.
  Fix = `session.unlock` accepting an empty `company_id` + an S-001 affordance to enter the
  PIN when the list is empty (deliberately deferred from A02).
- **`security.pin_setup`'s settings-marker** (`settings` row `audit.security.pin_setup`) is an
  app-scope HMAC marker, not part of any Company chain (documented in `security.rs`). It is
  NOT covered by §2.5 verification (company chains are). Revisit when S-070 audit screen
  (M6-8) defines its display.

---

### M3-1 HyperFormula worker + S-041 grid (`arena/01a0559a-fpa` commit `08de759`) — 🚧 PARTIAL

Shipped in the same PR stream as M3-2 (PR #10 squash `0c0c33d`). The TS-side is **complete and
green** — the **Rust DB persistence is the open blocker**:

- **`src/workers/modelEngine.ts`** — real HyperFormula 3.4.0 graph in a Web Worker
  (`modelEngine.worker.ts`), `loadGrid`/`setCell`/`recalc`/`getGrid`/`getDerived`. Money crosses
  the engine boundary only as `new Decimal(input.value).toNumber()` (documented, non-money float —
  the exact decimal string stays authoritative in `manualAmounts`). YTD/FY derived columns via
  `=SUM(...)`.
- **`src/workers/protocol.ts`** — typed EngineRequest/EngineResponse dispatch (`loadGrid`/`setCell`/
  `recalc`/`getGrid`/`getDerived`/`inspectCell`). **`modelEngineClient.ts`** — single-flight
  promise client; `WorkerTransport` in browser, in-process transport (same `handleEngineMessage`)
  in jsdom.
- **`src/stores/model.ts`** — zustand `useModelGridStore`: 5 states, `load` (coa.list +
  calendar.preview), `setCell` (model.cell.set.v1 + engine), `inspectCell`, `recalcAll`, `retry`,
  `reset`. Pinned working scenario/model UUIDs (S-050 scenario picker is a later milestone).
- **S-041 page** (`src/pages/s041-model-grid/`) — AG Grid code-split (`lazy.tsx`), formula bar,
  edit via `model.cell.set.v1`, audit badge, axe-clean.
- **BLOCKER → DONE gate (i):** `model.cell.set.v1` persists only the HMAC **audit event**, not
  the cell into `model_values`. The Rust `ModelCellStore` is `Mutex<HashMap<...>>` (in-memory);
  parent `model_lines`/`scenarios` are not seeded. DoD requires real DB persistence. **Needs the
  Rust toolchain (cargo), which is unavailable in this sandbox** — rustup/static.rust-lang.org are
  network-blocked (see §3). The Rust change must be hand-review-only until a toolchain exists; it
  is NOT verifiable here, so M3-1 stays `PARTIAL`/`BLOCKED` (never mark it DONE).

### M3-2 Formula inspection + cycle/ref detection (S-042) — ✅ DONE (PR #10 → `0c0c33d`)

- **`model.inspect`** command: `{line_id, period_id}` → `{formula, computed_text, error_code,
precedents[], dependents[], cycle[], is_cycle}`. Schema (`ModelInspectArgs/Data/CellRef` in
  `src/api/schema.ts`) + dev mock (`src/api/mock.ts` — inspects cells written via `cell.set.v1`,
  read-only, no mutation).
- **Engine `inspectCell`** (`modelEngine.ts`): HF `getCellPrecedents`/`getCellDependents` filtered
  to single-cell refs, `resolveRef` → grid `{line_id, period_id, sheet, col, row}`, deep-trace
  cycle path (`traceCyclePath`), `FORMULA_CYCLE` / `REFERENCE_BROKEN`. Protocol op + client method.
- **S-042 page** (`src/pages/s042-formula-inspector/`) — code-split route `/app/model/inspect`,
  `ModelSectionNav` tab, i18n `inspectorPage.*`, 5 states, precedents/dependents/cycle-path
  rendering, user-facing error text (never raw `error.message`).
- **Tests:** engine 18, protocol 6, client 6, store 8, S-042 page 8 (axe 0), schema 32, mock 21 —
  **227 total**. Coverage 89.7/81.8/85.9/92.1 + critical ≥95/90. All gates green.

### M3-3 Driver tables + federation + bounds (S-043) — 🚧 PARTIAL (TS-side complete & green)

Shipped in one commit on `arena/01a05772-fpa`. The **TS-side is complete and green**; the **Rust
`driver.*` command handlers + real `drivers`/`driver_values` persistence are the open blocker**
(no cargo toolchain in the sandbox — the same class as M3-1; never mark it DONE while unverifiable).

- **Schema** (`src/api/schema.ts`): `driver.upsert` `{model_id, driver{...}}` → `{driver_id,
created}`; `driver.set_value` `{driver_id, scenario_id, period_id, value_decimal}` → `{ok,
recalc, value_decimal}`; `driver.import` `{file_path, mapping_id}` → `{batch_id}`. Types mirror the
  `drivers` CHECK enums (`DriverType`/`DriverSource`), exact-decimal bounds, `CORE_DRIVER_ADVISORY_MAX
= 7`, `DriverDef` (id optional on create). Registered in `CommandArgs`.
- **Mock** (`src/api/mock.ts`): in-memory `drivers`/`value` maps; `driver.upsert`
  (`DRIVER_FEED_MISSING` mirror), `driver.set_value` (exact-decimal bounds → `DRIVER_OUT_OF_BOUNDS`),
  `driver.import` (`IMPORT_*` mirror + batch id).
- **Engine** (`modelEngine.ts`): a dedicated "Drivers" sheet in the same HyperFormula workbook, so
  driver values feed Model formulas (`=Drivers!B2 * price`) and recompute on change. `loadDrivers`
  (idempotent rebuild), `setDriverValue` (bounds enforced → DRIVER_OUT_OF_BOUNDS; exact string stored
  in `driverAmounts`), `getDriverValue`, `getDriverGrid`, `getDrivers`, `getDriverImpact` (scans the
  Model grid's precedents for a Drivers-sheet address at the driver's row → S-043 impact list).
  Protocol ops + client methods added (`loadDrivers`/`setDriverValue`/`getDriverGrid`/`getDrivers`/
  `getDriverImpact`).
- **Store** (`src/stores/drivers.ts`): `useDriverStore` — 5 states, `load` (calendar.preview periods +
  engine Drivers sheet), `upsertDriver`, `setValue`, `importDrivers`, `retry`, `reset`. Reuses the
  model store's engine client (`getModelEngineClient`) so the share the SAME HyperFormula graph. Working
  set is session-scoped (no `driver.list` command — the table starts empty, matching the S-043
  "Create your first Driver" empty state). `getModelEngineClient()` was exported from `stores/model.ts`.
- **S-043 page** (`src/pages/s043-drivers/`): code-split route `/app/model/drivers`, `ModelSectionNav`
  tab (`drivers`), i18n `driversPage.*`, 5 states, driver table (name/type/source/unit/period-value
  cells), core-driver count indicator (≤7), add/edit/import, driver→lines impact list. Never surfaces
  raw `error.message` (locked userMessage / error panel with retry).
- **Tests:** engine 26, protocol 8, client 8, store 7, S-043 page 8 (axe 0), schema 36, mock 25 —
  **262 total** (+35). Coverage 88.6/81.1/84.3/90.9 (≥85/80/80/85) + critical 99.0/97.5/100/99.5
  (≥95/90/90/95). All gates green (lint/tsc/prettier/docs:verify/packs/money:ast/security/build).

### M3-4 Assumption Register + hardcode detection (S-044) — 🚧 PARTIAL (TS hardcode slice complete & green)

The register slice (persisted `assumption.upsert/list/find_usages` Rust handlers + S-044 page) was
already landed. This session shipped the **hardcoded-value detection lifecycle** in TS (no cargo
needed). Never mark M3-4 DONE while the Rust audited waiver event and the named-range resolution of
converted references are unverifiable/unbuilt.

- **Engine** (`src/workers/modelEngine.ts`): `findHardcodedLiterals(formula)` — deterministic scan
  that masks quoted strings, cell refs (`B2`, `Drivers!B2`, `'Opex Detail'!C10`, `$A$1`, `A1:B10`)
  and identifiers, then returns every remaining decimal/percent literal with spans into the original
  formula; `scanHardcoded()` walks the loaded grid; `convertHardcoded(line_id, period_id, literal,
name)` rewrites a literal → **bare** named-range reference (`wage_inflation`, per FORMULA-ENGINE-SPEC
  §1 — the `@name` form is Driver-grammar/register-UI only) and recomputes; pure `convertHardcodedFormula`
  - `isValidAssumptionName`. Protocol ops + client methods `scanHardcoded`/`convertHardcoded` added.
- **Store** (`src/stores/assumptions.ts`): `scanHardcoded`/`convertHardcoded` (persists the rewritten
  formula through the audited `model.cell.set.v1` **first**, then applies to the shared engine graph, then
  re-scans) + `waiveHardcoded`/`unwaiveHardcoded` (session-scoped; reason required — the audited waiver
  event is a Rust-owned follow-on, never fabricated in TS) + exported pure helpers
  `hardcodeFindingKey`, `assumptionEffectiveForPeriod`, `assumptionValueForPeriod` (effective-period
  behavior; string-only period comparison — no `Number()`), `diffAssumptionValues` (change diff before apply).
- **S-044 page**: hardcoded-values panel (Scan → per-literal Convert select / Waive-with-reason / Undo)
  plus an edit-form change-diff list. i18n `assumptionsPage.diff.*` / `assumptionsPage.hardcode.*`.
- **Tests:** engine 39, protocol 7, client 9, store hardcode 9, S-044 page 14 → **498 total**. Coverage
  main 89.4/81.8/89.7/89.0 + critical 98.4/97.0/100/98.3. All gates green (lint/tsc/prettier/docs:verify
  54/42/97/97/packs/money:ast/security/build).

---

## 2. NEXT TASKS (one commit + PR each; do in dependency order)

1. **Native completion sweep (statement.rs · alerts.rs · audit.rs)** — on a Rust-equipped machine run
   `cargo test`/`clippy`/`fmt` over `commands/statement.rs` (r#type arg, tagged `BuScope`),
   `commands/alerts.rs` (dedupe SQL, draft-only firing, audit tx) and the NEW `commands/audit.rs`
   (bound filter params, single-snapshot paging, `verify_company_chain` wiring); add largest-remainder
   oracle fixtures vs MONEY-ROUNDING-SPEC §3–5; desktop round-trips. Then flip the M6-1/M5-4/M6-8
   native rows and build the remaining S-060 elements (period selector, BU/Group scope UI, export via
   M6-6, drill-down).
2. **M6-2 GAAP/IFRS presets + segment report (S-060/061)** — next unblocked feature unit.
3. **Tier-3 RFC needed (do NOT implement silently):** `alerts.dismiss` + `alerts.mute_rule` catalog
   rows (S-056 ships the buttons disabled until then); `model.inspect`/`driver.import` handlers (B3).
4. ~~**M3-6 native completion**~~ — DONE 2026-09-04 on the Windows desktop (see TASKBOARD §12);
   M3-1 DB persistence likewise landed via `model_schedule_upsert`'s `model_values` writes.
5. **M1 acceptance sweep** (ROADMAP §M1): unlock → create company → wizard → calendar preview →
   grid opens E2E; money/calendar property tests (`proptest` 1.5 is already in dev-deps: 12mo /
   454 / 445 / 544 / 3334, NRF 2024–2028, W53); a11y gates on 4 screens; migration suite green.

---

## 3. GATES (all must pass; run in `/home/user/fpa`)

```bash
npx vitest run                                     # 34 files / 262 tests
npx vitest run --coverage                          # ≥85/80/80/85  (now 89.84/81.72/90.02/92.30)
npx vitest run --config vitest.critical.config.ts --coverage   # ≥95/90/90/95 (now 98.49/96.98/100/98.72)
npm run lint                                       # eslint --max-warnings 0
npx tsc --noEmit
npm run build
npx prettier --check .
node scripts/docs-verify.mjs                        # 60 docs / 42 screens / 97 commands / 99 codes
node scripts/money-ast.mjs
node scripts/secret-scan.mjs
node scripts/pack-validate.mjs                      # 12/12
node scripts/license-check.mjs
```

Rust: **there is no Rust toolchain in the sandbox and the network blocks rustup
(`sh.rustup.rs` and `static.rust-lang.org` both fail; only the npm registry is reachable), and
CI never runs for this repo (Actions disabled; `infra/ci.yml` stays put — never push
`.github/workflows/`). Your hand-review IS the compile gate.**

Brace/balance check after **every** Rust edit (note: strip only string literals and comments —
stripping `'…'` breaks Rust lifetimes like `State<'_>` and produces false failures). It also
false-fails on **char literals containing a quote** (`'"'` in the CSV reader) because the naive
string regex then swallows a `"` and pairs the wrong quotes — normalise those first:

```bash
python3 - $(find src-tauri/src -name '*.rs') <<'EOF'
import re,sys
for path in sys.argv[1:]:
    s=open(path).read()
    # char literals that hold a quote/escape (CSV reader: '\"') confuse the string-stripper
    # because the regex then pairs the wrong quotes — normalise them before stripping.
    s = s.replace("'\"'", "CH").replace("'\\''", "CH").replace("'\\r'", "CH")
    s = s.replace("'\\n'", "CH").replace("'\\t'", "CH").replace("'\\\\'", "CH")
    s = re.sub(r"'\\u\\{[0-9a-fA-F]+\\}'", "CH", s)
    s2=re.sub(r'"(?:[^"\\]|\\.)*"','""',s); s2=re.sub(r'//[^\n]*','',s2)
    s2=re.sub(r'/\*.*?\*/','',s2,flags=re.S)
    print(('OK  ' if (s2.count('{')-s2.count('}'), s2.count('(')-s2.count(')'))==(0,0) else 'FAIL'),
          s2.count('{')-s2.count('}'), s2.count('(')-s2.count(')'), path)
EOF
```

---

## 4. PRODUCTIVITY PLAYBOOK (learned the hard way — do not repeat)

1. **Verify the spec before trusting a code comment.** The handover claimed
   `STORAGE_DECRYPT_FAILED` is 500; the locked ERROR-HANDLING.md says 401. The doc wins.
2. **Assume the Rust core has never been compiled.** When you touch it, re-read every function
   you depend on for a possible pre-existing break (`From` impls, missing imports). Two such
   defects shipped before A02 and sat in 12 call sites; §2.5 found a third class (global
   audit prev-hash vs excision).
3. **`node_modules` wipes mid-session.** Reinstall and re-run; don't debug ghosts.
4. **`npm install` rewrites `package-lock.json`** (`dev` → `devOptional` churn from newer npm).
   `git checkout -- package-lock.json` before committing if you did not intend a lockfile change.
5. **Read the component + i18n keys BEFORE writing tests** — enumerate real roles/text from the
   JSX and `src/i18n/en.json` first.
6. **`mockRejectedValue` (non-`Once`) spuriously fails Vitest as an "unhandled rejection"** even
   when the component catches it — use `mockRejectedValueOnce`.
7. **Pin policy has TWO mirrored owners:** Rust `validate_pin_policy` (`commands/session.rs`)
   and TS `validatePinPolicy`/`pinPolicyChecks` (`src/api/schema.ts`). Change both + both suites.
   Same rule now applies to **key material**: `storage/keys.rs` is the only place secrets may be
   handled — do not hand-roll crypto or a second key cache anywhere else (B14).
8. **Route taxonomy:** `/welcome` = first-run PIN, `/wizard` = S-002 wizard, `/` = S-001 unlock.
   Never point "New Company" at `/welcome`.
9. **money-ast:** `Number(` banned in `src/` (use `parseInt(x, 10)`); `f64`/`f32` banned in
   `src-tauri/src/`; `.toFixed(` only in `utils/money.ts`.
10. **Vitest quirks:** keep error-path and flow-path tests in separate files; the first pack
    auto-selects in S-023 (scope by role+regex); multiple companies → `getAllByRole(...)[0]`;
    debounced/async flows need `findBy*`/`waitFor`. **The zustand session store persists across
    tests in a file — `setState` shallow-merges, so reset new state fields in `beforeEach`.**
11. **API contracts extend ADDITIVELY only** (docs locked at 97 commands / 99 codes): new
    response fields are fine (subset tables in API-SPEC are not exhaustive; zod response
    schemas are mirrors, not runtime gates — the bridge validates ARGS only); new commands,
    new error codes, or changed documented shapes are docs changes — forbidden (B20).
12. **Session read-only is per-Company and dies with `mint_session`** — any new session-company
    mutation must take `State<SessionState>` and call `session::require_company_write` in Rust
    (AUTH-SPEC §3 rule 2). Commands with **no** `company_id` argument (the `import.*` family) use
    `require_session_write` instead, which also fails `SESSION_LOCKED` when nothing is unlocked.
    The mock's `read_only` flag mirrors it for the dev preview only.
13. **Vitest 4 matchers take ONE argument** — `expect(x).toBe(false, "why")` is a TS error here
    (`Expected 1 arguments, but got 2`) even though it runs; put the note in a `//` comment.
14. **`json!({…})` and `rusqlite::params![…]` take references, not ownership.** `json!` expands to
    `to_value(&$other)`, so a field behind `&Struct` or `Arc<T>` is fine — but a _move_ out of an
    `Arc` deref is not, so never write `Arc<T>` field moves anywhere else.
15. **`money-ast` scans Rust for the literal tokens `f64`/`f32`,** not for float _usage_. Binding
    by pattern (`Data::Float(v) => format!("{v}")`) keeps the file clean; naming the type does not.
16. **Two owners for every ingestion rule:** the Rust core (semantics: tie-out, sign conventions,
    period/account resolution) and the Zod + mock mirrors (shapes + error text). Change all three
    and both suites — the mock's user-facing strings are asserted against ERROR-HANDLING.md.

---

## 5. STANDING RULES

Zero-compromise, specs-first: the 60 docs in `docs/` are locked (start DOCS-INDEX →
ARCHITECTURE → API-SPEC → ROADMAP → ZERO-COMPROMISE-RULES). Never re-open closed doc issues
(B20). Money/calendar logic has exactly one owner: the Rust core; the UI formats only. Every
screen needs 5 states (loading/empty/error/success/populated). All 99 error codes are defined —
reuse them, never invent. Money = exact integers/Decimal strings via `rust_decimal` (never
REAL/float — B3/I1). PIN policy = ≥8 chars, ≥2 classes, no sequential run ≥4, enforced in Rust
AND the zod gate. 15 technologies locked (B13/B14) — **do not add a dependency that is not in
TECH-STACK.md** (this is why A02 hand-rolls `zeroize()` instead of adding the crate). Local-first,
no network in shipped code (B18-9). UX production-grade.

---

## 6. SANDBOX RECOVERY

Symptom: `git status` shows already-committed changes as modified/untracked, `git log` shows an
old HEAD, reflog only has clone/checkout, `node_modules` empty. Files and git **objects**
persist; only refs/index/node_modules reset.

```bash
git reflog -8                                  # confirm reset
git cat-file -t <known-last-commit-sha>        # objects usually still exist
git reset --hard <known-last-commit-sha>       # restores ref + index
git merge origin/main                          # fast-forward to merged-PR state
git push origin <your-session-branch>
npm install
```

Known anchors: `085359b` (pre-PR#4) → merge → `902af9d`; F-004 ended at `5733c6b`; A02 commits
`edfe833` → `e7a35d0` → `0fc51b1` on `arena/01a053dd-fpa`; §2.5 commits `2bf24d8` → `376ef7d`
on `arena/01a05468-fpa` (merged as PR #7 → `ece8b31`); B19 commits (Rust core → TS contracts →
handover) on `arena/01a054e4-fpa`.

**If the branch you are given is not the one in the brief:** the sandbox is re-cloned between
sessions and Arena pins a fresh `arena/…` branch each time. Before assuming lost work, check
`git log --all`, `git cat-file -t <sha>` and `gh pr list --state all` — a previous session's
unpushed commits do NOT survive the re-clone (objects are pruned with the old pack).

---

## 7. COMMIT / PR RITUAL

- Commit in logical units (Rust storage core → commands → api/mock → docs last).
- Push **only** your session branch (Arena pins it; never switch branches).
- `gh pr create --base main --head <your-session-branch> --title "…" --body "…"`, then
  `gh pr merge <n> --merge` once green. Keep `infra/ci.yml` where it is — never push
  `.github/workflows/` (the token lacks Workflows permission; do not retry).
