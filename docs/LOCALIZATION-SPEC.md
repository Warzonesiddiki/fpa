# LOCALIZATION-SPEC.md

> OneFP&A · v1.0.0 · **Locale-aware NUMBER/DATE/CURRENCY behavior and the V2 i18n roadmap (A2/V-011/F-038).** v1.0.0 UI = English-only; **formats are locale-aware from day one** (the #1 import/report correctness risk).

---

## 1. LOCALE MODEL

| Setting | Scope | Values | Default |
|---|---|---|---|
| UI language | app | `en` (v1.0.0) | `en` |
| Number locale | company | `en-US`, `en-IN`, `de-DE`, `fr-FR`, `es-ES`, `pt-BR`, `nl-NL`, `it-IT`, `sv-SE`, `ja-JP`, `zh-CN`, `ar-SA` (format-only unless V-011 adds RTL) | derived from OS first-run, editable in S-075 |
| Currency code | company/BU | ISO 4217 | pack default |
| Calendar display | company | ISO vs US format (`DD/MM/YYYY` vs `MM/DD/YYYY`) | per locale |

## 2. NUMBER FORMATS (exact rules)

| Locale | Decimal sep | Group sep | Example (1,234,567.89) |
|---|---|---|---|
| en-US / en-IN* | `.` | `,` | `1,234,567.89` (en-IN: `12,34,567.89` Indian grouping) |
| de-DE / it-IT / nl-NL / sv-SE | `,` | `.` | `1.234.567,89` |
| fr-FR | `,` | (narrow nbsp) `␣` | `1 234 567,89` |
| es-ES / pt-BR | `,` | `.` | `1.234.567,89` |
| ja-JP / zh-CN | `.` | `,` | `1,234,567.89` |
| ar-SA | `٫` | `٬` | format-only v1.0.0 (display), full RTL V-011 |

**Rules:** display uses `Intl.NumberFormat` (browser) with the locale; **parse** during Import uses an explicit locale selection (auto-detect shown in Preview with confirm); negative style from `format.negativeStyle` (paren default — never locale-derived). `000s` display = divide by 1000 for display only (value unchanged; per-line decimals).

## 3. DATE/FISCAL PERIOD PARSING (Import — exact)

| Source pattern | Accepted | Resolution |
|---|---|---|
| `YYYY-MM`, `YYYYMM` | calendar month | maps by Fiscal Calendar (start month aware) |
| `YYYYMMDD`, `YYYY-MM-DD` | date | period = fiscal period containing date |
| `FY26-P08`, `FY26 P08`, `FY26P08` | fiscal code (week-based) | direct P-code match |
| `Aug-26`, `08/2026` | ambiguous month/date | **requires explicit choice** (WARNING `UNIT_PERIOD_MISMATCH` style) — never guessed |
| `DD.MM.YYYY` (locale) | auto-detect w/ preview | confirm before use |

Never parse dates in a locale different from the selected Import locale without the preview confirmation step (B16 scenario: EU dates misread as US).

## 4. CURRENCY DISPLAY

Symbol placement per locale (`₹1,234.00` en-IN; `1 234,00 €` de-DE); code append for multi-currency reports (`€1,234.00 [EUR]`); no implicit conversion — every amount carries its currency; group statements display translated values with the Group Reporting Currency label.

## 5. I18N READINESS (v1.0.0) & V2 (V-011)

1. **All UI strings** in `src/i18n/en.json` — zero hardcoded strings (lint rule `i18n/no-hardcoded`); placeholders typed (`{value}`).
2. **Plural/format rules** use ICU MessageFormat (i18next v26) — German/French plurals correct from day one.
3. **RTL** NOT in v1.0.0 (V-011): right-to-left is a component-audit task (charts/grids/flow direction) — flagged as V2 explicitly, not half-done.
4. **Font glyph coverage:** Inter + JetBrains Mono cover Latin/Cyrillic/Greek; CJK relies on system fallback in V1 (tested at 200% zoom — no tofu for core UI); full CJK/AR fonts in V-011.
5. **Docs/glossary terms** are English canonical terms regardless of UI language (finance vocabulary stays stable).

## 6. LOCALE TESTS (blocking)

| Test | Assert |
|---|---|
| Number parse round-trip (de-DE) | `1.234,56` → `1234.56`; export → `1.234,56` |
| Indian grouping | `12,34,567.89` renders; import accepts both `1,234,567.89` and `12,34,567.89` (confirmed) |
| Fiscal parse `FY26-P08` | maps to correct P-code in 4-5-4 calendar |
| Ambiguous date | always prompts — test asserts NO silent parse |
| 000s display | totals sum exactly under display rounding (largest-remainder) |
| Currency scale | JPY displays `¥1,235` (no `¥1,235.00`) |

*Referenced by: DESIGN-SYSTEM §2, SCREENS S-031/S-075, GL-TEMPLATE-SPEC, PRD A2/V-011.*
