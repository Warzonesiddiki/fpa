import { lazy } from "react";

export const ReconciliationPage = lazy(() =>
  import("./index").then((m) => ({ default: m.ReconciliationPage })),
);
