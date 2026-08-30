import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Input, StatePanel } from "@/components/ui";
import { ModelSectionNav } from "@/components/domain/ModelSectionNav";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";
import { useSessionStore } from "@/stores/session";
import type { AccountNode } from "@/api/schema";

const DIMENSIONS = [
  "cost-center",
  "project",
  "product",
  "customer",
  "channel",
  "fund",
  "program",
  "custom",
] as const;

type LoadPhase = "loading" | "ready" | "error";

/** S-021 Chart of Accounts — tree table + dimension tabs (F-002; SCREENS-SPEC S-021). */
export function CoaPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const companyId = useSessionStore((s) => s.companyId);
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [accounts, setAccounts] = useState<AccountNode[]>([]);
  const [error, setError] = useState<BridgeError | null>(null);
  const [filter, setFilter] = useState("");
  const [dimension, setDimension] = useState<(typeof DIMENSIONS)[number]>("cost-center");

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const data = (await call("coa.list", { company_id: companyId })) as AccountNode[];
      setAccounts(data ?? []);
      setPhase("ready");
    } catch (err) {
      setError(err as BridgeError);
      setPhase("error");
    }
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    // First statement is an await → no synchronous setState inside the effect body.
    void (async () => {
      await load();
    })();
  }, [companyId, load]);

  // Client-side tree: rows indented by depth (parent_id links; roots have depth 0).
  // When filtering, ancestors of a match are kept so children never orphan (S-021 tree table).
  const tree = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const keep = new Set<string>();
    if (!q) {
      for (const a of accounts) keep.add(a.id);
    } else {
      for (const a of accounts) {
        if (!`${a.code} ${a.name}`.toLowerCase().includes(q)) continue;
        let cursor: string | null = a.id;
        while (cursor && !keep.has(cursor)) {
          keep.add(cursor);
          cursor = byId.get(cursor)?.parent_id ?? null;
        }
      }
    }
    const byParent = new Map<string | null, AccountNode[]>();
    for (const a of accounts) {
      if (!keep.has(a.id)) continue;
      const list = byParent.get(a.parent_id) ?? [];
      list.push(a);
      byParent.set(a.parent_id, list);
    }
    const rows: { node: AccountNode; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const a of byParent.get(parent) ?? []) {
        rows.push({ node: a, depth });
        walk(a.id, depth + 1);
      }
    };
    walk(null, 0);
    return rows;
  }, [accounts, filter]);

  if (!companyId) {
    return <StatePanel state="empty" message={t("coa.noCompany")} />;
  }

  if (phase === "loading") {
    return (
      <div role="status" aria-label={t("common.loading")} className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t("coa.title")}</h1>
        <ModelSectionNav />
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-[var(--color-onesurfacealt)]" />
          ))}
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t("coa.title")}</h1>
        <ModelSectionNav />
        <StatePanel
          state="error"
          message={error?.userMessage ?? t("coa.error.load")}
          errorCode={error?.code}
          onRetry={() => {
            setPhase("loading");
            void load();
          }}
        />
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t("coa.title")}</h1>
        <ModelSectionNav />
        <StatePanel
          state="empty"
          message={t("coa.empty.body")}
          actionLabel={t("coa.empty.action")}
          onAction={() => navigate("/app/model/packs")}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("coa.title")}</h1>
      <ModelSectionNav />

      <div className="flex items-center justify-between gap-4">
        <Input
          label={t("coa.search")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs"
        />
        <p className="text-xs text-[var(--color-onetextmuted)]">
          {t("coa.count", { count: accounts.length })}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--color-oneborder)]">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] text-xs uppercase tracking-wide text-[var(--color-onetextmuted)]">
            <tr>
              <th scope="col" className="px-3 py-2">
                {t("coa.code")}
              </th>
              <th scope="col" className="px-3 py-2">
                {t("coa.name")}
              </th>
              <th scope="col" className="px-3 py-2">
                {t("coa.type")}
              </th>
              <th scope="col" className="px-3 py-2">
                {t("coa.section")}
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                {t("coa.usage")}
              </th>
            </tr>
          </thead>
          <tbody>
            {tree.map(({ node, depth }) => (
              <tr key={node.id} className="border-b border-[var(--color-oneborder)] last:border-0">
                <td
                  className="px-3 py-2 font-mono text-xs"
                  style={{ paddingLeft: `${12 + depth * 16}px` }}
                >
                  {node.code}
                </td>
                <td className="px-3 py-2 font-medium">{node.name}</td>
                <td className="px-3 py-2 text-xs text-[var(--color-onetextsecondary)]">
                  {t(`coa.accountType.${node.account_type}`)}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--color-onetextsecondary)]">
                  {node.report_section}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-xs">
                  {node.usage_count > 0 ? node.usage_count : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-[var(--color-oneborder)]">
        <div
          role="tablist"
          aria-label={t("coa.dimensions")}
          className="flex flex-wrap gap-1 border-b border-[var(--color-oneborder)] p-2"
        >
          {DIMENSIONS.map((d) => (
            <button
              key={d}
              role="tab"
              aria-selected={dimension === d}
              onClick={() => setDimension(d)}
              className={`rounded-md px-3 py-1.5 text-xs ${
                dimension === d
                  ? "bg-[var(--color-oneprimary)] text-white"
                  : "text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurfacealt)]"
              }`}
            >
              {t(`coa.dims.${d}`)}
            </button>
          ))}
        </div>
        <p className="p-4 text-sm text-[var(--color-onetextmuted)]">{t("coa.dims.empty")}</p>
      </div>
    </div>
  );
}
