import { lazy } from "react";

/**
 * S-051 Model Compare — code-split behind the route (PERFORMANCE-REQUIREMENTS §bundle).
 */
export const ComparePage = lazy(() =>
  import("@/pages/s051-compare").then((m) => ({ default: m.ComparePage })),
);
