import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";

/** v1.0.0 UI = English (A2); formats are locale-aware from day one (LOCALIZATION-SPEC). */
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
