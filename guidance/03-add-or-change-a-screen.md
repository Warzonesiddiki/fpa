# 03 · Add or change a screen (all 5 states, a11y, i18n)

Every screen is `src/pages/sNNN-<name>/index.tsx` with a colocated `index.test.tsx`.
A screen is not done until it ships **all five states** with typed errors (B12/B18-5/6).

## Read first

- `docs/SCREENS-SPEC.md` → the `S-0NN` entry: required regions, contents, and states.
- `docs/WIREFRAMES-CORE.md` / `docs/WIREFRAMES-ANALYTICS.md` → layout.
- `docs/COPY-GUIDELINES.md` → user-facing sentences; `docs/ERROR-HANDLING.md` → error copy.
- `docs/ACCESSIBILITY.md`, `docs/RESPONSIVE-DESIGN.md`, `docs/DESIGN-SYSTEM.md`.
- `docs/STATE-MANAGEMENT.md` → how stores drive screens.

## The 5 states (non-negotiable, B18-5/6)

Use `src/components/ui/StatePanel.tsx` (`ScreenState =
"loading" | "empty" | "error" | "success" | "populated"`):

| State       | When                                     | Must include                                                 |
| ----------- | ---------------------------------------- | ------------------------------------------------------------ |
| `loading`   | data in flight                           | spinner + aria "Loading"                                     |
| `empty`     | query succeeded, nothing yet             | message + a primary action ("Create your first…")            |
| `populated` | data present                             | the real content                                             |
| `error`     | a typed failure                          | **`errorCode`** (from ERROR-HANDLING) + retry if `retryable` |
| `success`   | a completed action (where spec says so)  | confirmation message                                         |
| read-only   | locked artifact / 2nd instance / license | controls disabled with an explaining title                   |

Do not simulate a state with a constant, and do not invent an error code. If the screen
can be read-only (locked scenario, read-only session, license state), that path ships in
the same change.

## Wiring pattern

```
index.tsx  ── renders StatePanel by store.status
   └── uses a store in src/stores/*.ts
          └── load()/actions call call("cmd", args)  (bridge.ts)
                 └── set status: loading→populated|empty|error
```

- The screen renders from store state; it never calls `invoke` directly.
- Errors from the bridge are `BridgeError` with `code`, `userMessage`, `retryable`,
  `retryAfterMs` — surface `userMessage`, gate retry on `retryable`, honor `retryAfterMs`.

## i18n (no hardcoded English)

- All copy comes from `src/i18n/en.json` via `useTranslation()` — no string literals in
  JSX for user-facing text. See `docs/LOCALIZATION-SPEC.md` and `11-state-i18n-design.md`.

## Accessibility (enforced by tests)

- Tests run `vitest-axe`; the populated (and key) states must be **axe-clean**.
- Keyboard: everything operable without a mouse; visible focus; correct roles/labels.
- See `docs/ACCESSIBILITY.md`.

## Tests (colocated `index.test.tsx`)

At minimum assert: renders each relevant state, axe-clean populated state, the primary
action calls the store/command, and the error state shows the typed code. Mirror an
existing strong test (e.g. `s047-production/index.test.tsx`).

## Routing

- Route is registered in the app router (`src/App.tsx` / route config) under the `/app`
  shell. Match the path convention already in use; don't lose params (e.g. `:sheetId`).

## Definition of done for a screen

- [ ] Matches `docs/SCREENS-SPEC.md` regions & contents.
- [ ] All 5 states present (+ read-only where applicable); no simulated states.
- [ ] Typed error codes only, verbatim copy.
- [ ] All copy via i18n; axe-clean; keyboard operable.
- [ ] Colocated tests cover states + a11y + primary action.
- [ ] `npm run check` green.
