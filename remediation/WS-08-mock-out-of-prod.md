# WS-08 · Keep the mock core out of the production bundle

**Priority:** Phase C. **Decision:** D6. **Finding:** `src/api/mock.ts` (~4,600 lines of
sample data + fake handlers) is **statically imported** by `src/api/bridge.ts` and only
gated at runtime by `isTauriRuntime()`. Grep confirms mock strings ("Demo Company",
"Standard costing") are present in `dist/assets/bridge-*.js` and `index-*.js`. This
violates B18-7 (no mock data in a production path) and bloats the shipped app.

## Objective

The mock core is available in the browser dev preview only and is **fully tree-shaken out
of the production/Tauri build** — no mock strings in `dist/` when built for release.

## Why it matters (business terms)

The mock exists so we can click around the app in a browser during development. It should
never travel inside the real product a customer installs — it's dead weight and sample
data that has no business being in a shipped financial app.

## Read first

- `docs/ARCHITECTURE.md` and B18-3 ("dev web preview is tooling, never a product
  surface") + B18-7.
- `src/api/bridge.ts` lines 1–90 (the static `import { mockInvoke, isTauriRuntime } from
"./mock"` and the runtime `isTauriRuntime()` branch).
- `vite.config.ts` (how the bundle is built) and note `import.meta.env.DEV` is already
  used elsewhere (`src/pages/s030-import/index.tsx:202`).

## Approach (dynamic, dev-only import)

Convert the static mock import into a **dev-only dynamic import** so the production build
never references `mock.ts`:

1. Move `isTauriRuntime()` OUT of `mock.ts` into a tiny always-available module (e.g.
   `src/api/runtime.ts`) so the bridge can detect the runtime without importing the mock.
2. In `bridge.ts`, replace the static import with a guarded dynamic import:

   ```ts
   import { isTauriRuntime } from "./runtime";

   async function invokeMock(command, args) {
     if (!import.meta.env.DEV) {
       // Should never happen: mock is dev-only (B18-3/B18-7).
       throw toBridgeError({ code: "INTERNAL", userMessage: "..." });
     }
     const { mockInvoke } = await import("./mock");
     return mockInvoke(command, args);
   }

   const data = isTauriRuntime()
     ? await invoke(command, parsed.data as never)
     : await invokeMock(command, parsed.data);
   ```

   `import.meta.env.DEV` is statically `false` in a production build, so Vite/Rollup will
   dead-code-eliminate the `await import("./mock")` and drop `mock.ts` from the bundle.

3. Verify no other production module statically imports `mock.ts` (grep). Test files may
   import it (that's fine — tests aren't bundled).

## Acceptance criteria

- Production build (`npm run build`) produces a `dist/` with **no** mock content:
  ```bash
  npm run build
  grep -R "Demo Company\|Standard costing\|mockInvoke" dist/assets/*.js && echo "FAIL: mock in bundle" || echo "OK: mock excluded"
  ```
  must print `OK: mock excluded`.
- The browser dev preview (`npm run dev`) still works fully via the mock.
- The real Tauri path is unchanged (`isTauriRuntime()` → `invoke`).
- All existing tests still pass (adjust any test that imported `isTauriRuntime` from
  `mock.ts` to import from `runtime.ts`).

## Optional (cheap win while here)

- The audit flagged `s041-model-grid` at 1.13 MB. If lazy-loading heavy libs
  (AG Grid / HyperFormula) for that route is a small change, do it; otherwise record as a
  follow-up. Do not expand scope for a large refactor.

## Gates to run

```bash
npm run check
npm run build
grep -R "Demo Company\|mockInvoke" dist/assets/*.js || echo "clean"
```

## Docs to sync

- `docs/ARCHITECTURE.md` — note the dev-only dynamic mock boundary if it documents bridge.
- `src/api/bridge.ts` comment updated to reflect the new mechanism.
