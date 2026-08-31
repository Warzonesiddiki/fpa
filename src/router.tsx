import { Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
// S-041 pulls in AG Grid + HyperFormula (~600 KB gz). Per PERFORMANCE-REQUIREMENTS §bundle,
// the grid route is code-split so the shell never pays for it on first paint.
import { ModelGridPage } from "@/pages/s041-model-grid/lazy";
import { FirstRunPinPage } from "@/pages/first-run-pin";
import { UnlockPage } from "@/pages/s001-unlock";
import { WizardPage } from "@/pages/s002-wizard";
import { ShellPage } from "@/pages/s004-shell";
import { DashboardPage } from "@/pages/s010-dashboard";
import { CompaniesPage } from "@/pages/s020-companies";
import { CoaPage } from "@/pages/s021-coa";
import { CalendarPage } from "@/pages/s022-calendar";
import { PacksPage } from "@/pages/s023-packs";

/**
 * Routes per SCREENS-SPEC (hash-free paths in the webview router; App Shell loads `/` → unlock → shell).
 * M1: S-003 global search (in-shell overlay), S-020/021/022/023 wired to the Rust core.
 */
export const router = createBrowserRouter([
  { path: "/", element: <UnlockPage /> },
  { path: "/welcome", element: <FirstRunPinPage /> },
  { path: "/wizard", element: <WizardPage /> },
  {
    path: "/app",
    element: <ShellPage />,
    children: [
      { index: true, element: <Navigate to="/app/dashboard" replace /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "companies", element: <CompaniesPage /> },
      { path: "model", element: <Navigate to="/app/model/grid" replace /> },
      {
        path: "model/grid",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <ModelGridPage />
          </Suspense>
        ),
      },
      { path: "model/coa", element: <CoaPage /> },
      { path: "model/calendar", element: <CalendarPage /> },
      { path: "model/packs", element: <PacksPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
