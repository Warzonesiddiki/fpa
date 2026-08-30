# RESPONSIVE-DESIGN.md

> OneFP&A · v1.0.0 · **Desktop app** (Windows/macOS/Linux) — responsive = window sizes + OS display scaling + multi-monitor. Terms per GLOSSARY.md.

---

## 1. BREAKPOINTS (window content width, exact)

| Breakpoint | Width (px) | Name | Layout |
|---|---|---|---|
| `bp-sm` | `< 900` | Compact | Sidebar collapsed (icons only, 64px); KPI grid 1-column; statements 1-period-per-row; Board Pack preview single column; modals max-w 90vw |
| `bp-md` | `900 – 1279` | Standard (default) | Sidebar expanded 220px; KPI grid 2-column; statements table w/ up to 6 period columns + freeze; panels right-drawer 480px |
| `bp-lg` | `>= 1280` | Wide | Sidebar 220px + optional secondary panel; KPI grid up to 4-column; statements: all period columns + YTD/FY w/ horizontal virtual scroll; two-pane (grid + inspector) side-by-side |

### Window minimums (enforced, resizable above)

| OS | Min size (w×h, px) | Default size | Behavior below min |
|---|---|---|---|
| All | `960 × 640` | `1440 × 900` (fits 1366×768 laptops, clamped to work area) | Window manager prevents shrinking further; none |

**Reason:** Finance grids + mico-modals are unusable below 960px; we deliberately do NOT target phone/tablet (desktop-only by requirement).

---

## 2. LAYOUT CHANGES PER BREAKPOINT

| Surface | bp-sm | bp-md | bp-lg |
|---|---|---|---|
| Sidebar | collapsed 64px icons (tooltips) | 220px full nav | 220px + secondary context panel optional |
| Top bar | hide non-essential actions behind "…" menu (search remains) | full | full + command palette hint chip |
| KPI grid | 1 col | 2 col | 4 col (cards min 260px, max 420px) |
| DataGrid | max 4 visible period columns + frozen key cols; horizontal scroll | up to 8 + frozen keys | all columns virtualized |
| Reports (statements) | period-per-row layout | table, 6 period cols + freeze first 2 | full table + 000s/locale opts visible |
| Import wizard | single column, sticky summary at bottom | 2 columns (mapping + preview) | 2 columns + 3rd preview pane |
| Compare/Sensitivity | stacked charts | charts left, tables right | 3-pane |
| Board Pack preview | single page column | page + section nav | page + nav + annotations pane |
| Dialogs | full-screen sheet (max-w 90vw) | centered 480/720 | centered 480/720/960 (segment review) |
| Drawer | 100% width | 480px | 480px (or 640 wide-mode) |

---

## 3. DENSITY & FONT SIZING

| Control | Value |
|---|---|
| Compact density (default) | row height 32px, cell padding 4×8, font 13px |
| Comfortable density (toggleable, a11y) | row height 40px, cell padding 6×8, font 14px — **default ON for < 1100px width or user preference** |
| Minimum touch target (any pointer) | 24×24px; for mouse primary controls 32×36px; **44×44px for any touch device (Windows touch/tablet mode)** |
| Minimum clickable gap | 8px between adjacent controls |

---

## 4. OS-SPECIFIC DISPLAY SCALING

| OS | Handling |
|---|---|
| Windows | Respect system DPI (100/125/150/200%); fonts/px use `rem`-based tokens; crisp at 125% (tested); title bar native |
| macOS | Retina (2x) assets; system font fallback matches native; native menu bar |
| Linux | Handles 100/150/200% (per-GNOME/KDE); fallback fonts (Noto Sans) must render all glyphs; AppImage window scaling verified |

Rule: UI must be pixel-correct and legible at **100%–200% scale** on all 3 OS (screenshot diffs in CI at 100/125/150/200%).

---

## 5. MULTI-MONITOR & WINDOW STATE

| Behavior | Spec |
|---|---|
| Window state persistence | size/position/maximized saved per OS; restores on launch |
| Multi-monitor | Each window independent; secondary windows (inspector, chart) can be detached to another display (drag-out pins) |
| Snap layouts | Windows Snap / macOS Stage Manager / Linux tiling work normally (native window, no custom chrome) |
| Virtual desktops | No custom behavior; standard OS support |

---

## 6. TEST MATRIX (QA gate)

| Breakpoint × OS × Scale | Verify |
|---|---|
| 960×640 / 1280×800 / 1440×900 / 1920×1080 / 2560×1440 × Windows/macOS/Linux × 100/125/150/200% | No horizontal page scroll on core screens (grids exempt), no clipped text, all 5 states visible, charts legible, keyboard focus visible |

*Referenced by: ACCESSIBILITY.md, QA-CHECKLIST.md, TESTING-STRATEGY.md, BUILD matrix in CI-CD.md.*
