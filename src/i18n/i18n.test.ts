import i18n from "./index";
import en from "./en.json";

describe("i18n — v1 single-UI English (LOCALIZATION-SPEC A2)", () => {
  it("initializes with en and fallback en", () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.resolvedLanguage).toBe("en");
    expect(i18n.options.fallbackLng).toEqual(["en"]);
  });

  it("contains every key used by the shipped screens", () => {
    for (const key of [
      "app.name",
      "unlock.title",
      "unlock.subtitle",
      "unlock.submit",
      "wizard.title",
      "wizard.steps.company",
      "shell.nav.dashboard",
      "dashboard.title",
      "common.loading",
      "common.retry",
      "errors.code",
    ]) {
      expect(i18n.t(key, { defaultValue: key })).not.toBe(key);
    }
  });

  it("keeps en.json as the single translation payload", () => {
    expect(en.unlock.submit).toBe("Unlock");
    expect(Object.keys(en)).toContain("unlock");
  });
});
