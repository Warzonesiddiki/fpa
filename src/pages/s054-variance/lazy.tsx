import { lazy } from "react";

/**
 * S-054 Variance & Attribution — code-split route component (PERFORMANCE-REQUIREMENTS §bundle).
 */
export const VariancePage = lazy(() =>
  import("@/pages/s054-variance").then((m) => ({ default: m.VariancePage })),
);
export default VariancePage;
