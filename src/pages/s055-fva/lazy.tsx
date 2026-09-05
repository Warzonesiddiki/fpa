import { lazy } from "react";

/**
 * S-055 FVA (Forecast-versus-Actual Accuracy Scoring) — code-split route component.
 */
export const FvaPage = lazy(() =>
  import("@/pages/s055-fva").then((m) => ({ default: m.FvaPage })),
);
export default FvaPage;
