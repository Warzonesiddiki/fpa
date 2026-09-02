import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Database, Download, Keyboard, RotateCcw } from "lucide-react";
import { Button, Card, MoneyCell } from "@/components/ui";
import {
  createDefaultSettings,
  DEFAULT_CURRENCIES,
  DISPLAY_DECIMAL_OPTIONS,
  DISPLAY_DECIMAL_VALUES,
  SUPPORTED_LOCALES,
  useSettingsStore,
  type DefaultCurrency,
  type DisplayDecimals,
  type NumberLocale,
  type SettingsPreferences,
  type SettingsRestoreIssue,
  type SettingsStoreError,
  type ThemePreference,
  type UpdateChannel,
} from "@/stores/settings";
import type { ScreenState } from "@/components/ui/StatePanel";
import type { Density } from "@/theme/tokens";
import type { NegativeStyle } from "@/utils/money";

const CONTROL_CLASS =
  "mt-1 h-10 w-full rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-3 text-sm text-[var(--color-onetext)]";

interface SettingsFormProps {
  status: Exclude<ScreenState, "loading">;
  persisted: SettingsPreferences;
  restoreIssue: SettingsRestoreIssue;
  error: SettingsStoreError | null;
  onSave: (preferences: SettingsPreferences) => Promise<boolean>;
}

function SettingsLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6" data-screen-state="loading">
      <h1 className="text-xl font-semibold">{t("settings.title")}</h1>
      <div role="status" aria-label={t("settings.loading")} className="grid gap-4 lg:grid-cols-2">
        {["appearance", "formatting", "platform", "storage"].map((section) => (
          <div
            key={section}
            className="h-36 animate-pulse rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)]"
          />
        ))}
        <span className="sr-only">{t("settings.loading")}</span>
      </div>
    </div>
  );
}

function SettingsNotice({
  status,
  restoreIssue,
  error,
  onRetry,
}: {
  status: Exclude<ScreenState, "loading">;
  restoreIssue: SettingsRestoreIssue;
  error: SettingsStoreError | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  if (status === "error" && error) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-onerror)] bg-[var(--color-onesurface)] p-4 text-sm text-[var(--color-onerror)]"
      >
        <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{error.userMessage}</span>
          <code className="text-xs">{error.code}</code>
        </span>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  if (status === "success") {
    return (
      <p
        role="status"
        className="flex items-center gap-2 rounded-lg border border-[var(--color-onefavorable)] p-3 text-sm text-[var(--color-onefavorable)]"
      >
        <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
        {t("settings.saved")}
      </p>
    );
  }

  if (restoreIssue) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 rounded-lg border border-[var(--color-onewarning)] p-3 text-sm text-[var(--color-onetext)]"
      >
        <AlertTriangle aria-hidden="true" className="h-4 w-4 text-[var(--color-onewarning)]" />
        {t(`settings.restore.${restoreIssue}`)}
      </p>
    );
  }

  if (status === "empty") {
    return (
      <p role="status" className="text-sm text-[var(--color-onetextsecondary)]">
        {t("settings.firstUse")}
      </p>
    );
  }

  return null;
}

