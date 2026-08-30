import { useState } from "react";
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
  Building2,
  Search,
} from "lucide-react";
import { SearchPalette } from "@/components/global/SearchPalette";
import { useSessionStore } from "@/stores/session";

const NAV = [
  { to: "dashboard", key: "dashboard", icon: LayoutDashboard },
  { to: "companies", key: "companies", icon: Building2 },
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
  const companyName = useSessionStore((s) => s.companyName);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-4">
        <span className="truncate text-sm font-medium text-[var(--color-onetext)]">
          {companyName ?? t("shell.companyUnknown")}
        </span>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 rounded-md border border-[var(--color-oneborder)] px-2.5 py-1.5 text-xs text-[var(--color-onetextsecondary)] hover:border-[var(--color-oneprimary)]"
        >
          <Search aria-hidden="true" className="h-3.5 w-3.5" />
          <span>{t("shell.search")}</span>
          <kbd className="rounded border border-[var(--color-oneborder)] px-1 text-[10px]">⌘K</kbd>
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Main"
          className="flex w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-3"
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

      <SearchPalette
        open={searchOpen}
        onOpen={() => setSearchOpen(true)}
        onClose={() => setSearchOpen(false)}
      />
    </div>
  );
}
