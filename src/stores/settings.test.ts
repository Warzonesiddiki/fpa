import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySettingsAppearance,
  createDefaultSettings,
  SETTINGS_SAVE_ERROR,
  SETTINGS_STORAGE_KEY,
  useSettingsStore,
  watchSystemTheme,
  type SettingsPreferences,
} from "./settings";

const BASE = { ...createDefaultSettings("en-US") };

function resetStore(): void {
  useSettingsStore.setState({
    status: "loading",
    hydrated: false,
    preferences: { ...BASE },
    restoreIssue: null,
    error: null,
  });
}

function clearRootAppearance(): void {
  const root = document.documentElement;
  root.classList.remove("dark");
  delete root.dataset.theme;
  delete root.dataset.themePreference;
  delete root.dataset.density;
  root.style.removeProperty("color-scheme");
  root.style.removeProperty("--one-grid-row-height");
}

function populatedPreferences(): SettingsPreferences {
  return {
    ...BASE,
    theme: "dark",
    density: "compact",
    locale: "de-DE",
    defaultCurrency: "EUR",
    negativeStyle: "minus",
    displayThousands: false,
    displayDecimals: "2",
    updateChannel: "beta",
  };
}

describe("settings store — versioned local persistence (S-075)", () => {
  beforeEach(() => {
    localStorage.clear();
    clearRootAppearance();
    resetStore();
  });

  it("hydrates first-use defaults as the non-blocking empty state", async () => {
    await useSettingsStore.getState().hydrate();

    const state = useSettingsStore.getState();
    expect(state.status).toBe("empty");
    expect(state.hydrated).toBe(true);
    expect(state.preferences).toEqual(BASE);
    expect(state.restoreIssue).toBeNull();
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement).toHaveAttribute("data-theme-preference", "system");
    expect(document.documentElement).toHaveAttribute("data-density", "comfortable");
    expect(document.documentElement.style.getPropertyValue("--one-grid-row-height")).toBe("36px");
  });

  it("restores a valid document and applies dark/compact appearance", async () => {
    const preferences = populatedPreferences();
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(preferences));

    await useSettingsStore.getState().hydrate();

    const state = useSettingsStore.getState();
    expect(state.status).toBe("populated");
    expect(state.preferences).toEqual(preferences);
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement).toHaveAttribute("data-density", "compact");
    expect(document.documentElement.style.getPropertyValue("--one-grid-row-height")).toBe("28px");
  });

  it.each([
    ["malformed JSON", "{not-json"],
    ["schema-invalid JSON", JSON.stringify({ theme: "sepia" })],
  ])("keeps %s untouched and visibly falls back to safe defaults", async (_label, raw) => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, raw);

    await useSettingsStore.getState().hydrate();

    const state = useSettingsStore.getState();
    expect(state.status).toBe("empty");
    expect(state.restoreIssue).toBe("invalid");
    expect(state.preferences).toEqual(BASE);
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBe(raw);
  });

  it("reports unavailable storage while keeping the page usable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    await useSettingsStore.getState().hydrate();

    expect(useSettingsStore.getState()).toMatchObject({
      status: "empty",
      hydrated: true,
      restoreIssue: "unavailable",
      preferences: BASE,
    });
  });

  it("persists a valid change, reports success, and can be restored round-trip", async () => {
    const preferences = populatedPreferences();

    await expect(useSettingsStore.getState().save(preferences)).resolves.toBe(true);
    expect(useSettingsStore.getState()).toMatchObject({
      status: "success",
      hydrated: true,
      preferences,
      restoreIssue: null,
      error: null,
    });
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "null")).toEqual(preferences);

    resetStore();
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState()).toMatchObject({ status: "populated", preferences });
  });

  it("surfaces the locked SETTINGS_SAVE_FAILED body and preserves prior values on write failure", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const attempted = populatedPreferences();

    await expect(useSettingsStore.getState().save(attempted)).resolves.toBe(false);

    expect(useSettingsStore.getState().preferences).toEqual(BASE);
    expect(useSettingsStore.getState().status).toBe("error");
    expect(useSettingsStore.getState().error).toMatchObject(SETTINGS_SAVE_ERROR);
    expect(useSettingsStore.getState().error?.message).toBe("quota");
    setItem.mockRestore();
  });

  it("rejects an invalid in-memory payload before touching storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const invalid = { ...BASE, density: "microscopic" } as unknown as SettingsPreferences;

    await expect(useSettingsStore.getState().save(invalid)).resolves.toBe(false);

    expect(setItem).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().error).toMatchObject(SETTINGS_SAVE_ERROR);
  });

  it("does not hydrate twice after reaching a terminal restore state", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    await useSettingsStore.getState().hydrate();
    await useSettingsStore.getState().hydrate();
    expect(getItem).toHaveBeenCalledTimes(1);
  });
});

describe("settings appearance helpers", () => {
  beforeEach(() => {
    clearRootAppearance();
    resetStore();
  });

  it("derives a supported regional locale and otherwise falls back to en-US", () => {
    expect(createDefaultSettings("de").locale).toBe("de-DE");
    expect(createDefaultSettings("en-IN").locale).toBe("en-IN");
    expect(createDefaultSettings("unknown").locale).toBe("en-US");
  });

  it("resolves system theme from the supplied media preference", () => {
    applySettingsAppearance({ theme: "system", density: "compact" }, true);
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    applySettingsAppearance({ theme: "light", density: "comfortable" }, true);
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("tracks operating-system theme changes only while system theme is selected", () => {
    let listener: (() => void) | null = null;
    const media = {
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((_type: string, callback: () => void) => {
        listener = callback;
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
    vi.spyOn(window, "matchMedia").mockReturnValue(media);
    useSettingsStore.setState({ preferences: { ...BASE, theme: "system" } });

    const stop = watchSystemTheme();
    Object.defineProperty(media, "matches", { value: true, configurable: true });
    expect(listener).not.toBeNull();
    (listener as unknown as () => void)();
    expect(document.documentElement).toHaveClass("dark");

    useSettingsStore.setState({ preferences: { ...BASE, theme: "light" } });
    document.documentElement.classList.add("dark");
    (listener as unknown as () => void)();
    expect(document.documentElement).toHaveClass("dark");

    stop();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
