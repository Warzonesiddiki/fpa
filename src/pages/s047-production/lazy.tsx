import { lazy } from "react";
export const ProductionPage = lazy(() =>
  import("./index").then((m) => ({ default: m.ProductionPage })),
);
