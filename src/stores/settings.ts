import { create } from "zustand";
import { z } from "zod";
import type { ScreenState } from "@/components/ui/StatePanel";
import { call } from "@/api/bridge";
import { SettingsDocumentKey, type SettingsGetData } from "@/api/schema";
import { tokens, type Density } from "@/theme/tokens";
import type { NegativeStyle } from "@/utils/money";

export const SETTINGS_STORAGE_KEY = "onefpa.settings.v1";
/** Catalogued app-DB settings row that mirrors the versioned local preference document. */
export const SETTINGS_DOCUMENT_KEY = SettingsDocumentKey;
export const SETTINGS_SAVE_ERROR = {
  code: "SETTINGS_SAVE_FAILED",
  userMessage: "Settings could not be saved. Retry.",
  httpStatus: 500,
  retryable: true,
} as const;

export const SUPPORTED_LOCALES = [
  "en-US",
  "en-IN",
  "de-DE",
  "fr-FR",
  "es-ES",
  "pt-BR",
  "nl-NL",
  "it-IT",
  "sv-SE",
  "ja-JP",
  "zh-CN",
  "ar-SA",
] as const;
export type NumberLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "JPY",
  "KRW",
  "KWD",
  "BHD",
  "CHF",
  "AED",
] as const;
export type DefaultCurrency = (typeof DEFAULT_CURRENCIES)[number];

export const DISPLAY_DECIMAL_OPTIONS = ["0", "1", "2", "3", "4"] as const;
export type DisplayDecimals = (typeof DISPLAY_DECIMAL_OPTIONS)[number];

export const DISPLAY_DECIMAL_VALUES: Record<DisplayDecimals, number> = {
  "0": 0,
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
};

export type ThemePreference = "system" | "light" | "dark";
export type UpdateChannel = "stable" | "beta";
export type SettingsRestoreIssue = "invalid" | "unavailable" | null;

export interface SettingsPreferences {
  theme: ThemePreference;
  density: Density;
  language: "en";
  locale: NumberLocale;
  defaultCurrency: DefaultCurrency;
  negativeStyle: NegativeStyle;
  displayThousands: boolean;
  displayDecimals: DisplayDecimals;
  updateChannel: UpdateChannel;
}

export interface SettingsStoreError {
  code: typeof SETTINGS_SAVE_ERROR.code;
  message: string;
  userMessage: typeof SETTINGS_SAVE_ERROR.userMessage;
  httpStatus: typeof SETTINGS_SAVE_ERROR.httpStatus;
  retryable: typeof SETTINGS_SAVE_ERROR.retryable;
}

export const SettingsPreferencesSchema = z
  .object({
    theme: z.enum(["system", "light", "dark"]),
    density: z.enum(["compact", "comfortable"]),
    language: z.literal("en"),
    locale: z.enum(SUPPORTED_LOCALES),
    defaultCurrency: z.enum(DEFAULT_CURRENCIES),
    negativeStyle: z.enum(["paren", "minus"]),
    displayThousands: z.boolean(),
    displayDecimals: z.enum(DISPLAY_DECIMAL_OPTIONS),
    updateChannel: z.enum(["stable", "beta"]),
  })
  .strict();

function localeFromLanguage(language: string): NumberLocale {
  if ((SUPPORTED_LOCALES as readonly string[]).includes(language)) {
    return language as NumberLocale;
  }
  const prefixMatch = SUPPORTED_LOCALES.find((locale) => locale.startsWith(`${language}-`));
  return prefixMatch ?? "en-US";
}

/** Defaults are deterministic except for the first-run number locale, which follows the OS. */
export function createDefaultSettings(
  language = typeof navigator === "undefined" ? "en-US" : navigator.language,
): SettingsPreferences {
  return {
    theme: "system",
    density: "comfortable",
    language: "en",
    locale: localeFromLanguage(language),
    defaultCurrency: "USD",
    negativeStyle: "paren",
    displayThousands: true,
    displayDecimals: "0",
    updateChannel: "stable",
  };
}

function prefersDarkTheme(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Apply appearance at the document root so every route, portal, and grid shares one setting. */
export function applySettingsAppearance(
  preferences: Pick<SettingsPreferences, "theme" | "density">,
  darkSystemPreference = prefersDarkTheme(),
): void {
  if (typeof document === "undefined") return;
  const resolvedTheme =
    preferences.theme === "system" ? (darkSystemPreference ? "dark" : "light") : preferences.theme;
  const root = document.documentElement;
  root.classList.toggle("dark", resolvedTheme === "dark");
  root.dataset.theme = resolvedTheme;
  root.dataset.themePreference = preferences.theme;
  root.dataset.density = preferences.density;
  root.style.colorScheme = resolvedTheme;
  root.style.setProperty("--one-grid-row-height", `${tokens.density[preferences.density]}px`);
}

function settingsError(cause: unknown): SettingsStoreError {
  const detail =
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
      ? cause.message
      : "local settings storage rejected the write";
  return { ...SETTINGS_SAVE_ERROR, message: detail };
}

function isSessionLocked(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: string }).code === "SESSION_LOCKED"
  );
}

