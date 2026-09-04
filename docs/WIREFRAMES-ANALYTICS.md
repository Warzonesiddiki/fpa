# WIREFRAMES-ANALYTICS.md

> OneFP&A · v1.0.0 · Terms per GLOSSARY.md · **Closes checklist #20 for Planning, Analysis, Reporting, Governance, Settings and the 10 dialogs.**
> Grammar, region tokens and rules **R1–R8** live in `WIREFRAMES-CORE.md` §1 and are not repeated here. Screen content/states stay owned by `SCREENS-SPEC.md`.

---

## 1. PLANNING (S-050 · S-051 · S-052 · S-053)

### S-050 Scenario Manager — card-grid + table, never a form page
```
│ PAGEHEAD: Scenarios · FY26 Model ▾ · Baseline: Budget ✓   [+ New Scenario] (primary)│
├──────────────────────────── MAIN: G ─────────────────────────────────────────────┤
│ Name · Type · State chip(text+▲) · Base of · Versions · Probability(v1.1, absent)  │
│ row actions (canonical order): submit → approve → lock → baseline → duplicate       │
│                                → reopen → delete                                     │
├────────────────────────────────────────────────────────────────────────────────────┤
│ FOOTSTRIP: 3 scenarios · 1 Locked · BU override list (group only)                    │
└────────────────────────────────────────────────────────────────────────────────────┘
```
Locked rows: destructive actions disabled **with reason in the tooltip + inline text**, never hidden. Delete/lock open D-004 (type-the-Scenario-name confirm). Baseline replacement opens a reason field before the confirm.

### S-051 Model Compare — selectors above, diff below
```
│ A [Scenario ▾][Version ▾]   vs   B [Scenario ▾][Version ▾]   [Only changed ○] [Apply A→B] │
├──────────────────────────── MAIN: G ─────────────────────────────────────────────┤
│ Line · Period · A · B · Δ · Δ% (F/U badge, text+symbol) · [drill]                  │
│ group-by: Driver change (collapsible sections)                                       │
├────────────────────────────────────────────────────────────────────────────────────┤
│ FOOTSTRIP: 41 changed cells · net Δ 1,250.00            [Export diff]                │
└────────────────────────────────────────────────────────────────────────────────────┘
```
`COMPARE_INCOMPATIBLE` replaces MAIN with a two-column explanation of *which* COA/horizon differs — never a bare error banner.

### S-052 What-If & Sensitivity — three-pane at bp-lg
```
├───────────────────────┬──────────────────────────┬───────────────────────────────┤
│ OVERLAY CHART         │ WATERFALL                │ SENSITIVITY / GOAL SEEK (Tabs)│
│ 2–3 scenarios ×period │ Baseline → Scenario      │ tornado bars: driver × ±range │
│ [table↗] (R: charts   │ start/end totals labeled │ Goal seek: target cell ·       │
│  ship a table)        │                          │  target · driver · result     │
├───────────────────────┴──────────────────────────┴───────────────────────────────┤
│ FOOTSTRIP: model is NOT modified — [Apply to new Scenario ▸] is the only write path │
└────────────────────────────────────────────────────────────────────────────────┘
```
At `bp-md` the right pane becomes a Drawer; at `bp-sm` panes stack and the waterfall table view is the default. `GOAL_SEEK_NO_CONVERGE` shows the last value + iteration count in the panel that produced it.

### S-053 Planning Cycle — timeline band over a board
```
│ MILESTONE BAND: kickoff ── submit ── review ── approve ── baseline (dates, status)  │
├────────────────────────────────────────────────────────────────────────────────┤
│ Tabs: Status board · Close checklist (per-period tasks) · Input Collection           │
│ Input Collection: [Export sheet][Returned] [Conflict queue n] — per-contributor rows  │
├────────────────────────────────────────────────────────────────────────────────┤
│ FOOTSTRIP: 12/18 submitted · 2 conflicts · [Approve cycle] (PAGEHEAD primary)         │
└────────────────────────────────────────────────────────────────────────────────┘
```
`CYCLE_TASK_BLOCKED` renders on the task row with the blocking predecessor named.

---

## 2. ANALYSIS (S-054 · S-055 · S-056)

