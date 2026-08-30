# COMPONENT-LIBRARY.md

> OneFP&A · v1.0.0 · Terms per GLOSSARY.md · **Every reusable component: props table, variants, usage rules.**
> Naming: `PascalCase` files in `src/components/ui` (primitives) / `src/components/domain` (financial). All styles from DESIGN-SYSTEM.md tokens. All values read-only in tests with Storybook coverage (a11y gates).

---

## 1. FORM PRIMITIVES

### Button
| Prop | Type | Default | Notes |
|---|---|---|---|
| `variant` | `primary \| secondary \| ghost \| danger \| text` | `primary` | Styles per §5 |
| `size` | `sm \| md` | `md` | sm=32px h, md=36px h |
| `loading` | `boolean` | `false` | Spinner + disabled |
| `icon` | `LucideIcon?` | — | Always paired with label or aria-label |
| `aria-label` | `string` | — | Required when icon-only |

**Rules:** exactly one primary action per modal/panel; danger requires `confirm` flow (D-004); never nest buttons; disabled never hides info.

### Input / MoneyInput / DateInput
| Prop | Type | Default |
|---|---|---|
| `value` | `string \| MoneyValue` | — |
| `onChange` | `(v) => void` | — |
| `invalid` | `boolean` | `false` (red border + message) |
| `helper` | `string?` | — |
| `locale` | `string` | `'en-IN'` |
| `money` | `boolean` | `false` (tabular, right-align, decimal-aware) |

**Rules:** MoneyInput **never** uses float — parse/format via canonical Money Value utils; invalid input keeps user text, shows error, never submits partial.

### Select / Combobox (searchable)
| Prop | Type | Default |
|---|---|---|
| `options` | `{value,label,group?}[]` | — |
| `searchable` | `boolean` | `false` |
| `multi` | `boolean` | `false` |
| `emptyText` | `string` | `'No options'` |

**Rules:** menu is virtualized >100 items; keyboard: ↑↓ Enter Esc; selected option announced to screen readers; options never reordered unless `sort` prop.

### Checkbox / Radio / Toggle / Switch
**Rules:** labels are clickable; Toggle has visible on/off text (`ON/OFF`) plus aria-checked; radio groups use `role=radiogroup` + fieldset legend.

---

## 2. DATA DISPLAY

### DataGrid (AG Grid wrapper)
| Prop | Type | Default | Notes |
|---|---|---|---|
| `rows` | `RowData[]` | — | Virtualized |
| `cols` | `ColumnDef[]` | — | Money cols configured via `money` flag |
| `groupBy` | `string[]` | `[]` | Row grouping |
| `pinnedCols` | `string[]` | first col | Frozen |
| `onCellClick` | `fn` | — | Drill-Down hook |
| `rowHeight` | `number` | `32` | |
| `emptyMessage` | `string` | `'No data'` | |

**Rules:** 100k+ rows must use this (never a hand-rolled table); export uses column defs (single source); header 13px/600 bg-surface-alt; zebra optional on reports.

### MoneyCell / VarianceBadge
| Prop | Type | Default |
|---|---|---|
| `value` | `MoneyValue` | — |
| `format` | `'plain' \| '000s' \| 'pct'` | `'plain'` |
| `signed` | `boolean` | `true` |
| `direction` | `'favorable' \| 'unfavorable' \| 'neutral'` | computed |
| `showIcon` | `boolean` | `true` (↑/↓ **mandatory** with color) |
| `reasonCode` | `string?` | chip (S-054) |

**Rules:** color is never the only signal; `n/a` for missing (never 0 for missing); MoneyCell is tabular-nums; negatives use parentheses per `signStyle` from Settings.

### KpiCard
| Prop | Type | Default |
|---|---|---|
| `kpi` | `KpiDefinition` | — |
| `value` | `MoneyValue \| number` | — |
| `delta` | `{value, direction, target?}` | — |
| `onClick` | `fn` | Drills down |
| `explain` | `fn` | Opens D-008 |

**Rules:** card shows 1 KPI only; delta chip explains favorable/unfavorable; empty state = "No Actuals — projected range" (never blank).

### Chart (ECharts wrapper)
| Prop | Type | Default |
|---|---|---|
| `type` | `line \| bar \| waterfall \| tornado \| donut` | — |
| `series` | `SeriesDef[]` | Colors from DESIGN-SYSTEM §1.4 |
| `xAxis` | `Period[]` | Fiscal periods |
| `accessibleTable` | `boolean` | `true` (renders hidden data table) |
| `onPointClick` | `fn` | Drill |

**Rules:** ALL charts ship an accessible data table; no >8 series without legend grouping; waterfall has explicit "starting total" and "ending total" columns.

---

## 3. FEEDBACK & OVERLAYS

### AlertBanner
| Prop | Type | Default |
|---|---|---|
| `tone` | `error \| warning \| info \| success` | `info` |
| `title` | `string` | — |
| `children` | `node` | detail/actions |
| `dismissible` | `boolean` | `false` |
| `errorCode` | `string?` | shows `CODE` + link to help |

**Rules:** role=`alert` for errors, `status` for info; actions inside banner must be announced; never more than 3 banners per screen (group in Alert Center).

