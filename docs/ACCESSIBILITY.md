# ACCESSIBILITY.md

> OneFP&A · v1.0.0 · **Target: WCAG 2.2 AA** (A + AA success criteria). Verified by axe-core in tests (blocking gate, no `continue-on-error`, rule B18-7). Terms per GLOSSARY.md.

---

## 1. CONTRAST (exact values, light/dark)

| Pair | Light ratio | Dark ratio | Requirement |
|---|---|---|---|
| text-primary on bg-app | `#0F172A`/`#F8FAFC` = **16.4:1** | `#F1F5F9`/`#0F172A` = **16.7:1** | ≥ 4.5:1 ✅ |
| text-secondary on bg-surface | `#475569`/`#FFFFFF` = **7.5:1** | `#CBD5E1`/`#1E293B` = **11.0:1** | ≥ 4.5:1 ✅ |
| text-muted (meta) | `#94A3B8`/`#FFFFFF` = **2.8:1** ❌**never for meaningful text** — use only decorative/disabled; meaningful meta uses text-secondary | `#64748B`/`#1E293B` = **3.4:1** ❌ same rule | Disabled text exempt |
| primary on white | `#2563EB`/`#FFFFFF` = **5.2:1** ✅ | — | ≥ 4.5:1 |
| white on primary | `#FFFFFF`/`#2563EB` = **5.2:1** ✅ | `#0F172A`/`#3B82F6` = **4.9:1** ✅ | ≥ 4.5:1 |
| error text on surface | `#DC2626`/`#FFFFFF` = **4.5:1** ✅ | `#F87171`/`#1E293B` = **6.4:1** ✅ | ≥ 4.5:1 |
| unfavorable on surface | `#B91C1C`/`#FFFFFF` = **6.2:1** ✅ | `#F87171`/`#0F172A` = **6.9:1** ✅ | ≥ 4.5:1; never used without ↑↓ icon (SC §1.4) |
| favorable on surface | `#15803D`/`#FFFFFF` = **5.6:1** ✅ | `#4ADE80`/`#0F172A` = **9.5:1** ✅ | ≥ 4.5:1 |
| focus ring vs bg | `#2563EB` on `#FFFFFF` = **5.2:1** ✅ | `#60A5FA` on `#0F172A` = **6.1:1** ✅ | ≥ 3:1 non-text (WCAG 1.4.11) |

**Rule:** contrast is computed from tokens in CI (a11y test fails on any hardcoded color that breaks the table above).

---

## 2. FOCUS ORDER & KEYBOARD

### 2.1 Global order (top → bottom, left → right)
Sidebar links → Top bar (Company, Search, Alerts, Theme) → Content heading → primary action → content in DOM order → status bar. Modals trap focus; drawer focus starts on the panel's first interactive element; **focus returns to the trigger element on close** (tested).

### 2.2 Keyboard shortcuts (all workflows keyboard-only — F-038)

| Shortcut | Action |
|---|---|
| `Ctrl/⌘ + K` | Open Global Search (S-003) |
| `Ctrl/⌘ + S` | Save Model (never blocks grid) |
| `Ctrl/⌘ + Z / Y` | Undo / Redo |
| `Ctrl/⌘ + C / V` | Copy / Paste (Excel-compatible) |
| `F2` | Edit cell |
| `Esc` | Close modal/drawer; cancel edit |
| `Tab / Shift+Tab` | Move focus (grid: cells) |
| `Enter` | Commit cell / activate |
| `↑↓←→` (in grid) | Cell navigation (Excel parity) |
| `Ctrl/⌘ + F` | Find in sheet |
| `F1` | Help for current screen |
| `?` (shift+/) | Shortcut cheat sheet (S-076) |

No keyboard trap: Tab always exits any group (unless modal, where Esc + focus return are required).

---

## 3. SEMANTIC STRUCTURE

- One `h1` per screen (screen title); panels use `h2`/`h3` (no jumps).
- Landmarks: `header`, `nav`, `main`, `complementary` (drawer), `footer` (status bar).
- `<table>` + `th scope=col/row` for all report layouts (visual DataGrid renders a table element with proper headers and a summary caption).
- Charts: `role="img"` + `aria-label` summarizing the story ("Revenue ₹42M vs Budget ₹38M; favorable ₹4M") **plus** a toggleable data table (WCAG 1.1.1 / 1.3.1).
- Live regions: import progress (`aria-live=polite`), errors (`role=alert`), toast success (`role=status`).

---

## 4. ARIA SPECIFICATIONS (key components)

