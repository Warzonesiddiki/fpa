import { lazy } from "react";

/**
 * S-056 Alerts Center (F-026) — code-split route component.
 */
export const AlertsPage = lazy(() =>
  import("@/pages/s056-alerts").then((m) => ({ default: m.AlertsPage })),
);
export default AlertsPage;
