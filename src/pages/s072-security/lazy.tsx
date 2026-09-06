import { lazy } from "react";

export const SecurityPage = lazy(() =>
  import("./index").then((m) => ({ default: m.SecurityPage })),
);
