# WIREFRAMES-CORE.md

> OneFP&A · v1.0.0 · Terms per GLOSSARY.md · **Closes checklist #20 (low-fidelity wireframes) for Shell, Onboarding, Foundation, Data and Modeling.**
> Companion: `WIREFRAMES-ANALYTICS.md` (S-050…S-076 + dialogs).
> **Ownership:** this doc owns **geometry** (what region, what width, what order, what collapses at which breakpoint). `DESIGN-SYSTEM.md` owns **look** (color/type/space/shadow). On conflict: look → DESIGN-SYSTEM, geometry → here. Screen **content** and **states** stay owned by `SCREENS-SPEC.md`; never restate them here.

---

## 1. LAYOUT GRAMMAR (normative for all 42 screens)

Every screen is composed of at most 5 regions. Nothing may be placed outside them.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TOPBAR  56px  : Company ▾ · Global Search(⌘K) · Alerts · Theme · Backup · ⋯  │
├────────────┬─────────────────────────────────────────────────────────────────┤
│            │ PAGEHEAD 64px : h1 title · fiscal/Scenario chips · primary action│
│  SIDEBAR   ├─────────────────────────────────────────────────────────────────┤
│ 220px      │ TOOLBAR 44px (optional): filters, view toggles, undo/redo, find  │
│ (min 200,  ├─────────────────────────────────────────────────────────────────┤
│ 64px       │                                                                  │
│  collapsed)│  MAIN 1fr        ← one of: GRID · TABLE · CANVAS · FORM · DOC    │
│            ├─────────────────────────────────────────────────────────────────┤
│            │ FOOTSTRIP 40px (optional): totals, counts, validation status     │
├────────────┴─────────────────────────────────────────────────────────────────┤
│ STATUSBAR 28px : last snapshot · license state · app version                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Token | Value (locked) | Source / note |
|---|---|---|
| `chrome.topbar` | 56px, full width, sticky | COMPONENT-LIBRARY §TopBar |
| `chrome.sidebar` | 220px expanded · 64px icon-only · 200px min when user-dragged | COMPONENT-LIBRARY §Sidebar, RESPONSIVE §2 |
| `chrome.statusbar` | 28px | new here |
| `page.pad` | 24px (`space-5`) | DESIGN-SYSTEM §3.1 |
| `page.head` | 64px, `heading-1` | DESIGN-SYSTEM §2.2 |
| `toolbar.h` | 44px | new here |
| `main.gap` | 12px between cards/panels (`space-3`) | DESIGN-SYSTEM §3.1 |
| `drawer.w` | 480px right (640px in `bp-lg` wide mode) | RESPONSIVE §1/§2 |
| `modal.w` | 480 / 720 / 960 (segment review only); full-screen sheet below 900 | RESPONSIVE §2 |
| `grid.row` | 32px compact · 40px comfortable | RESPONSIVE §3 |
| `grid.header` | 36px | DESIGN-SYSTEM §5 |

**Region rules (R1–R8)**
1. **R1** One primary action per screen, always in PAGEHEAD right side (never in TOOLBAR, never in FOOTSTRIP).
2. **R2** Sidebar = navigation only. Zero controls that mutate data.
3. **R3** TOOLBAR holds only read-scoping (filters, view toggles, find). Anything that writes goes to PAGEHEAD or a dialog.
4. **R4** FOOTSTRIP is for **totals that must reconcile with MAIN**; if a value there disagrees with MAIN, the screen is in Error, not "partially loaded".
5. **R5** MAIN is never split more than twice; a third need = Drawer.
6. **R6** Drawer/Modal never stack twice (COMPONENT-LIBRARY §Modal/Drawer rule) — wireframes show one at a time.
7. **R7** Empty/Loading/Error replace **MAIN only**; TOPBAR/SIDEBAR/STATUSBAR stay rendered (the user must never lose navigation).
8. **R8** `bp-sm` (<900): sidebar collapses to 64px, PAGEHEAD actions collapse behind `⋯` (search stays), Drawer becomes full-width sheet, TOOLBAR wraps to a second 44px row. `bp-lg` (≥1280): two-pane MAIN allowed (grid + inspector side-by-side, inspector 400px min).

**Legend used below:** `G`=AG Grid MAIN · `T`=table · `F`=form · `C`=canvas (cards/charts) · `D`=doc/markdown · `—`=region absent.

