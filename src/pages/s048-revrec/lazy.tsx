import { lazy } from "react";
export const RevRecPage = lazy(() => import("./index").then((m) => ({ default: m.RevRecPage })));
