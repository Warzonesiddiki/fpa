import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input, StatePanel } from "@/components/ui";
import { ModelSectionNav } from "@/components/domain/ModelSectionNav";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";
import type { PackMeta } from "@/api/schema";
import { Package } from "lucide-react";

type LoadPhase = "loading" | "ready" | "error";

const PACK_SCHEMA_VERSION = "1.0.0"; // packs/schema/pack.schema.json (INDUSTRY-PACK-SPEC §3)

const COMPONENT_KEYS = ["coa", "kpis", "drivers", "layouts", "calendar"] as const;

/** S-023 Pack Studio — installed Pack inventory (F-005; SCREENS-SPEC S-023). */
export function PacksPage() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [packs, setPacks] = useState<PackMeta[]>([]);
  const [error, setError] = useState<BridgeError | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = (await call("pack.list", {})) as PackMeta[];
      setPacks(data ?? []);
      setSelectedKey((k) => k ?? data?.[0]?.key ?? null);
      setPhase("ready");
    } catch (err) {
      setError(err as BridgeError);
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    // First statement is an await → no synchronous setState inside the effect body.
    void (async () => {
      await load();
    })();
  }, [load]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return packs;
    return packs.filter((p) => `${p.name} ${p.key}`.toLowerCase().includes(q));
  }, [packs, filter]);

  const selected = packs.find((p) => p.key === selectedKey) ?? null;

  if (phase === "loading") {
    return (
      <div role="status" aria-label={t("common.loading")} className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t("packs.title")}</h1>
        <ModelSectionNav />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t("packs.title")}</h1>
        <ModelSectionNav />
        <StatePanel
          state="error"
          message={error?.userMessage ?? t("packs.error.load")}
          errorCode={error?.code}
          onRetry={() => {
            setPhase("loading");
            void load();
          }}
        />
      </div>
    );
  }

  if (packs.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t("packs.title")}</h1>
        <ModelSectionNav />
        <StatePanel
          state="empty"
          message={t("packs.empty.body")}
          actionLabel={t("packs.empty.action")}
          onAction={() => {
            setPhase("loading");
            void load();
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("packs.title")}</h1>
          <p className="text-sm text-[var(--color-onetextsecondary)]">{t("packs.subtitle")}</p>
        </div>
        <Input
          label={t("packs.search")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs"
        />
      </div>
      <ModelSectionNav />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((pack) => {
          const conformant = pack.schema_version === PACK_SCHEMA_VERSION;
          const isSelected = selected?.key === pack.key;
          return (
            <button
              key={pack.key}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelectedKey(pack.key)}
              className={`flex flex-col gap-2 rounded-lg border p-4 text-left shadow-sm transition-colors ${
                isSelected
                  ? "border-[var(--color-oneprimary)] bg-[var(--color-oneprimary)]/5"
                  : "border-[var(--color-oneborder)] bg-[var(--color-onesurface)] hover:border-[var(--color-oneprimary)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-onetext)]">
                  <Package
                    aria-hidden="true"
                    className="h-4 w-4 text-[var(--color-onetextmuted)]"
                  />
                  {pack.name}
                </span>
                {pack.is_bundled && (
                  <span className="rounded-full bg-[var(--color-onesurfacealt)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-onetextsecondary)]">
                    {t("packs.bundled")}
                  </span>
                )}
              </div>
              <dl className="flex flex-col gap-1 text-xs text-[var(--color-onetextsecondary)]">
                <div className="flex justify-between">
                  <dt>{t("packs.versionLabel")}</dt>
                  <dd className="font-mono">{t("packs.version", { version: pack.version })}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>{t("packs.schemaLabel")}</dt>
                  <dd
                    className={
                      conformant
                        ? "font-mono text-[var(--color-onefavorable)]"
                        : "font-mono text-[var(--color-onerror)]"
                    }
                  >
                    {t("packs.schema", { version: pack.schema_version })}
                  </dd>
                </div>
              </dl>
              {!conformant && (
                <p role="alert" className="text-xs text-[var(--color-onerror)]">
                  {t("packs.schemaMismatch")}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 && <StatePanel state="empty" message={t("packs.noFilterMatches")} />}

      {selected && (
        <section
          aria-label={selected.name}
          className="rounded-lg border border-[var(--color-oneborder)] p-4"
        >
          <h2 className="text-sm font-semibold text-[var(--color-onetext)]">{selected.name}</h2>
          <p className="mt-1 text-xs text-[var(--color-onetextmuted)]">
            {selected.key} · {t("packs.version", { version: selected.version })}
          </p>
          <p className="mt-2 text-xs text-[var(--color-onetextsecondary)]">
            {selected.description}
          </p>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-[var(--color-onetextmuted)]">
            {t("packs.components")}
          </h3>
          <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {COMPONENT_KEYS.map((c) => (
              <li
                key={c}
                className="flex items-center justify-between rounded-md border border-[var(--color-oneborder)] px-3 py-2 text-sm"
              >
                <span className="text-[var(--color-onetext)]">{t(`packs.components.${c}`)}</span>
                <span className="text-xs text-[var(--color-onetextmuted)]">
                  {t("packs.component.bundledNote")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