---

## 2. SHELL & ONBOARDING (S-001 · S-002 · S-003 · S-004)

### S-004 App Shell — the frame all others live in
```
┌──────────────────────────────────────────────────────────┐
│ [◧ Acme ▾]        [🔍 ⌘K]     [🔔 3] [◐] [⟳ snap ✓] [⋯] │  TOPBAR
├───────┬──────────────────────────────────────────────────┤
│ 📊    │                                                  │
│ 📥    │              <outlet: page head + MAIN>          │
│ 🧮    │                                                  │
│ 🎯    │                                                  │
│ 📈    │                                                  │
│ 📄    │                                                  │
│ 🛡    │                                                  │
│ ⚙     │                                                  │
├───────┴──────────────────────────────────────────────────┤
│ snapshot 14:02 · license valid (pro) · v0.1.0            │  STATUSBAR
└──────────────────────────────────────────────────────────┘
```
Sidebar order is locked to the PRD domain order (Dashboard · Data · Model · Plan · Analyze · Reports · Governance · Settings). Icons are decorative; labels return at `bp-md`.

### S-001 Unlock — centered card, nothing else
```
            ┌────────────── 420px ──────────────┐
            │        [wordmark · OneFP&A]        │
            │   Company:  Acme Group ▾ (5 recent)│
            │   PIN   [ ● ● ● ● ● ● ● ● ]  👁    │
            │   [ error slot — inline, R7-safe ] │
            │   [        Unlock (primary)       ]│
            │   Forgot? Use Recovery Phrase      │
            └────────────────────────────────────┘
```
No sidebar, no topbar (company is not open yet). Lockout countdown replaces the button label; the button is disabled, never hidden (Button rule: disabled never hides info).

### S-002 First-Run Wizard — stepper left, one step right
```
┌──────────────────────────────────────────────────────────┐
│  ①Company  ②Pack  ③Calendar  ④COA  ⑤Model                │
├──────────────────────┬───────────────────────────────────┤
│  (Stepper, 260px)    │  MAIN: F  (current step only)     │
│  ✓ 1 · ● 2 · 🔒 3…   │                                   │
├──────────────────────┴───────────────────────────────────┤
│            [Back]                    [Next →] (primary)   │
└──────────────────────────────────────────────────────────┘
```
Step 2 = `C` pack card grid (min 260px, 4-5-4 preview thumb); step 3 = `C` preset cards **above** a read-only preview grid; step 5 = `F` with Plan-Only toggle + horizon select. Footer Back is disabled (not hidden) on step 1.

### S-003 Search Palette — overlay, route-less
```
      ┌─────────────── 640px, top-aligned 12vh ───────────────┐
      │ [🔍 query………………………………………………………………] [Esc] │
      ├───────────────────────────────────────────────────────┤
      │ Accounts (3)      ▸ 4100 Revenue – Trade             │
      │ Drivers (2)       ▸ units_shipped                    │
      │ KPIs (4) · Reports · Screens · Settings               │
      └───────────────────────────────────────────────────────┘
```
Grouped by domain, max 5 per group, ↑↓ moves across group boundaries. Results are navigation, never mutation.

---

## 3. FOUNDATION (S-010 · S-020 · S-021 · S-022 · S-023)

### S-010 Dashboard — `C`, the only 12-col card screen
```
│ PAGEHEAD: Acme Group · FY26 P07 ▾        [Import] [Model] [Reports] │
├────────────────────────────────────────────────────────────────────┤
│ [Revenue] [GM %] [EBITDA] [EBITDA %] [Op Cash] [Cash] [Attain %]   │  KPI cards
│  4-col @bp-lg · 2-col @bp-md · 1-col @bp-sm  (card 260–420px)      │
├──────────────────────────────────┬─────────────────────────────────┤
│ Actual vs Budget (12P)  [table↗] │ Alerts strip (max 3 banners)     │
├──────────────────────────────────┴─────────────────────────────────┤
│ Segment summary (multi-BU only — region absent for single BU)      │
└────────────────────────────────────────────────────────────────────┘
```
Every KPI card carries its own `?` (HelpPopup) and Drill affordance in the card header row, not in a footer.

