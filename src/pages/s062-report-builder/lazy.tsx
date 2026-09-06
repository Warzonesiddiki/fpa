import { lazy } from "react";

export const ReportBuilderPage = lazy(() =>
  import("./index").then((m) => ({ default: m.ReportBuilderPage })),
);
