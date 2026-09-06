import { lazy } from "react";

export const ConnectorsPage = lazy(() =>
  import("./index").then((m) => ({ default: m.ConnectorsPage })),
);