### S-020 Company Manager — `C` card list (only screen without chrome chrome)
```
│ PAGEHEAD: Companies                     [+ New Company] (primary) │
├──────────────────────────────────────────────────────────────────┤
│ ┌ Acme Group ──────────┐ ┌ Northwind Ltd ────────┐               │
│ │ .fpa · 2.1 GB · FY26 │ │ read-only · license ⚠  │  card 360px  │
│ │ opened 2d ago        ││                         │               │
│ │ [Open][Clone][⋯▾]    │ │ [Open][Clone][⋯▾]      │  min-w 360    │
│ └──────────────────────┘ └────────────────────────┘               │
└──────────────────────────────────────────────────────────────────┘
```
Archive/Delete live only inside `⋯▾`, both routed through D-004 (danger = 2-step confirm).

### S-021 Chart of Accounts — `G` + tabbed side manager
```
│ PAGEHEAD: Chart of Accounts        [+ Account] [Import] [History] │
├─┬────────────────────────────────────────────────────────────────┤
│D│ TREE TABLE (G): Code · Name · Account Type · Report Section · BU │
│i│  ├ 4000 Revenue   ├ 5000 COGS …  (grouping row, sticky header)  │
│m│  usage-count chip right-aligned                                  │
│e│                                                                  │
│n│                                                                  │
│s│                                                                  │
└─┴────────────────────────────────────────────────────────────────┤
│ FOOTSTRIP: 412 accounts · 8 dimensions · 3 unused                  │
└──────────────────────────────────────────────────────────────────┘
```
Dimension manager = Tabs **inside the same MAIN** (left rail `Dim` panel at `bp-lg`; Tabs above the grid at `bp-md`; horizontal scroll tabs at `bp-sm`). Merge/move/edit act on the selected row via row action `⋯`, never a floating toolbar.

### S-022 Fiscal Calendar — presets above, preview below
```
│ [12-month] [4-5-4] [4-4-5] [5-5-4] [3-3-3-4]   ← preset cards row  │
├────────────────────────┬───────────────────────────────────────────┤
│ F: FY start ▾ · week   │  PREVIEW G: P01 P02 … P13 + date ranges    │
│    start ▾ · 53-wk ○   │  (read-only; Apply shows a diff)           │
├────────────────────────┴───────────────────────────────────────────┤
│ BU matrix (group only): BU ▸ preset ▸ status                        │
│ Transit Period map editor — opens as Drawer (480px)                 │
└────────────────────────────────────────────────────────────────────┘
```

### S-023 Pack Studio — editor with tabs + validation rail
```
│ PAGEHEAD: Industry Packs        [New Pack] [Import] [Export]        │
├───────────────┬───────────────────────────────────┬────────────────┤
│ Pack list     │ Tabs: COA · KPI · Drivers ·       │ Validation rail│
│ 12 rows +     │ Layouts · Calendar  (MAIN: F/G)   │ exact field    │
│ update diff ⬤ │                                   │ path + code    │
├───────────────┴───────────────────────────────────┴────────────────┤
│ FOOTSTRIP: schema v1 ✓ · Save as new version (primary, PAGEHEAD)    │
└────────────────────────────────────────────────────────────────────┘
```
Validation rail is present in every state (it is the feature). Locked pack = rail shows `PACK_IN_USE_LOCKED` + "Clone first".

---

## 4. DATA / INGESTION (S-030 · S-031 · S-032 · S-033 · S-034)

### S-030 Import Hub — source tabs over a two-pane result
```
│ [GL Dump] [Excel/CSV] [Opening Balances] │ [Driver data ✕] [Dim ✕] [Connectors ✕] │
├──────────────────────────┬────────────────────────────────────────────────────────┤
│ DROPZONE / path card     │ PARSE RESULT (read-only, typed)                        │
│  [Choose file…] (native) │  rows · sheets · bytes · SHA-256 (text) · encoding     │
│  (disabled w/ reason when│  "nothing committed yet"                               │
│   no active Company)     │                                                        │
├──────────────────────────┴────────────────────────────────────────────────────────┤
│ Recent mappings ▸ 3 chips        │ BATCH HISTORY G (page 25) · status · rollback   │
└──────────────────────────────────────────────────────────────────────────────────┘
```
Unavailable source tabs stay visible with an explicit reason (never removed). No progress bar may render unless a real progress event exists (S-030 loading rule).

