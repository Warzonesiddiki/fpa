import { Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
// S-041/S-042 pull in AG Grid + HyperFormula (~600 KB gz). Per PERFORMANCE-REQUIREMENTS §bundle,
// the grid + inspector routes are code-split so the shell never pays for them on first paint.
import { SheetsManagerPage } from "@/pages/s040-sheets/lazy";
import { ModelGridPage } from "@/pages/s041-model-grid/lazy";
import { FormulaInspectorPage } from "@/pages/s042-formula-inspector/lazy";
import { DriverTablesPage } from "@/pages/s043-drivers/lazy";
import { AssumptionsPage } from "@/pages/s044-assumptions";
import { HeadcountPage } from "@/pages/s045-headcount/lazy";
import { CapitalPage } from "@/pages/s046-capital/lazy";
import { ProductionPage } from "@/pages/s047-production/lazy";
import { RevRecPage } from "@/pages/s048-revrec/lazy";
import { ScenariosPage } from "@/pages/s050-scenarios";
import { ComparePage } from "@/pages/s051-compare/lazy";
import { WhatIfPage } from "@/pages/s052-whatif/lazy";
import { PlanningCyclePage } from "@/pages/s053-cycle/lazy";
import { VariancePage } from "@/pages/s054-variance/lazy";
import { FvaPage } from "@/pages/s055-fva/lazy";
import { AlertsPage } from "@/pages/s056-alerts/lazy";
import { StatementsPage } from "@/pages/s060-statements/lazy";
import { SegmentReportPage } from "@/pages/s061-segment/lazy";
import { ReportBuilderPage } from "@/pages/s062-report-builder/lazy";
import { KpiBuilderPage } from "@/pages/s063-kpi-builder/lazy";
import { BoardPackPage } from "@/pages/s064-boardpack/lazy";
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
import { AuditTrailPage } from "@/pages/s070-audit/lazy";
import { HealthCheckPage } from "@/pages/s071-health/lazy";
import { BackupPage } from "@/pages/s074-backup/lazy";
import { SecurityPage } from "@/pages/s072-security/lazy";
import { LicensePage } from "@/pages/s073-license";
import { SettingsPage } from "@/pages/s075-settings";
import { HelpPage } from "@/pages/s076-help/lazy";
import { ConnectorsPage } from "@/pages/s033-connectors/lazy";
import { ReconciliationPage } from "@/pages/s034-reconcile/lazy";

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
      {
        path: "import/connectors",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <ConnectorsPage />
          </Suspense>
        ),
      },
      {
        path: "import/reconcile",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <ReconciliationPage />
          </Suspense>
        ),
      },
      { path: "model", element: <Navigate to="/app/model/grid" replace /> },
      {
        path: "model/sheets",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <SheetsManagerPage />
          </Suspense>
        ),
      },
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
      {
        path: "model/capital",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <CapitalPage />
          </Suspense>
        ),
      },
      {
        path: "model/production",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <ProductionPage />
          </Suspense>
        ),
      },
      {
        path: "model/revrec",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <RevRecPage />
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
      // S-056 (F-026): Alerts Center under /analyze/alerts (SCREENS-SPEC route /analyze/alerts)
      {
        path: "analyze/alerts",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <AlertsPage />
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
      // S-061 (F-028): Segment Report under /reports/segment (SCREENS-SPEC S-061)
      {
        path: "reports/segment",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <SegmentReportPage />
          </Suspense>
        ),
      },
      // S-062 (F-029): Report Builder under /reports/builder (SCREENS-SPEC S-062)
      {
        path: "reports/builder",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <ReportBuilderPage />
          </Suspense>
        ),
      },
      // S-063 (F-029): KPI Builder under /reports/kpis (SCREENS-SPEC S-063)
      {
        path: "reports/kpis",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <KpiBuilderPage />
          </Suspense>
        ),
      },
      // S-064 (F-030): Board Pack under /reports/boardpack (SCREENS-SPEC S-064)
      {
        path: "reports/boardpack",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <BoardPackPage />
          </Suspense>
        ),
      },
      { path: "governance", element: <Navigate to="/app/governance/audit" replace /> },
      // S-070 (F-033): the immutable HMAC-chained event log.
      {
        path: "governance/audit",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <AuditTrailPage />
          </Suspense>
        ),
      },
      // S-071 (F-032): the five-category Model Health Check + waiver.
      {
        path: "governance/health",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <HealthCheckPage />
          </Suspense>
        ),
      },
      // S-074 (F-037): Backup, Restore & Snapshot management
      {
        path: "governance/backup",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <BackupPage />
          </Suspense>
        ),
      },
      // S-072 (F-034): Security: PIN, Recovery Phrase, Keychain status
      {
        path: "governance/security",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <SecurityPage />
          </Suspense>
        ),
      },
      { path: "governance/license", element: <LicensePage /> },
      { path: "settings", element: <SettingsPage /> },
      // S-076 (F-038): Help & Explainers
      {
        path: "help",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <HelpPage />
          </Suspense>
        ),
      },
      {
        path: "help/:topic",
        element: (
          <Suspense fallback={<div role="status" aria-label="Loading" className="p-6 text-sm" />}>
            <HelpPage />
          </Suspense>
        ),
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
