import { lazy } from "react";

/** S-045 Headcount Plan — route-level split for the workforce schedule. */
export const HeadcountPage = lazy(() =>
  import("@/pages/s045-headcount").then((module) => ({ default: module.HeadcountPage })),
);
