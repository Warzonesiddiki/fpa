import { Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
// S-041/S-042 pull in AG Grid + HyperFormula (~600 KB gz). Per PERFORMANCE-REQUIREMENTS §bundle,
// the grid + inspector routes are code-split so the shell never pays for them on first paint.
import { ModelGridPage } from "@/pages/s041-model-grid/lazy";
import { FormulaInspectorPage } from "@/pages/s042-formula-inspector/lazy";
import { DriverTablesPage } from "@/pages/s043-drivers/lazy";
import { AssumptionsPage } from "@/pages/s044-assumptions";
import { HeadcountPage } from "@/pages/s045-headcount/lazy";
import { ScenariosPage } from "@/pages/s050-scenarios";
import { ComparePage } from "@/pages/s051-compare/lazy";
import { WhatIfPage } from "@/pages/s052-whatif/lazy";
import { PlanningCyclePage } from "@/pages/s053-cycle/lazy";
import { VariancePage } from "@/pages/s054-variance/lazy";
import { FvaPage } from "@/pages/s055-fva/lazy";
import { StatementsPage } from "@/pages/s060-statements/lazy";
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
import { MappingWizardPage } from "@/pages/s031-mapping";
import { ImportCommitPage } from "@/pages/s032-import-commit";
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
      { path: "import/map", element: <MappingWizardPage /> },
      { path: "import/commit", element: <ImportCommitPage /> },
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
      {
        path: "model/headcount",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <HeadcountPage />
          </Suspense>
        ),
      },
      { path: "model/coa", element: <CoaPage /> },
      { path: "model/calendar", element: <CalendarPage /> },
      { path: "model/packs", element: <PacksPage /> },
      // S-050 (F-022) — first Planning-area screen: /plan lands on the Scenario Manager.
      { path: "plan", element: <Navigate to="/app/plan/scenarios" replace /> },
      { path: "plan/scenarios", element: <ScenariosPage /> },
      {
        path: "plan/compare",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <ComparePage />
          </Suspense>
        ),
      },
      {
        path: "plan/whatif",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <WhatIfPage />
          </Suspense>
        ),
      },
      {
        path: "plan/cycle",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <PlanningCyclePage />
          </Suspense>
        ),
      },
      // S-054 (F-024): Variance & Attribution screen under /analyze
      { path: "analyze", element: <Navigate to="/app/analyze/variance" replace /> },
      {
        path: "analyze/variance",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <VariancePage />
          </Suspense>
        ),
      },
      // S-055 (F-025): FVA screen under /analyze/fva
      {
        path: "analyze/fva",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <FvaPage />
          </Suspense>
        ),
      },
      // S-073 (F-035): the shell's "Governance" nav target. S-074 (Backup) lands here in M2.
      // S-060 (F-027): Statement suite under /reports/statements. Bounded here: pl/bs/cf skeleton.
      { path: "reports", element: <Navigate to="/app/reports/statements/pl" replace /> },
      {
        path: "reports/statements",
        element: <Navigate to="/app/reports/statements/pl" replace />,
      },
      {
        path: "reports/statements/:type",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <StatementsPage />
          </Suspense>
        ),
      },
      { path: "governance", element: <Navigate to="/app/governance/license" replace /> },
      { path: "governance/license", element: <LicensePage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
