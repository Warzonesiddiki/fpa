import { Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
// S-041/S-042 pull in AG Grid + HyperFormula (~600 KB gz). Per PERFORMANCE-REQUIREMENTS §bundle,
// the grid + inspector routes are code-split so the shell never pays for them on first paint.
import { ModelGridPage } from "@/pages/s041-model-grid/lazy";
import { FormulaInspectorPage } from "@/pages/s042-formula-inspector/lazy";
import { DriverTablesPage } from "@/pages/s043-drivers/lazy";
import { AssumptionsPage } from "@/pages/s044-assumptions";
import { FirstRunPinPage } from "@/pages/first-run-pin";
import { UnlockPage } from "@/pages/s001-unlock";
import { WizardPage } from "@/pages/s002-wizard";
import { ShellPage } from "@/pages/s004-shell";
import { DashboardPage } from "@/pages/s010-dashboard";
import { CompaniesPage } from "@/pages/s020-companies";
import { CoaPage } from "@/pages/s021-coa";
import { CalendarPage } from "@/pages/s022-calendar";
import { PacksPage } from "@/pages/s023-packs";
import { ImportHubPage } from "@/pages/s030-import";
import { LicensePage } from "@/pages/s073-license";
import { SettingsPage } from "@/pages/s075-settings";

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
      { path: "data", element: <Navigate to="/app/import" replace /> },
      { path: "import", element: <ImportHubPage /> },
      { path: "model", element: <Navigate to="/app/model/grid" replace /> },
      {
        path: "model/grid",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <ModelGridPage />
          </Suspense>
        ),
      },
      {
        path: "model/inspect",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <FormulaInspectorPage />
          </Suspense>
        ),
      },
      {
        path: "model/assumptions",
        element: <AssumptionsPage />,
      },
      {
        path: "model/drivers",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <DriverTablesPage />
          </Suspense>
        ),
      },
      { path: "model/coa", element: <CoaPage /> },
      { path: "model/calendar", element: <CalendarPage /> },
      { path: "model/packs", element: <PacksPage /> },
      // S-073 (F-035): the shell's "Governance" nav target. S-074 (Backup) lands here in M2.
      { path: "governance", element: <Navigate to="/app/governance/license" replace /> },
      { path: "governance/license", element: <LicensePage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
