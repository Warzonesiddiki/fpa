# DESIGN-SYSTEM.md

> OneFP&A · v1.0.0 · Terms per GLOSSARY.md · **Exact values only. No "somewhere between" tokens.**
> Implemented as design tokens in `src/theme/tokens.ts` (TS) + Tailwind theme; dark/light both ship (F-038).

---

## 1. COLOR SYSTEM

### 1.1 Brand & Primary

| Token | Light | Dark | Usage |
|---|---|---|---|
| `primary` | `#2563EB` | `#3B82F6` | Primary buttons, selected nav, focus ring, links |
| `primary-hover` | `#1D4ED8` | `#60A5FA` | Hover state |
| `primary-active` | `#1E40AF` | `#93C5FD` | Pressed/active state |
| `primary-muted` | `#EFF6FF` | `#1E3A8A` (30% opacity acceptable: `rgba(30,58,138,.35)`) | Selected backgrounds, subtle highlights |

### 1.2 Semantic (financial + system)

| Token | Light | Dark | Usage |
|---|---|---|---|
| `success` | `#16A34A` | `#4ADE80` | Positive confirmation, saved states |
| `favorable` | `#15803D` | `#4ADE80` | Financial: **favorable variance** (always + icon/shape, never color alone) |
| `warning` | `#D97706` | `#FBBF24` | Warnings, thresholds near limit |
| `error` | `#DC2626` | `#F87171` | Errors, hard failures, **unfavorable variance** |
| `unfavorable` | `#B91C1C` | `#F87171` | Financial: unfavorable variance (always − icon/shape) |
| `info` | `#0284C7` | `#38BDF8` | Informational banners, tips |
| `neutral` | `#64748B` | `#94A3B8` | Non-semantic chips, secondary tags |

### 1.3 Surfaces & Text

| Token | Light | Dark | Usage |
|---|---|---|---|
| `bg-app` | `#F8FAFC` | `#0F172A` | App background |
| `bg-surface` | `#FFFFFF` | `#1E293B` | Cards, panels, sheets |
| `bg-surface-alt` | `#F1F5F9` | `#334155` | Alternating rows, secondary panels |
| `bg-overlay` | `rgba(15,23,42,0.55)` | `rgba(2,6,23,0.75)` | Modals/drawers scrim |
| `border` | `#E2E8F0` | `#334155` | Standard borders |
| `border-strong` | `#CBD5E1` | `#475569` | Grid lines in tables |
| `text-primary` | `#0F172A` | `#F1F5F9` | Headings, body |
| `text-secondary` | `#475569` | `#CBD5E1` | Secondary text, labels |
| `text-muted` | `#94A3B8` | `#64748B` | Placeholders, meta |
| `text-disabled` | `#CBD5E1` | `#475569` | Disabled controls |
| `focus-ring` | `#2563EB` | `#60A5FA` | 2px outline, 2px offset |
| `selection` | `rgba(37,99,235,0.15)` | `rgba(96,165,250,0.25)` | Text/row selection |

### 1.4 Charts (ECharts palette — fixed order, never shuffled)

`#2563EB` (revenue/actuals) · `#16A34A` (budget) · `#D97706` (forecast) · `#DC2626` (unfavorable) · `#7C3AED` (segment A) · `#0E7490` (segment B) · `#BE185D` (segment C) · `#65A30D` (segment D). Color is never the only discriminator: every series has a legend marker **shape/pattern** in exports (ACCESSIBILITY.md §6).

---

## 2. TYPOGRAPHY

### 2.1 Font stack (exact)

| Use | Stack |
|---|---|
| UI (proportional) | `'Inter', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif` |
| Numbers in tables (tabular) | Same as UI + `font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1;` |
| Formulas/code | `'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace` |

All three shipped as bundled woff2 (Inter 400/500/600/700, JetBrains Mono 400/500) with `font-display: swap`; system fallbacks ensure identical-enough rendering on Windows/macOS/Linux.

### 2.2 Scale (rem = 16px base)

| Token | Size/weight | Usage |
|---|---|---|
| `display` | 28px/700/1.2 | Page titles (Dashboard) |
| `heading-1` | 22px/600/1.3 | Screen titles |
| `heading-2` | 18px/600/1.35 | Panel titles |
| `heading-3` | 15px/600/1.4 | Sub-section titles |
| `body` | 14px/400/1.5 | Default body, tables (grid body 13px/400/1.4) |
| `label` | 13px/500/1.4 | Field labels, table headers |
| `caption` | 12px/400/1.4 | Meta, tooltips, helper |
| `mono-body` | 13px/400/1.4 | Formula cells, codes, Account codes |

