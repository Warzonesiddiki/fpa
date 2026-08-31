import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

const TABS = [
  { to: "/app/model/grid", key: "grid" },
  { to: "/app/model/coa", key: "coa" },
  { to: "/app/model/calendar", key: "calendar" },
  { to: "/app/model/packs", key: "packs" },
] as const;

/** Model-section sub-navigation shared by S-021/S-022/S-023 (SCREENS-SPEC §2). */
export function ModelSectionNav() {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("modelNav.label")}
      className="flex gap-1 border-b border-[var(--color-oneborder)] pb-2"
    >
      {TABS.map(({ to, key }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `rounded-md px-3 py-1.5 text-sm ${
              isActive
                ? "bg-[var(--color-oneprimary)] text-white"
                : "text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurfacealt)]"
            }`
          }
        >
          {t(`modelNav.${key}`)}
        </NavLink>
      ))}
    </nav>
  );
}
