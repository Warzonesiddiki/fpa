import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { SettingsPage } from "./index";
import {
  createDefaultSettings,
  SETTINGS_STORAGE_KEY,
  useSettingsStore,
  type SettingsPreferences,
  type SettingsStoreError,
} from "@/stores/settings";
import type { ScreenState } from "@/components/ui/StatePanel";

const BASE: SettingsPreferences = { ...createDefaultSettings("en-US") };

function setPageState(
  status: ScreenState,
  preferences: SettingsPreferences = BASE,
  options: {
    restoreIssue?: "invalid" | "unavailable" | null;
    error?: SettingsStoreError | null;
  } = {},
): void {
  useSettingsStore.setState({
    status,
    hydrated: status !== "loading",
    preferences: { ...preferences },
    restoreIssue: options.restoreIssue ?? null,
    error: options.error ?? null,
  });
}

function renderPage() {
  return render(
    <main>
      <SettingsPage />
    </main>,
  );
}

describe("S-075 Settings (F-038)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.themePreference;
    delete document.documentElement.dataset.density;
    document.documentElement.style.removeProperty("color-scheme");
    document.documentElement.style.removeProperty("--one-grid-row-height");
    setPageState("loading");
  });

  it("renders the loading skeleton state", () => {
    const { container } = renderPage();
    expect(container.querySelector('[data-screen-state="loading"]')).not.toBeNull();
    expect(screen.getByRole("status", { name: "Loading settings…" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("renders first-use defaults as the non-blocking empty state with every S-075 section", () => {
    setPageState("empty");
    const { container } = renderPage();

    expect(container.querySelector('[data-screen-state="empty"]')).not.toBeNull();
    expect(screen.getByText(/No saved preferences yet/)).toBeInTheDocument();
    for (const heading of [
      "Appearance",
      "Language & regional formats",
      "Currency & formatting defaults",
      "Keyboard shortcuts",
      "Auto-update",
      "Local Diagnostics",
      "Storage location",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByRole("combobox", { name: /Interface language/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: "KRW" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "AED" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export Local Diagnostics" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Change storage location" })).toBeDisabled();
    expect(screen.getByText(/desktop save-path picker and handler/)).toHaveTextContent(
      "app.diagnostics.export",
    );
    expect(screen.getByText(/storage-relocation command contract/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("restores populated values, previews locale-safe money, and persists a successful edit", async () => {
    setPageState("populated");
    const user = userEvent.setup();
    const { container } = renderPage();

    expect(container.querySelector('[data-screen-state="populated"]')).not.toBeNull();
    expect(screen.getByLabelText("Theme")).toHaveValue("system");
    expect(screen.getByLabelText("Grid density")).toHaveValue("comfortable");
    expect(screen.getByText("(USD 1,235)")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Theme"), "dark");
    await user.selectOptions(screen.getByLabelText("Grid density"), "compact");
    await user.selectOptions(screen.getByLabelText("Number format locale"), "de-DE");
    await user.selectOptions(screen.getByLabelText("Default currency"), "EUR");
    await user.selectOptions(screen.getByLabelText("Negative amounts"), "minus");
    await user.click(screen.getByLabelText("Display money in 000s by default"));
    await user.selectOptions(screen.getByLabelText("Display decimals"), "2");
    await user.selectOptions(screen.getByLabelText("Update channel"), "beta");

    expect(screen.getByText("-EUR 1.234.567,89")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Settings saved on this device.")).toBeInTheDocument();
    expect(container.querySelector('[data-screen-state="success"]')).not.toBeNull();
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-density", "compact");
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "null")).toMatchObject({
      theme: "dark",
      density: "compact",
      locale: "de-DE",
      defaultCurrency: "EUR",
      negativeStyle: "minus",
      displayThousands: false,
      displayDecimals: "2",
      updateChannel: "beta",
    });
  });

  it("shows SETTINGS_SAVE_FAILED verbatim and retries the same draft", async () => {
    setPageState("populated");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText("Theme"), "dark");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const message = await screen.findByText("Settings could not be saved. Retry.");
    expect(message.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByText("SETTINGS_SAVE_FAILED")).toBeInTheDocument();
    expect(screen.getByLabelText("Theme")).toHaveValue("dark");

    setItem.mockRestore();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Settings saved on this device.")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "null")).toMatchObject({
      theme: "dark",
    });
  });

  it("surfaces a corrupt restore without overwriting it and lets the user reset the draft", async () => {
    const custom = { ...BASE, theme: "dark" as const, density: "compact" as const };
    setPageState("empty", custom, { restoreIssue: "invalid" });
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText(/Saved preferences are invalid/)).toBeInTheDocument();
    expect(screen.getByLabelText("Theme")).toHaveValue("dark");
    await user.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(screen.getByLabelText("Theme")).toHaveValue("system");
    expect(screen.getByLabelText("Grid density")).toHaveValue("comfortable");
  });

  it("renders the storage-unavailable edge state", () => {
    setPageState("empty", BASE, { restoreIssue: "unavailable" });
    renderPage();
    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
  });

  it("is axe-clean in the populated state", async () => {
    setPageState("populated");
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Theme")).toBeInTheDocument());
    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });
});