| Component | ARIA |
|---|---|
| DataGrid | `role=grid`; columns carry `aria-label` (code + name); row headers via `aria-rowindex`; keyboard navigation matches Excel; `aria-sort` on sortable headers; summary `aria-describedby` |
| MoneyCell / VarianceBadge | Text reads full value (never "↑" alone): `aria-label="Favorable variance ₹4,00,000 (8.3%)"`; icon `aria-hidden` |
| FormulaBar | `role=combobox`? **No** — plain `input` + `aria-describedby` to help text; formula errors `role=alert` inline |
| Tabs | `role=tablist/tab/tabpanel` + arrow keys + `aria-selected` |
| Stepper (Wizard) | `aria-current="step"` on current; completed steps `aria-label="Step 2 of 5 done"` |
| Modal | `role=dialog aria-modal=true aria-labelledby=title`; focus trap; return focus |
| Drawer | `role=complementary` + `aria-label` ("Drill-down inspector") |
| Tree (COA/Dimensions) | `role=tree/treeitem` + expand/collapse arrows + aria-expanded |
| Tooltip/HelpPopup | Trigger `aria-describedby`; content reachable via keyboard; no hover-only |
| AlertBanner | error: `role=alert`; warning/info: `role=status`; all have `aria-live` |
| KPI Card | `role=group aria-label="Revenue: ₹5.2M, +8% vs Budget, favorable"`; chart in card has table alternative on request |
| Toast | `role=status` (errors `role=alert`); `aria-live=assertive` only for errors |
| FileDropZone | `role=button` + `aria-label="Import GL dump"`; keyboard opens picker; drag state announced, never rely on drop alone |
| Sidebar collapse | `aria-expanded` + `aria-label="Collapse navigation"` |
| Chart legend | legend interactive keyboard-focusable (toggle series) |

---

## 5. COLOR, MOTION & OTHER WCAG 2.2 AA ITEMS

1. **Color is never the only signal:** favorable/unfavorable always pair icon ↑/↓ + text; charts pair shape/pattern + labels (1.4.1). Error/warning also use icon, not just red.
2. **Focus visible:** 2px ring `#2563EB` / `#60A5FA` with 2px offset on all interactive elements (2.4.7); no `outline:none` without replacement.
3. **Motion:** all durations 0ms + no fades when `prefers-reduced-motion`; no auto-advancing carousels exist (2.2.2 / 2.3.3).
4. **Target size (2.5.8 AA):** 24×24px minimum for all pointer targets (controls ≥ 32px; touch ≥ 44px). Spacing: ≤ 24px targets have 8px gap.
5. **Focus not obscured (2.4.11):** sticky headers leave 48px clearance; focus ring never hidden under other elements (tested at all breakpoints).
6. **Consistent help (3.2.6):** F1 + "?" on every screen; help button stays in the same spot.
7. **Redundant entry (3.3.7):** critical forms (import commit, restore, delete) never require re-entering data already provided.
8. **Text spacing:** layouts tolerate 1.5 line-height, 0.12em letter-spacing, 2em paragraph spacing, 0.5em word spacing (no clipping, tested).
9. **Status messages:** `role=status` announcements not reliant on color/position (4.1.3).
10. **Screen-reader labels for financial values:** full currency formatting spoken in the user's locale; `$NaN` or `Infinity` never rendered (money core guarantees).

---

## 6. PRINT/EXPORT ACCESSIBILITY EQUIVALENCY

- Every PDF export is **tagged/structured** (headings, table headers, reading order) — typst generates tagged PDFs; verified per export type.
- Every Excel export includes a **hidden "Accessibility" sheet**? **No** — Excel exports keep a column layout with meaningful headers, freeze panes, and tabular structure; no screen-reader-hostile merged-cell-only reports (merged cells carry `aria-label` equivalents in app).

---

## 7. VERIFICATION GATES (CI — blocking)

| Gate | Tool | Threshold |
|---|---|---|
| Contrast computation | Custom token test + axe | 0 violations of the §1 table |
| Axe automated (all screens, all states) | axe-core + vitest-axe | 0 violations, no skips, no `continue-on-error` |
| Keyboard-only E2E (14 flows) | Playwright | 0 dead-ends, focus order verified |
| Reduced-motion | Playwright toggles | 0 animations |
| 200% zoom at all breakpoints | Playwright screenshots | No clipping/hidden content |
| PDF tag structure | typst validation per export type | 0 untagged headings/tables |

*Referenced by: QA-CHECKLIST.md, TESTING-STRATEGY.md, CI-CD.md, DESIGN-SYSTEM.md.*
