import { lazy } from "react";

/**
 * S-052 What-If & Sensitivity — code-split behind the route (PERFORMANCE-REQUIREMENTS §bundle).
 */
export const WhatIfPage = lazy(() =>
  import("@/pages/s052-whatif").then((m) => ({ default: m.WhatIfPage })),
);
