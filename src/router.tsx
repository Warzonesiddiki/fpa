import { createBrowserRouter, Navigate } from "react-router-dom";
import { UnlockPage } from "@/pages/s001-unlock";
import { WizardPage } from "@/pages/s002-wizard";
import { ShellPage } from "@/pages/s004-shell";
import { DashboardPage } from "@/pages/s010-dashboard";

/**
 * Routes per SCREENS-SPEC (hash-free paths in the webview router; App Shell loads `/` → unlock → shell).
 * M1 build-out: S-003 (global search), S-020/021/022/023 (company/coa/calendar/pack) land next milestones.
 */
export const router = createBrowserRouter([
  { path: "/", element: <UnlockPage /> },
  { path: "/welcome", element: <WizardPage /> },
  {
    path: "/app",
    element: <ShellPage />,
    children: [
      { index: true, element: <Navigate to="/app/dashboard" replace /> },
      { path: "dashboard", element: <DashboardPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
