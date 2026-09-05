import { lazy } from "react";

/**
 * S-060 Statements — code-split route component (PERFORMANCE-REQUIREMENTS §bundle).
 * The screen itself is `StatementsPage` in ./index; accessibility is asserted in
 * index.test.tsx with vitest-axe (never a stub).
 */
export const StatementsPage = lazy(() =>
  import("@/pages/s060-statements").then((m) => ({ default: m.StatementsPage })),
);
export default StatementsPage;
