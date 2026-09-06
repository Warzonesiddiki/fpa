import { lazy } from "react";

/**
 * S-061 Segment Report — code-split route component (PERFORMANCE-REQUIREMENTS §bundle).
 * The screen itself is `SegmentReportPage` in ./index; accessibility is asserted in
 * index.test.tsx with vitest-axe (never a stub).
 */
export const SegmentReportPage = lazy(() =>
  import("@/pages/s061-segment").then((m) => ({ default: m.SegmentReportPage })),
);
export default SegmentReportPage;