Never use a font size below 12px. Never use weight above 700.

---

## 3. SPACING, RADIUS, SHADOWS, MOTION

### 3.1 Spacing scale (8px base; 4px half-step allowed only for intra-component gaps)

`space-0=0 · space-1=4 · space-2=8 · space-3=12 · space-4=16 · space-5=24 · space-6=32 · space-7=40 · space-8=48 · space-9=64 · space-10=80 · space-11=96`

Page padding: 24 (space-5). Panel padding: 16–24. Component gap: 8–12. Dense table cell padding: 4×8.

### 3.2 Radius

`radius-sm=4px` (chips, tags) · `radius-md=8px` (buttons, inputs, cards) · `radius-lg=12px` (modals, panels) · `radius-full=9999px` (pill badges).

### 3.3 Shadow

`shadow-sm = 0 1px 2px rgba(15,23,42,.06)` · `shadow-md = 0 4px 12px rgba(15,23,42,.10)` · `shadow-lg = 0 12px 32px rgba(15,23,42,.16)` · `shadow-focus = 0 0 0 2px #fff, 0 0 0 4px var(--focus-ring)`.

Dark theme shadows: `rgba(0,0,0,.5)` equivalents.

### 3.4 Motion

`fast=120ms` (hover, controls) · `normal=200ms` (panels, charts) · `slow=300ms` (modals, drawers). Easing: `cubic-bezier(.2,.8,.2,1)`. **Respect `prefers-reduced-motion`**: set all durations to 0ms and disable fades; no animation is essential to comprehension.

---

## 4. ICONOGRAPHY

Lucide icons (`stroke=2`, size 16/20/24). Icons are decorative reinforcement: every icon is paired with text or an aria-label. Money direction icons are mandatory on variance values (↑ favorable / ↓ unfavorable) — never color only.

---

## 5. KEY COMPONENT STYLES (exact)

| Component | Spec |
|---|---|
| **Primary Button** | bg `primary`, text `#FFFFFF`, radius-md (8px), padding 8px 16px, height 36px, font 14px/500. Hover: `primary-hover`. Disabled: `opacity:.5`, `cursor:not-allowed`. Focus: `shadow-focus`. |
| **Secondary Button** | bg `bg-surface`, border 1px `border`, text `text-primary`; hover bg `bg-surface-alt`. |
| **Ghost Button** | transparent, text `primary`; hover bg `primary-muted`. |
| **Danger Button** | bg `error`, text `#FFFFFF`; hover `#B91C1C`. |
| **Input** | h 36px, radius-md, border 1px `border`, padding 8px 12px, focus shadow-focus; error state border `error` + message below with icon. |
| **Money Input** | right-aligned, `tabular-nums`, min-width 120px; invalid → red border; editor opens with currency-aware locale format. |
| **Select** | h 36px; menu radius-md, shadow-lg, max-h 320px scroll; selected row bg `primary-muted`. |
| **Table (AG Grid wrapper)** | row height 32px, header height 36px (bg `bg-surface-alt`, 13px/600 label), zebra `bg-surface-alt` alternate rows, `border-strong` gridlines, sticky header + frozen first column option. |
| **KPI Card** | bg `bg-surface`, radius-lg, padding 16, shadow-sm; value 24px/600 tabular; delta chip; click → Drill-Down. |
| **Toast** | bottom-right, radius-md, shadow-lg, auto-dismiss 4.5s (error toasts persist until dismissed), role=`status` (error role=`alert`). |
| **Modal** | 480px wide (forms), 720px (confirmations with tables), max-w 90vw, radius-lg, scrim `bg-overlay`, focus trap, ESC + close. |
| **Empty State** | centered icon 40px `text-muted`, title 15px/600, body 13px `text-secondary`, optional CTA button. |

---

## 6. THEMING RULES

1. Tokens are the ONLY color/size source; no hardcoded hex in components (lint rule).
2. Dark mode is a first-class theme (default follows OS; manual override persisted).
3. Chart palette identical in both themes (tested so print/export match screen).
4. Brand strings (product name/logo colors) live in one config — rule B9.

*Referenced by: COMPONENT-LIBRARY.md, SCREENS-SPEC.md, ACCESSIBILITY.md, CODING-STANDARDS.md.*