### S-031 Mapping & Validation — the 7-step pipeline screen
```
│ Stepper: Parse ✓ Normalize ✓ MAP ▸ Validate ▸ Preview ▸ Tie-Out ▸ Commit          │
├─────────────────────────────────┬────────────────────────────────────────────────┤
│ MAPPING CARDS (F, 1 col @bp-sm) │ PREVIEW G (first 50 valid rows, money = minor  │
│  source col ▸ target ▸ rule      │  units, tabular)                               │
│  required ✱ · duplicate ⚠        │                                                │
├─────────────────────────────────┴────────────────────────────────────────────────┤
│ FINDINGS: HARD (n) · WARNING (n) — separate lists, ≤50 per severity + omitted n  │
│ FOOTSTRIP: valid mapped 41,203 / hard 0 / warning 4      [Validate] [Continue →]  │
└──────────────────────────────────────────────────────────────────────────────────┘
```
Continue is disabled while any HARD finding exists. Exclusion of rows is **not** offered here (S-032 only, Rust-attributed rows).

### S-032 Tie-Out & Commit — totals-first
```
│ TOTALS (F, read-only, aligned right, tabular): Dr · Cr · Difference               │
│ [ ✓ balanced ]  or  [ ✗ out by 1,250.00 ]  ← difference is a link → rows below     │
├──────────────────────────────────────────────────────────────────────────────────┤
│ DIFFERENCE ROWS G: source line · posting ref · signed amt · Dr · Cr · residual     │
│   ☐ exclude + reason (required, 1–120 chars, audited)                             │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Batch name [ trim 1–120 ]      mapping v3 · 41,203 rows · FX · src hash            │
│                                            [ Commit (primary) ]                   │
└──────────────────────────────────────────────────────────────────────────────────┘
```
After commit, MAIN is replaced by the receipt + single action **Return to Import Hub**. Never a "go to Variance" shortcut (fabricated link).

### S-033 Connector Manager — provider cards
```
│ ┌ QuickBooks ─────────────┐ ┌ Xero ─────────────────┐                             │
│ │ ● authorized · keychain ✓│ │ ○ not connected        │   card 360–480px, 2-col   │
│ │ last run 06:00 · 4,102   │ │ [Connect] (OAuth → OS │                           │
│ │ rate 62% ▓▓▓▓░ · sync ○  │ │  browser)             │                           │
│ │ [Sync now][⋯▾ disconnect]│ └───────────────────────┘                            │
│ └─────────────────────────┘                                                       │
│ FOOTSTRIP: any failure line always carries → [Use Manual Import instead]           │
```

### S-034 Source Reconciliation — A/B compare
```
│ Selector: A [batch ▾]  vs  B [connector ▾]        [Mark authoritative] [Export]   │
├──────────────────────── MAIN: G ─────────────────────────────────────────────────┤
│ Account · A value · B value · Δ · chip ✓ match / ✗ mismatch · [drill]              │
├──────────────────────────────────────────────────────────────────────────────────┤
│ FOOTSTRIP: 3 mismatches unresolved  ← screen stays Error until 0                   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. MODELING (S-040 · S-041 · S-042 · S-043 · S-044 · S-045 · S-046 · S-047 · S-048)

### S-040 Model Home — tree left, summary right
```
│ PAGEHEAD: FY26 Model · Horizon 1y · [Scenario ▾ Draft] · [P01…P13 ▾]  [Model Dump]│
├──────────────────┬─────────────────────────────────────────────────────────────┤
│ Sheet tree       │ Sheet summary rows: lines · method mix · recalc time          │
│  + Sheet  ⠿      │ Health Check chip (green/amber/red + text, B11)               │
│  (drag to reorder│ "Auto-create from Pack" when empty                            │
│   @bp-lg only)   │                                                               │
└──────────────────┴─────────────────────────────────────────────────────────────┘
```

### S-041 Sheet Grid — flagship geometry
```
│ TOOLBAR: ↶ ↷ | Fill | Find | formula bar ▾ | fmt | freeze | ⌕ inspector          │
│ TABS: Revenue · COGS · Opex · Capex · Cash ▸  [Scenario ▾]                       │
├──────────────────────────────── MAIN: G ─────────────────────────────────────────┤
│ Line (frozen 1st col)  │ P01  P02 … P13 │ YTD │ FY  │ chip per row: Method       │
│  4100 Revenue  [Driver]│ 1,234.00 …     │     │     │  badge: ⚙ derived           │
│  ↳ sub-total           │ tabular-nums · negatives per signStyle                   │
├──────────────────────────────────────────────────────────────────────────────────┤
│ FOOTSTRIP: recalc 412ms · 1,204 cells · tie-out ✓ · Σ P01–P13 = YTD ✓             │
└──────────────────────────────────────────────────────────────────────────────────┘
          @bp-lg: [inspector pane 400px docked right] ← @bp-md: same as Drawer(480)
