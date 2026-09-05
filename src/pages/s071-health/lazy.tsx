import { lazy } from "react";

/** S-071 Model Health Check (F-032) — code-split governance route. */
export const HealthCheckPage = lazy(() =>
  import("@/pages/s071-health").then((m) => ({ default: m.HealthCheckPage })),
);
export default HealthCheckPage;