### Toast / Modal / Drawer
**Rules:** Toast auto-dismiss 4.5s except errors; Modal focus-traps, ESC closes, `aria-modal`, initial focus on first field; Drawer (right, 480px) for inspection panels; both restore focus on close; one Modal + one Drawer max on screen.

### Tooltip / HelpPopup (KPI explainer)
**Rules:** tooltips must be keyboard-reachable (focusable trigger, `aria-describedby`); HelpPopup = full explainer (definition, formula, example, source) opened via `?` — never just a tooltip.

### EmptyState / ErrorState / LoadingSkeleton
| Prop | Type | Default |
|---|---|---|
| `title` | `string` | — |
| `body` | `string` | — |
| `action` | `{label, onAction}?` | — |
| `size` | `sm \| md \| lg` | `md` |

**Rules:** every data screen must have explicit EmptyState text (per SCREENS-SPEC); ErrorState always includes errorCode + retry + "export diagnostics" when relevant.

---

## 4. NAVIGATION & LAYOUT

### Sidebar / TopBar / StatusBar / Breadcrumbs / CommandBar
**Rules:** Sidebar collapsible (min 200px, collapsed 64px icons-only with tooltips); CommandBar = keyboard shortcut palette (Ctrl+K); both support full keyboard nav.

### Tabs / Stepper / Wizard
| Prop | Type | Default |
|---|---|---|
| `items` | `TabDef[]` | — |
| `activeId` | `string` | — |
| `state` (Stepper) | `done \| current \| locked` | — |
| `onChange` | `fn` | — |

**Rules:** Wizard steps persist (draft); locked steps show lock + reason; `role=tablist` + arrow-key nav; complete progress announced via `aria-live` on change.

---

## 5. DOMAIN COMPONENTS (financial)

| Component | Key props | Rules |
|---|---|---|
| **FiscalPeriodPicker** | `calendar`, `value`, `multi?`, `periods[]`, `onChange` | 13-period aware; shows W53 flag; disabled dates in locked periods |
| **DimensionPicker** | `dimension`, `value[]`, `tree?`, `onChange` | Virtualized tree; multi-select w/ select-all children |
| **AccountPicker** | `accounts`, `value`, `filterType?`, `onChange` | Code+name display; fuzzy search; forbidden cross-COA picks |
| **ScenarioStateBadge** | `state`, `version?` | Draft gray / Review amber / Approved green / Locked blue + lock icon |
| **SourceChip** | `sourceType`, `batch?` | GL Dump / Connector / Collection / Opening with hash tooltip |
| **FormulaBar** | `sheet`, `cell`, `value`, `onCommit`, `onInspect` | Enter=commit, Esc=cancel, F2=edit; cycle detection red |
| **CellEditor** | `cell`, `type`, `locale`, `validate`, `onCommit` | Money editor (locale-aware), date editor, formula editor; invalid never commits |
| **DrillDownPanel** (Drawer) | `target`, `resolve: (id)=>Chain[]` | Shows Cell→Formula→Driver→Mapping→GL Line; path always terminates |
| **TieOutPanel** | `debits`, `credits`, `diffRows`, `onExclude` | To-cent display; exclude always logged |
| **MappingTemplatePicker** | `templates[]`, `onSelect`, `onSave` | Shows versions + last used |
| **ImportProgress** | `stage`, `pct`, `cancellable` | Streams; remains interactive |
| **AuditTrailList** | `events`, `verifyStatus` | Virtualized; verify badge; filters |
| **HealthCheckPanel** | `checks[]`, `onWaive` | Fix-list clickable; waiver requires reason |
| **CovenantGauge** | `kpiRef`, `current`, `limit`, `direction` | Red at limit w/ icon + number; threshold from Alerts |
| **CalendarMatrix** | `bus[]`, `preset`, `onMap` | Transit period editor per BU |
| **PackCard** | `pack`, `installed`, `version`, `onSelect` | Schema-valid badge; update diff count |
| **LicenseBadge** | `state`, `daysLeft` | Valid/grace/expired with exact text |
| **KPIExplainer** | `kpi` | Definition/formula/example/source (D-008) |
| **CommentaryBox** | `line`, `notes`, `reasonCodes`, `onSave` | Reason code chips + free text; saves to Audit |
| **ExportDialog** | `type`, `scope`, `options`, `onGenerate` | Health gate pre-run; format options per D-003 |

---

## 6. USAGE RULES (binding)

1. No inline styles except for dynamic chart/series values; all else = tokens.
2. Every component with a `value` prop has documented empty + error rendering.
3. Every interactive component: keyboard operable + `aria-label` when icon-only (ACCESSIBILITY.md §4).
4. Components must not know about persistence; data flows via hooks (CODING-STANDARDS.md).
5. Storybook stories exist for every variant + all 5 states in COMPONENT-LIBRARY (QA gate Q-5).
6. Grid/chart/money components are the ONLY place that touch AG Grid / ECharts / Money utils (single-owner, rule B14).

*Referenced by: SCREENS-SPEC.md, ACCESSIBILITY.md, CODING-STANDARDS.md, QA-CHECKLIST.md.*
