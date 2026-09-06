import { lazy } from "react";

export const BoardPackPage = lazy(() =>
  import("./index").then((m) => ({ default: m.BoardPackPage })),
);
