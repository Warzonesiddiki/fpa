import { lazy } from "react";

export const KpiBuilderPage = lazy(() =>
  import("./index").then((m) => ({ default: m.KpiBuilderPage })),
);
