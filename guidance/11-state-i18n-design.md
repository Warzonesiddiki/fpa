# 11 · Frontend state, i18n & design system

## State management (Zustand)

- Read `docs/STATE-MANAGEMENT.md`. State lives in `src/stores/*.ts`; screens render from
  it and dispatch actions; they never call `invoke` directly (go through `bridge.ts`).
- A store's actions call `call("cmd", args)`, set `status`
  (`loading|empty|populated|error|success`), and store the typed `BridgeError` on failure.
- **No local financial computation** in stores — the Rust core owns money. The store
  caches server truth for responsiveness; it must not silently coerce/alter a financial
  value (see `assumptions.ts` header comment for the canonical stance).
- Reloads must read from the persisted source (e.g. an explicit `.list` command), so an
  empty result is a real Empty state, not an inference from a stale cache.

## i18n / copy

- Read `docs/LOCALIZATION-SPEC.md` and `docs/COPY-GUIDELINES.md`.
- **No hardcoded user-facing strings** in JSX — everything through `useTranslation()` and
  keys in `src/i18n/en.json`. The app is EN-only today but the mechanism is i18n-complete;
  don't regress it with literals.
- Error copy is verbatim from `docs/ERROR-HANDLING.md` (see `04-error-handling-playbook.md`).
- Money/date/number formatting uses the approved helpers, not ad-hoc `Intl` calls on
  authoritative values.

## Design system & components

- Read `docs/DESIGN-SYSTEM.md`, `docs/COMPONENT-LIBRARY.md`, `docs/RESPONSIVE-DESIGN.md`.
- Reuse primitives in `src/components/ui/*` (Button, Input, Card, StatePanel) and domain
  components in `src/components/domain/*` (e.g. MoneyCell). Don't hand-roll a one-off when
  a primitive exists.
- Use design tokens from `src/theme/tokens.ts` (CSS vars like `--color-onerror`), never
  hardcoded hex/px that bypass the token system.
- Tailwind is configured; follow the existing class conventions.

## Accessibility (enforced)

- `docs/ACCESSIBILITY.md`. Component tests run `vitest-axe`; populated states must be
  axe-clean. Keyboard-operable, visible focus, correct roles/labels, respects reduced
  motion and zoom.

## Anti-patterns (banned)

- Hardcoded English in components.
- A screen calling `invoke`/`fetch` directly instead of via a store + `bridge.ts`.
- Local money math in a store/component.
- Bypassing design tokens / re-implementing an existing UI primitive.
- Non-axe-clean populated states.
