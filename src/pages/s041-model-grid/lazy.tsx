import { lazy } from "react";

/**
 * S-041 Model Grid — code-split behind the route (PERFORMANCE-REQUIREMENTS §bundle).
 * The grid pulls in AG Grid + HyperFormula (~600 KB gz); keeping it in this file isolates
 * the lazy component from router.tsx, which exports the `router` const (fast-refresh rule).
 */
export const ModelGridPage = lazy(() =>
  import("@/pages/s041-model-grid").then((m) => ({ default: m.ModelGridPage })),
);
