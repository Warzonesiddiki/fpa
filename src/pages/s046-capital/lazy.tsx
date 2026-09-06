import { lazy } from "react";

/** S-046 Capital, Debt & Working Capital screen (F-017 · M3-7). */
export const CapitalPage = lazy(() =>
  import("@/pages/s046-capital").then((module) => ({ default: module.CapitalPage })),
);