interface SettingsState {
  status: ScreenState;
  hydrated: boolean;
  remoteSynced: boolean;
  preferences: SettingsPreferences;
  restoreIssue: SettingsRestoreIssue;
  error: SettingsStoreError | null;
  hydrate: () => Promise<void>;
  /** Fetch the authoritative app-DB document and adopt it (pre-unlock: SESSION_LOCKED is ignored). */
  syncRemote: () => Promise<void>;
  save: (preferences: SettingsPreferences) => Promise<boolean>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  status: "loading",
  hydrated: false,
  remoteSynced: false,
  preferences: createDefaultSettings(),
  restoreIssue: null,
  error: null,

  hydrate: async () => {
    if (get().hydrated) return;
    const defaults = createDefaultSettings();
    set({ status: "loading", error: null });

    let raw: string | null;
    try {
      raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    } catch {
      applySettingsAppearance(defaults);
      set({
        status: "empty",
        hydrated: true,
        preferences: defaults,
        restoreIssue: "unavailable",
      });
      return;
    }

    if (raw === null) {
      applySettingsAppearance(defaults);
      set({
        status: "empty",
        hydrated: true,
        preferences: defaults,
        restoreIssue: null,
      });
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw) as unknown;
    } catch {
      applySettingsAppearance(defaults);
      set({
        status: "empty",
        hydrated: true,
        preferences: defaults,
        restoreIssue: "invalid",
      });
      return;
    }

    const parsed = SettingsPreferencesSchema.safeParse(parsedJson);
    if (!parsed.success) {
      applySettingsAppearance(defaults);
      set({
        status: "empty",
        hydrated: true,
        preferences: defaults,
        restoreIssue: "invalid",
      });
      return;
    }

    applySettingsAppearance(parsed.data);
    set({
      status: "populated",
      hydrated: true,
      preferences: parsed.data,
      restoreIssue: null,
      error: null,
    });
  },

  syncRemote: async () => {
    if (get().remoteSynced) return;
    let data: SettingsGetData;
    try {
      data = (await call("settings.get", { key: SETTINGS_DOCUMENT_KEY })) as SettingsGetData;
    } catch (cause) {
      // Pre-unlock / browser preview: the local mirror is the only valid source until a session
      // opens, so a locked session is intentionally non-fatal.
      if (isSessionLocked(cause)) return;
      const defaults = createDefaultSettings();
      applySettingsAppearance(defaults);
      set({
        status: "empty",
        hydrated: true,
        remoteSynced: true,
        preferences: defaults,
        restoreIssue: "unavailable",
        error: null,
      });
      return;
    }

    if (data.value == null) {
      set({ remoteSynced: true });
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(data.value) as unknown;
    } catch {
      const defaults = createDefaultSettings();
      applySettingsAppearance(defaults);
      set({
        status: "empty",
        hydrated: true,
        remoteSynced: true,
        preferences: defaults,
        restoreIssue: "invalid",
        error: null,
      });
      return;
    }

    const parsed = SettingsPreferencesSchema.safeParse(parsedJson);
    if (!parsed.success) {
      const defaults = createDefaultSettings();
      applySettingsAppearance(defaults);
      set({
        status: "empty",
        hydrated: true,
        remoteSynced: true,
        preferences: defaults,
        restoreIssue: "invalid",
        error: null,
      });
      return;
    }

    applySettingsAppearance(parsed.data);
    set({
      status: "populated",
      hydrated: true,
      remoteSynced: true,
      preferences: parsed.data,
      restoreIssue: null,
      error: null,
    });
  },

  save: async (preferences) => {
    const parsed = SettingsPreferencesSchema.safeParse(preferences);
    if (!parsed.success) {
      set({ status: "error", error: settingsError(parsed.error) });
      return false;
    }

    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(parsed.data));
    } catch (cause) {
      set({ status: "error", error: settingsError(cause) });
      return false;
    }

    // App-scope DB persistence through the catalogued `settings.set` command. A locked session
    // is intentionally local-only (the unlock/company screens have no active Company yet); any
    // real write failure surfaces SETTINGS_SAVE_FAILED verbatim (S-075 error state).
    try {
      await call("settings.set", {
        key: SETTINGS_DOCUMENT_KEY,
        value_json: JSON.stringify(parsed.data),
      });
    } catch (cause) {
      if (!isSessionLocked(cause)) {
        set({ status: "error", error: settingsError(cause) });
        return false;
      }
    }

    applySettingsAppearance(parsed.data);
    set({
      status: "success",
      hydrated: true,
      remoteSynced: true,
      preferences: parsed.data,
      restoreIssue: null,
      error: null,
    });
    return true;
  },
}));

/** Re-resolve a stored `system` theme whenever the operating-system preference changes. */
export function watchSystemTheme(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    const preferences = useSettingsStore.getState().preferences;
    if (preferences.theme === "system") applySettingsAppearance(preferences, media.matches);
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
