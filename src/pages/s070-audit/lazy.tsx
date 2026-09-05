import { lazy } from "react";

/** S-070 Audit Trail (F-033) — code-split governance route. */
export const AuditTrailPage = lazy(() =>
  import("@/pages/s070-audit").then((m) => ({ default: m.AuditTrailPage })),
);
export default AuditTrailPage;
