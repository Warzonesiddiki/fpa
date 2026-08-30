/**
 * OneFP&A design tokens — the ONLY color/size source (DESIGN-SYSTEM.md §6).
 * No hardcoded hex in components (lint rule: use tokens). Light + dark both ship (F-038).
 */
export const tokens = {
  color: {
    /** Brand & primary */
    primary: { light: "#2563EB", dark: "#3B82F6" },
    primaryHover: { light: "#1D4ED8", dark: "#60A5FA" },
    primaryActive: { light: "#1E40AF", dark: "#93C5FD" },
    primaryMuted: { light: "#EFF6FF", dark: "rgba(30,58,138,.35)" },
    /** Semantic — financial + system */
    success: { light: "#16A34A", dark: "#4ADE80" },
    favorable: { light: "#15803D", dark: "#4ADE80" },
    warning: { light: "#D97706", dark: "#FBBF24" },
    error: { light: "#DC2626", dark: "#F87171" },
    unfavorable: { light: "#B91C1C", dark: "#F87171" },
    info: { light: "#0284C7", dark: "#38BDF8" },
    neutral: { light: "#64748B", dark: "#94A3B8" },
    /** Surfaces & text */
    bgApp: { light: "#F8FAFC", dark: "#0F172A" },
    bgSurface: { light: "#FFFFFF", dark: "#1E293B" },
    bgSurfaceAlt: { light: "#F1F5F9", dark: "#334155" },
    bgOverlay: { light: "rgba(15,23,42,0.55)", dark: "rgba(2,6,23,0.75)" },
    border: { light: "#E2E8F0", dark: "#334155" },
    borderStrong: { light: "#CBD5E1", dark: "#475569" },
    textPrimary: { light: "#0F172A", dark: "#F1F5F9" },
    textSecondary: { light: "#475569", dark: "#CBD5E1" },
    textMuted: { light: "#94A3B8", dark: "#64748B" },
    textDisabled: { light: "#CBD5E1", dark: "#475569" },
    focusRing: { light: "#2563EB", dark: "#60A5FA" },
  } as const,
  /** Spacing scale (4px base) */
  space: { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const,
  /** Type scale (px) */
  fontSize: { xs: 12, sm: 13, md: 14, lg: 16, xl: 18, "2xl": 22, "3xl": 28 } as const,
  /** Radii */
  radius: { sm: 4, md: 6, lg: 8, xl: 12 } as const,
  /** Numeric grid density */
  density: { compact: 28, comfortable: 36 } as const,
} as const;

export type TokenColorName = keyof typeof tokens.color;
export type Density = keyof typeof tokens.density;

/** Returns the resolved color value for a theme. `mode` comes from settings.app.theme (ENV-VARIABLES §3). */
export function tokenColor(name: TokenColorName, mode: "light" | "dark"): string {
  return tokens.color[name][mode];
}