function SettingsForm({ status, persisted, restoreIssue, error, onSave }: SettingsFormProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<SettingsPreferences>(persisted);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(persisted);
  const canSave = status === "empty" || status === "error" || dirty;

  async function save(): Promise<void> {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-6" data-screen-state={status}>
      <header>
        <h1 className="text-xl font-semibold">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-[var(--color-onetextsecondary)]">
          {t("settings.subtitle")}
        </p>
      </header>

      <SettingsNotice
        status={status}
        restoreIssue={restoreIssue}
        error={error}
        onRetry={() => void save()}
      />

      <form
        aria-label={t("settings.formLabel")}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t("settings.appearance.title")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-[var(--color-onetextsecondary)]">
                {t("settings.appearance.theme")}
                <select
                  className={CONTROL_CLASS}
                  value={draft.theme}
                  onChange={(event) =>
                    setDraft({ ...draft, theme: event.target.value as ThemePreference })
                  }
                >
                  {(["system", "light", "dark"] as const).map((theme) => (
                    <option key={theme} value={theme}>
                      {t(`settings.appearance.themes.${theme}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium text-[var(--color-onetextsecondary)]">
                {t("settings.appearance.density")}
                <select
                  className={CONTROL_CLASS}
                  value={draft.density}
                  onChange={(event) =>
                    setDraft({ ...draft, density: event.target.value as Density })
                  }
                >
                  {(["comfortable", "compact"] as const).map((density) => (
                    <option key={density} value={density}>
                      {t(`settings.appearance.densities.${density}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Card>

          <Card title={t("settings.language.title")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-[var(--color-onetextsecondary)]">
                {t("settings.language.ui")}
                <select className={CONTROL_CLASS} value={draft.language} disabled>
                  <option value="en">{t("settings.language.english")}</option>
                </select>
                <span className="mt-1 block text-xs font-normal text-[var(--color-onetextmuted)]">
                  {t("settings.language.v1Note")}
                </span>
              </label>
              <label className="text-sm font-medium text-[var(--color-onetextsecondary)]">
                {t("settings.language.numberLocale")}
                <select
                  className={CONTROL_CLASS}
                  value={draft.locale}
                  onChange={(event) =>
                    setDraft({ ...draft, locale: event.target.value as NumberLocale })
                  }
                >
                  {SUPPORTED_LOCALES.map((locale) => (
                    <option key={locale} value={locale}>
                      {t(`settings.language.locales.${locale}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Card>

          <Card title={t("settings.formatting.title")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-[var(--color-onetextsecondary)]">
                {t("settings.formatting.currency")}
                <select
                  className={CONTROL_CLASS}
                  value={draft.defaultCurrency}
                  onChange={(event) =>
                    setDraft({ ...draft, defaultCurrency: event.target.value as DefaultCurrency })
                  }
                >
                  {DEFAULT_CURRENCIES.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium text-[var(--color-onetextsecondary)]">
                {t("settings.formatting.negatives")}
                <select
                  className={CONTROL_CLASS}
                  value={draft.negativeStyle}
                  onChange={(event) =>
                    setDraft({ ...draft, negativeStyle: event.target.value as NegativeStyle })
                  }
                >
                  <option value="paren">{t("settings.formatting.parentheses")}</option>
                  <option value="minus">{t("settings.formatting.minus")}</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--color-onetext)]">
                <input
                  type="checkbox"
                  checked={draft.displayThousands}
                  onChange={(event) =>
                    setDraft({ ...draft, displayThousands: event.target.checked })
                  }
                />
                {t("settings.formatting.thousands")}
              </label>
              <label className="text-sm font-medium text-[var(--color-onetextsecondary)]">
                {t("settings.formatting.decimals")}
                <select
                  className={CONTROL_CLASS}
                  value={draft.displayDecimals}
                  onChange={(event) =>
                    setDraft({ ...draft, displayDecimals: event.target.value as DisplayDecimals })
                  }
                >
                  {DISPLAY_DECIMAL_OPTIONS.map((decimals) => (
                    <option key={decimals} value={decimals}>
                      {decimals}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 rounded-md bg-[var(--color-onesurfacealt)] p-3">
              <span className="block text-xs text-[var(--color-onetextmuted)]">
                {t("settings.formatting.preview")}
              </span>
              <span className="mt-1 block text-lg font-semibold">
                <MoneyCell
                  decimal="-1234567.89"
                  currency={draft.defaultCurrency}
                  locale={draft.locale}
                  negativeStyle={draft.negativeStyle}
                  showInThousands={draft.displayThousands}
                  displayDecimals={DISPLAY_DECIMAL_VALUES[draft.displayDecimals]}
                />
              </span>
            </div>
          </Card>

          <Card title={t("settings.shortcuts.title")}>
            <div className="flex items-start gap-3">
              <Keyboard
                aria-hidden="true"
                className="mt-1 h-5 w-5 shrink-0 text-[var(--color-oneprimary)]"
              />
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{t("settings.shortcuts.caption")}</caption>
                <tbody>
                  {(["search", "close", "navigate", "activate"] as const).map((shortcut) => (
                    <tr
                      key={shortcut}
                      className="border-b border-[var(--color-oneborder)] last:border-0"
                    >
                      <th scope="row" className="py-2 pr-4 font-normal">
                        {t(`settings.shortcuts.actions.${shortcut}`)}
                      </th>
                      <td className="py-2 text-right">
                        <kbd className="rounded border border-[var(--color-oneborder)] px-2 py-1 text-xs">
                          {t(`settings.shortcuts.keys.${shortcut}`)}
                        </kbd>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={t("settings.updates.title")}>
            <label className="text-sm font-medium text-[var(--color-onetextsecondary)]">
              {t("settings.updates.channel")}
              <select
                className={CONTROL_CLASS}
                value={draft.updateChannel}
                onChange={(event) =>
                  setDraft({ ...draft, updateChannel: event.target.value as UpdateChannel })
                }
              >
                <option value="stable">{t("settings.updates.stable")}</option>
                <option value="beta">{t("settings.updates.beta")}</option>
              </select>
            </label>
            <p className="mt-3 text-xs text-[var(--color-onetextmuted)]">
              {t("settings.updates.nativeGate")} <code>update.check</code>
            </p>
          </Card>

          <Card title={t("settings.diagnostics.title")}>
            <div className="flex items-start gap-3">
              <Download
                aria-hidden="true"
                className="mt-1 h-5 w-5 shrink-0 text-[var(--color-oneprimary)]"
              />
              <div>
                <p className="text-sm text-[var(--color-onetextsecondary)]">
                  {t("settings.diagnostics.description")}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  disabled
                  aria-describedby="diagnostics-native-gate"
                >
                  {t("settings.diagnostics.export")}
                </Button>
                <p
                  id="diagnostics-native-gate"
                  className="mt-2 text-xs text-[var(--color-onetextmuted)]"
                >
                  {t("settings.diagnostics.nativeGate")} <code>app.diagnostics.export</code>
                </p>
              </div>
            </div>
          </Card>

          <Card title={t("settings.storage.title")}>
            <div className="flex items-start gap-3">
              <Database
                aria-hidden="true"
                className="mt-1 h-5 w-5 shrink-0 text-[var(--color-oneprimary)]"
              />
              <div className="min-w-0 flex-1">
                <span className="text-xs text-[var(--color-onetextmuted)]">
                  {t("settings.storage.current")}
                </span>
                <output className="mt-1 block text-sm font-medium">
                  {t("settings.storage.appData")}
                </output>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  disabled
                  aria-describedby="storage-native-gate"
                >
                  {t("settings.storage.change")}
                </Button>
                <p
                  id="storage-native-gate"
                  className="mt-2 text-xs text-[var(--color-onetextmuted)]"
                >
                  {t("settings.storage.nativeGate")}
                </p>
              </div>
            </div>
          </Card>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => setDraft(createDefaultSettings())}
            disabled={saving}
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            {t("settings.reset")}
          </Button>
          <Button type="submit" disabled={!canSave || saving}>
            {saving ? t("settings.saving") : t("common.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** S-075 Settings — app/UI preferences persisted locally under a versioned, validated key. */
export function SettingsPage() {
  const status = useSettingsStore((state) => state.status);
  const preferences = useSettingsStore((state) => state.preferences);
  const restoreIssue = useSettingsStore((state) => state.restoreIssue);
  const error = useSettingsStore((state) => state.error);
  const save = useSettingsStore((state) => state.save);

  if (status === "loading") return <SettingsLoading />;

  return (
    <SettingsForm
      key={JSON.stringify(preferences)}
      status={status}
      persisted={preferences}
      restoreIssue={restoreIssue}
      error={error}
      onSave={save}
    />
  );
}