### S-054 Variance & Attribution — table-led, chart secondary
```
│ TOOLBAR: Period ▾ · BU ▾ · Accounts ▾ · vs [Budget ▾] · 3-Way view ○               │
├──────────────────────────── MAIN: G ─────────────────────────────────────────────┤
│ Account · Actual · Plan · Δ$ · Δ% · F/U (text+▲▼) · Volume · Price · Mix · FX ·      │
│                                      Efficiency · Reason ▾ · Note ⓘ                  │
├───────────────────────────────┬──────────────────────────────────────────────────┤
│ WATERFALL (Plan → Actual,      │ attribution completeness chip                       │
│  table view toggle)             │ ("2 of 41 lines not attributable")                  │
└───────────────────────────────┴──────────────────────────────────────────────────┘
```
Attribution columns sit **inside** the same grid (not a second table) so a row can never be read without its decomposition. `VARIANCE_SOURCE_MIXED` blocks MAIN with the two conflicting scopes listed; `VARIANCE_NO_ATTRIBUTION_DATA` keeps the $/% columns and marks attribution "not attributable" — the table is not blanked.

### S-055 FVA — score cards over a per-line table
```
│ Selector: version set ▾ (≥3 required) · horizon ▾            [Export]              │
│ [MAPE 6.4%] [Bias +1.8%] [Hit rate 71%]   ← KPI cards, 3-up, each with "?"          │
├──────────────────────────── MAIN: G ─────────────────────────────────────────────┤
│ Line · MAPE · Bias · Hit · trend sparkline (improving/worsening + text)              │
├────────────────────────────────────────────────────────────────────────────────┤
│ by-BU rollup strip (group only)                                                      │
└────────────────────────────────────────────────────────────────────────────────┘
```
`FVA_RESTATEMENT_FLAG` = persistent banner above MAIN (it changes interpretation, so it must not be a toast).

### S-056 Alerts Center — list left, rule manager right (bp-lg)
```
├──────────────────────────────────┬───────────────────────────────────────────────┤
│ Alert list (grouped): severity · │ Rule manager G: KPI/line/covenant · threshold · │
│ trigger chip · time · [drill] ·  │ digest (≤1/24h) · retention 90d                  │
│ [dismiss] [mute rule]            │ [+ Rule]                                          │
└──────────────────────────────────┴───────────────────────────────────────────────┘
```
Trigger chain is a first-class expandable row (rule → value → threshold → period). OS notification is optional; the Alert Center list is always the record.

---

## 3. REPORTING (S-060 · S-061 · S-062 · S-063 · S-064)

### S-060 Statements — the print-shaped screen
```
│ TABS: P&L · Balance Sheet · Cash Flow · SoCE · Segment                                │
│ TOOLBAR: period [Single ▾|YTD|FY|PY] · preset [GAAP ▾|IFRS] · scope [Group ▾] ·      │
│          [000s ○] [decimals ▾] [negatives ( ) ○]                                       │
│ chips: tie-out ✓ · rounding ✓   ← right-aligned, both must be green to export         │
├──────────────────────────── MAIN: G (statement) ─────────────────────────────────┤
│ Line (frozen) · P01 … P13 · YTD · FY     every cell drillable → source               │
│ sub-total rows use the exact Largest-Remainder result; footnotes row under line        │
├────────────────────────────────────────────────────────────────────────────────┤
│ FOOTSTRIP: total · check-total ✓            [Export ▸ D-003 (Excel/PDF)]               │
└────────────────────────────────────────────────────────────────────────────────┘
```
`STATEMENT_TIE_OUT_FAILED`: Export disabled + fix list panel opened (clickable to the offending cell). Never a silent "export anyway".

### S-061 Segment Report — BU columns, eliminations as its own column
```
│ Line │ BU-A (local ccy) │ BU-A (translated) │ BU-B … │ Eliminations │ Group │
│ group total row bold + check chip; each BU header shows own calendar/fiscal chip        │
│ drill on any BU cell → that BU's statement (S-060 scoped)                              │
```
`IC_UNMATCHED` / `SEGMENT_TRANSLATION_PENDING` render as a **column-level** chip (on the offending header), not a page banner.

