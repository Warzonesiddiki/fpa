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
      "unlock.firstRun",
      "unlock.error.invalid",
      "unlock.error.locked",
      "pinSetup.title",
      "pinSetup.submit",
      "wizard.title",
      "wizard.steps.company",
      "shell.nav.dashboard",
      "shell.auditChainBroken",
      "shell.readOnlyBadge",
      "dashboard.title",
      "importHub.title",
      "importHub.source.gl",
      "importHub.success.notCommitted",
      "settings.title",
      "settings.appearance.theme",
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

  it("renders the §A auth copy verbatim (KI-013)", () => {
    // ERROR-HANDLING §A userMessages: seconds countdown, not minutes (AUTH-SPEC §2.2 30 s lock).
    expect(en.unlock.error.invalid).toBe("Incorrect PIN.");
    expect(en.unlock.error.locked).toBe("Too many attempts. Try again in {{seconds}}s.");
    expect(i18n.t("unlock.error.locked", { seconds: 30, defaultValue: "missing" })).not.toBe(
      "missing",
    );
  });
});
