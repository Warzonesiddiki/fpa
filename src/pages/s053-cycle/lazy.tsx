import { lazy } from "react";

/**
 * S-053 Planning Cycle & Input Collection — code-split behind the route (PERFORMANCE-REQUIREMENTS §bundle).
 */
export const PlanningCyclePage = lazy(() =>
  import("@/pages/s053-cycle").then((m) => ({ default: m.default })),
);