### S-062 Report Builder — canvas + palette
```
├──────────────┬──────────────────────────────── MAIN: canvas ─────────────────────┤
│ Palette      │ row list (drag from model tree) · column defs (Period/YTD/FY/     │
│ model tree · │  Variance/3-Way) · format controls inline on selection              │
│ filters ·    │ [Preview] renders read-only inside the canvas                        │
│ grouping     │                                                                     │
├──────────────┴─────────────────────────────────────────────────────────────────┤
│ FOOTSTRIP: layout v4 · [Save as new version] (primary) · [Export]                    │
└────────────────────────────────────────────────────────────────────────────────┘
```
`LAYOUT_REFERENCE_BROKEN` highlights the broken row + offers auto-remap **as a user action** (never applied silently).

### S-063 KPI Builder — table + editor split
```
│ G left: KPI · unit · target · owner · used-on-dashboard ●                          │
│ right pane: formula editor (mono, model-cell picker) · validation result ·          │
│             explainer preview (definition/formula/example/source — S-076 shape)      │
```
`KPI_DIV_ZERO` → the cell that produced it shows `n/a` and the pane names the denominator; `0` is never substituted.

### S-064 Board Pack — document outline, not a grid
```
│ template ▾ (Monthly|Quarterly|Investor)        [Generate preview] [Export ▸ D-003]  │
├──────────────┬──────────────────────────────────────────────────────────────────┤
│ Section nav  │ SECTION CANVAS (page-shaped preview, 1 col @bp-sm)                  │
│ Cover        │  Cover → KPIs → P&L → BS → CF → Segment → Variance+commentary →      │
│ (drag order) │  Waterfalls → Notes      each: source chip + [edit commentary]       │
└──────────────┴──────────────────────────────────────────────────────────────────┘
```
`HEALTH_CHECK_BLOCKED` disables both export actions and lists blocking findings; `PACK_NO_COMMENTARY` marks the section row amber and links to it.

---

## 4. GOVERNANCE & SETTINGS (S-070 · S-071 · S-072 · S-073 · S-074 · S-075 · S-076)

### S-070 Audit Trail — immutable log geometry
```
│ TOOLBAR: date range · actor ▾ · action ▾ · object ▾ · [verified ⛓ ✓] chip            │
├──────────────────────────── MAIN: G (virtualized) ──────────────────────────────┤
│ ts · actor · action · object · before → after (two-value cell, mono)                 │
│ row expand → full event payload + hash link to previous event                        │
├────────────────────────────────────────────────────────────────────────────────┤
│ FOOTSTRIP: 18,402 events · chain verified · [Auditor Data-Room Export] [Export log]   │
└────────────────────────────────────────────────────────────────────────────────┘
```
No edit/delete control exists in this screen's geometry at all. `AUDIT_CHAIN_BREAK` = persistent read-only banner + restore path, and the chain chip turns to ✗ in PAGEHEAD.

### S-071 Health Check — check list, findings-first
```
│ [Run now] · last run 09:14 · history ▾                                               │
│ CATEGORY rows (tie-outs · refs · rounding · driver feeds · anomalies) with counts    │
├──────────────────────────── MAIN ────────────────────────────────────────────────┤
│ Finding table: severity · message · [→ cell] (clickable to the exact cell)            │
│ streaming partial results while running (no fake percentage)                          │
├────────────────────────────────────────────────────────────────────────────────┤
│ FOOTSTRIP: 2 blocking · 5 warnings   [Waive ▸ reason required (D-010)]                 │
└────────────────────────────────────────────────────────────────────────────────┘
```
Waiver is never on the finding row itself (friction is intentional). Waived findings stay visible with the reason + author.

### S-072 Security — stacked form cards (single column, 720px max)
```
│ [PIN] card: ~old · new · confirm · policy meter (text, not color)                     │
│ [Recovery Phrase] card: one-time reveal inside D-007; after setup → "stored by you"   │
│   state only — the app never re-displays it                                            │
│ [OS keychain] status per OS · [Encryption] status · [Failed attempts] table            │
```
`KEYCHAIN_UNAVAILABLE` is an amber banner with the fallback path; the screen stays usable.

### S-073 License & Activation — status card + exchange actions
```
│ ┌ STATUS: valid · plan: enterprise · expires 2099-12-31 · grace — ┐                  │
│ │ machine fingerprint  3f9a…c1  [copy]                              │                  │
│ ├ [Generate request file]   [Apply response file ▸ D-006] [paste…]   │                  │
│ ├ About: v0.1.0 · schema 001_initial.sql                             │                  │
```
Expired/invalid = PAGEHEAD banner + read-only chrome; the license card stays reachable (losing access to it would make recovery impossible).