```
Cell editor is in-place (D-002); red cell for `FORMULA_CYCLE` always shows the path in the inspector pane — color alone never carries the meaning (B11). `MODEL_CELL_LOCKED` turns the cell read-only with a "Create Version" action, never a silent rejection.

### S-042 Formula Inspection — pane, not a page
```
@bp-lg: MAIN = GRID with highlighted precedents/dependents + right pane 400px
@bp-md: GRID + Drawer(480) containing:
  ┌ expression (mono) ──────────────┐
  │ Depends on (3) ▸ Precedents (2) │
  │ Cycle path: A→B→C→A (ordered)   │
  │ Fix: [Change ref] [Change method]│
└───────────────────────────────────┘
```

### S-043 Driver Tables — master list + period strip
```
│ G: Name · Type ▾ · Unit · Source chip · Bounds · impact count   [+ Driver]       │
│ selected row → inline expand: period value strip P01…P13 (editable, tabular)      │
│ FOOTSTRIP: core drivers 5/7 advisory (B16 — amber, never blocking)                │
```

### S-044 Assumption Register — table with usage column
```
│ G: Name · Unit · Value · Source · Owner · Effective · Bounds · #usages · changed  │
│ row action: [Find usages] → Drawer listing cells                                  │
│ toolbar right: [Hardcoded-value scan] (validation run, result chips in rows)       │
```
Value editing opens a form (typed decimal string, never free float). `ASSUMPTION_IN_USE_LOCKED` renders inline on the row being edited.

### S-045 Headcount Plan — three stacked MAINs (single column)
```
│ ┌ ORG TREE (by cost center) ┐  ┌ HIRE/TERMINATION SCHEDULE G ┐                    │
│ └───────────────────────────┘  └─────────────────────────────┘                     │
│ ROLLUP PREVIEW: per fiscal period (read-only, exact decimal string until native)    │
│ [Add role] [Import driver data →] (hand-off, not a hidden button)                  │
```
Form errors (`HC_DATE_INVALID`, `HC_OVERLAP`) appear under the offending field with input retained.

### S-046 Capital, Debt & Working Capital — 5-tab MAIN
```
│ TABS: Capital Projects · Debt Schedule · WC Drivers · 13-Week Cash · Covenants    │
│ each tab = G + per-tab FOOTSTRIP (schedule total / balance / closing cash)         │
│ Covenants tab = gauge cards (net debt/EBITDA ≤3.5× · cover ≥2.5×) + breach alert   │
```

### S-047 Production & Backlog — split MAIN 60/40
```
│ left 60%: production plan G (product · units · scrap % · material · BOM)           │
│ right 40%: backlog/pipeline G (contract · value · % complete · timing · POC)       │
│ FOOTSTRIP: COGS ↑ · inventory value → BS · recognition preview  (3 totals, aligned)│
```

### S-048 Revenue Recognition — bridge, top-down
```
│ ┌ POLICY ▾ (over-time / point-in-time) ┐  ┌ BOOKINGS G ┐                            │
│ ├ RECOGNITION SCHEDULE G (per period) ─┤                                             │
│ ┌ BRIDGE: Deferred opening + additions − recognized = closing ─→ BS tie chip        │
│ mismatch → inline banner + link to the BS line (never auto-fix)                     │
```

---

## 6. WHAT IS INTENTIONALLY NOT DRAWN HERE

- **Print/export layout** → `EXPORT-FORMAT-SPEC.md` (page geometry is an output contract, not a screen).
- **Motion/transition** → `DESIGN-SYSTEM.md` §3.4 (reduced-motion collapses all of it to 0ms).
- **Visual styling of any region** → `DESIGN-SYSTEM.md` + `COMPONENT-LIBRARY.md`; no color/spacing value is invented in this doc.
- **State contents** → `SCREENS-SPEC.md`; if a state is not defined there, the screen is not done (B18-5/6) — flag it, do not improvise.

*Referenced by: DOCS-INDEX.md, QA-CHECKLIST.md, CLAUDE.md.*
