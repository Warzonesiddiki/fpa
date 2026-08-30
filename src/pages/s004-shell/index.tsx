import { useTranslation } from "react-i18next";
import { Outlet, NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Database,
  Grid3x3,
  CalendarClock,
  BarChart3,
  FileBarChart2,
  ShieldCheck,
  Settings,
} from "lucide-react";

const NAV = [
  { to: "dashboard", key: "dashboard", icon: LayoutDashboard },
  { to: "data", key: "data", icon: Database },
  { to: "model", key: "model", icon: Grid3x3 },
  { to: "plan", key: "plan", icon: CalendarClock },
  { to: "analyze", key: "analyze", icon: BarChart3 },
  { to: "reports", key: "reports", icon: FileBarChart2 },
  { to: "governance", key: "governance", icon: ShieldCheck },
  { to: "settings", key: "settings", icon: Settings },
] as const;

/** S-004 App Shell — chrome with a11y-first nav; content renders via Outlet. */
export function ShellPage() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full">
      <nav
        aria-label="Main"
        className="flex w-52 shrink-0 flex-col gap-1 border-r border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-3"
      >
        {NAV.map(({ to, key, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                isActive
                  ? "bg-[var(--color-oneprimary)] text-white"
                  : "text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurfacealt)]"
              }`
            }
          >
            <Icon aria-hidden="true" className="h-4 w-4" />
            {t(`shell.nav.${key}`)}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <Outlet />
      </div>
    </div>
  );
}