### S-074 Backup & Restore — list + disk meter
```
│ [Backup now] · retention 30d · [Auto ○]        disk usage bar (GB, exact)             │
│ G: ts · auto/manual · size · encrypted ✓ · [Restore] [Verify] [Delete] (last: D-004)  │
│ FOOTSTRIP: restore always shows the pre-restore snapshot note first                    │
```

### S-075 Settings — two-column card list (never one long form)
```
│ [Appearance] theme ○system ●light ○dark · density ○compact ●comfortable               │
│ [Locale & formats] language (English v1.0.0) · live money/date preview                 │
│ [Defaults] currency · decimals · negatives                                            │
│ [Keyboard] shortcut table (read-only here)                                              │
│ [Updates] channel ▾ (usable pref; check needs native handler)                           │
│ [Diagnostics] [Export sanitized] (native path only) · [Storage location]                 │
```
Unavailable controls render disabled **with the missing-capability reason**; the preview column always reflects the last *saved* value, not the draft.

### S-076 Help & Explainers — doc layout, two pane
```
├───────────────┬──────────────────────────────────────────────────────────────────┤
│ topic list ·  │ D: title · definition · formula (mono) · worked example ·          │
│ search ▾      │  source (Company File → DB → screen) · related shortcuts table     │
└───────────────┴──────────────────────────────────────────────────────────────────┘
```
F1 from any screen opens this route scoped to that screen. Glossary content is a **mirror** of GLOSSARY.md — never edited here.

---

## 5. DIALOG GEOMETRY (D-001 … D-010)

| ID | Width | Structure | Notes on placement |
|---|---|---|---|
| D-001 Import wizard | full-screen sheet | same stepper as S-002, MAIN = wizard body | only dialog allowed to own a stepper |
| D-002 Cell editor | inline at cell (min 240px) | typed input + type toggle + formula bar | **not** a modal; opens on Enter/F2, Esc cancels, focus returns to the cell |
| D-003 Export | 480px | format ▾ → scope ▾ → options → progress (only when a real progress source exists) | Export button disabled while options are invalid |
| D-004 Confirm dangerous | 480px | one-line consequence · reason/type-name field · Confirm (danger) · Cancel | Cancel is the default focus; two steps minimum for delete/archive/restore |
| D-005 First-run brand | 720px | brand panel + step 1 of S-002 | only at first launch |
| D-006 License exchange | 480px | file picker or paste box → parsed payload preview → Apply | never shows the private key material; payload fields read-only |
| D-007 Recovery Phrase | 720px | reveal grid (12 words, numbered) → confirm-by-re-entering-3 | clipboard copy allowed once, explicit warning line |
| D-008 KPI/explainer | 480px (Drawer at bp-sm) | definition · formula · example · source | same shape as S-076 pane, opened from `?` |
| D-009 Update available | 480px | version notes · [Install] [Later] · channel label | never blocks the app; Later always works |
| D-010 Audit waive | 480px | finding summary · required reason · [Waive] | reachable only from S-071; writes an audit event |

Dialog rules: one modal + one Drawer maximum; scrim per `bg-overlay`; initial focus on first field; Esc closes unless the action is destructive-in-progress (D-004 mid-delete keeps focus); focus returns to the opener.

---

## 6. CONSISTENCY CHECKS A REVIEWER CAN RUN WITHOUT RENDERING

1. Primary action present exactly once, in PAGEHEAD (R1).
2. MAIN is the only region replaced by Loading/Empty/Error (R7) — if a wireframe blanks the sidebar or statusbar, it is wrong.
3. Any screen showing a total has it in FOOTSTRIP, and the FOOTSTRIP total equals the MAIN total.
4. `bp-sm` variant described for every MAIN (grid → 4 visible period columns max; drawer → sheet; toolbar → wraps).
5. No chart region without a paired table view (COMPONENT-LIBRARY §Chart).
6. Every color-bearing status chip is drawn with a text label (B11).

*Referenced by: DOCS-INDEX.md, WIREFRAMES-CORE.md, QA-CHECKLIST.md.*
