import { lazy } from "react";

/**
 * S-042 Formula Inspector — code-split behind the route (PERFORMANCE-REQUIREMENTS §bundle).
 * Pulls in HyperFormula's graph-tracing path through the model engine worker; isolating it here
 * keeps the lazy component out of router.tsx (fast-refresh rule).
 */
export const FormulaInspectorPage = lazy(() =>
  import("@/pages/s042-formula-inspector").then((m) => ({ default: m.FormulaInspectorPage })),
);
