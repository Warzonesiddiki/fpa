import { lazy } from "react";

/** S-040 Sheets / Multi-Tab Grid Manager (F-012 · SCREENS-SPEC S-040). */
export const SheetsManagerPage = lazy(() =>
  import("@/pages/s040-sheets").then((module) => ({ default: module.SheetsManagerPage })),
);
