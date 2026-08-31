import { lazy } from "react";

/**
 * S-043 Driver Tables — code-split behind the route (PERFORMANCE-REQUIREMENTS §bundle).
 * Pulls in the driver-table editor + the shared model-engine worker; isolating it here keeps the
 * lazy component out of router.tsx (fast-refresh rule).
 */
export const DriverTablesPage = lazy(() =>
  import("@/pages/s043-drivers").then((m) => ({ default: m.DriverTablesPage })),
);
