import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, StatePanel } from "@/components/ui";
import { call } from "@/api/bridge";
import type { BridgeError } from "@/api/bridge";
import { useSessionStore } from "@/stores/session";
import type { CompanyMeta } from "@/api/schema";
import { Building2, Copy, FolderOpen, Plus, Trash2 } from "lucide-react";

type ListPhase = "loading" | "ready" | "error";

function formatOpened(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** S-020 Company Manager — create/open/delete Companies (F-001; SCREENS-SPEC S-020). */
export function CompaniesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openCompany = useSessionStore((s) => s.open);
  const [phase, setPhase] = useState<ListPhase>("loading");
  const [companies, setCompanies] = useState<CompanyMeta[]>([]);
  const [listError, setListError] = useState<BridgeError | null>(null);
  const [deleting, setDeleting] = useState<CompanyMeta | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState<BridgeError | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deletedName, setDeletedName] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openErrorId, setOpenErrorId] = useState<string | null>(null);
  const [cloning, setCloning] = useState<CompanyMeta | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloneError, setCloneError] = useState<BridgeError | null>(null);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [clonedName, setClonedName] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = (await call("company.list", {})) as CompanyMeta[];
      setCompanies(data ?? []);
      setPhase("ready");
    } catch (err) {
      setListError(err as BridgeError);
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    // First statement is an await → the effect body performs no synchronous setState
    // (react-hooks/set-state-in-effect); loading state is the initial render default.
    void (async () => {
      await load();
    })();
  }, [load]);

  async function open(company: CompanyMeta) {
    setOpeningId(company.id);
    setOpenErrorId(null);
    const ok = await openCompany(company.company_file_path);
    setOpeningId(null);
    if (ok) {
      navigate("/app/dashboard");
    } else {
      setOpenErrorId(company.id);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await call("company.delete", {
        company_id: deleting.id,
        reason: deleteReason.trim(),
      });
      setDeletedName(deleting.name);
      setCompanies((cs) => cs.filter((c) => c.id !== deleting.id));
      setDeleting(null);
      setDeleteReason("");
    } catch (err) {
      setDeleteError(err as BridgeError);
    } finally {
      setDeleteBusy(false);
    }
  }

  function openClone(company: CompanyMeta) {
    setCloning(company);
    setCloneName(`${company.name} (Sandbox)`);
    setCloneError(null);
  }

  async function confirmClone() {
    if (!cloning) return;
    setCloneBusy(true);
    setCloneError(null);
    try {
      await call("company.clone_sandbox", {
        company_id: cloning.id,
        name: cloneName.trim(),
      });
      setClonedName(cloneName.trim());
      setCloning(null);
      setCloneName("");
      await load();
    } catch (err) {
      setCloneError(err as BridgeError);
    } finally {
      setCloneBusy(false);
    }
  }

  if (phase === "loading") {
    return (
      <div role="status" aria-label={t("common.loading")} className="flex flex-col gap-6">
        <header className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">{t("companies.title")}</h1>
        </header>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <StatePanel
        state="error"
        message={listError?.userMessage ?? t("companies.error.load")}
        errorCode={listError?.code}
        onRetry={() => {
          setPhase("loading");
          void load();
        }}
      />
    );
  }

  if (companies.length === 0) {
    return (
      <StatePanel
        state="empty"
        message={t("companies.empty.body")}
        actionLabel={t("companies.empty.action")}
        onAction={() => navigate("/wizard")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t("companies.title")}</h1>
          <p className="text-sm text-[var(--color-onetextsecondary)]">{t("companies.subtitle")}</p>
        </div>
        <Button onClick={() => navigate("/wizard")}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          {t("companies.newCompany")}
        </Button>
      </header>

      {deletedName && (
        <p role="status" className="text-sm text-[var(--color-onefavorable)]">
          {t("companies.delete.success", { name: deletedName })}
        </p>
      )}

      {clonedName && (
        <p role="status" className="text-sm text-[var(--color-onefavorable)]">
          {t("companies.clone.success", { name: clonedName })}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {companies.map((company) => {
          const opened = formatOpened(company.last_opened_at);
          const isOpening = openingId === company.id;
          const openFailed = openErrorId === company.id;
          return (
            <Card key={company.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Building2
                    aria-hidden="true"
                    className="h-4 w-4 text-[var(--color-onetextmuted)]"
                  />
                  <h2 className="text-sm font-semibold">{company.name}</h2>
                </div>
                <span className="rounded-full bg-[var(--color-onesurfacealt)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-onetextsecondary)]">
                  {t(`companies.type.${company.type}`)}
                </span>
              </div>

              <dl className="flex flex-col gap-1 text-xs text-[var(--color-onetextsecondary)]">
                <div className="flex justify-between">
                  <dt>{t("companies.currency")}</dt>
                  <dd className="font-medium tabular-nums">{company.default_currency_code}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>{t("companies.license")}</dt>
                  <dd className="font-medium">
                    {t(`companies.license.${company.license_status}`)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>{t("companies.lastOpenedLabel")}</dt>
                  <dd>{opened ?? t("companies.lastOpenedNever")}</dd>
                </div>
              </dl>

              {openFailed && (
                <p role="alert" className="text-xs text-[var(--color-onerror)]">
                  {t("companies.open.error")}
                </p>
              )}

              <div className="mt-auto flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isOpening}
                  onClick={() => void open(company)}
                >
                  <FolderOpen aria-hidden="true" className="h-3.5 w-3.5" />
                  {isOpening ? t("companies.opening") : t("companies.open")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => openClone(company)}>
                  <Copy aria-hidden="true" className="h-3.5 w-3.5" />
                  {t("companies.clone")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(company)}>
                  <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                  {t("companies.delete")}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {deleting && (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label={t("common.close")}
            tabIndex={-1}
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              if (!deleteBusy) setDeleting(null);
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("companies.delete.title", { name: deleting.name })}
            className="absolute left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-6 shadow-xl"
          >
            <h2 className="text-sm font-semibold">
              {t("companies.delete.title", { name: deleting.name })}
            </h2>
            <p className="mt-2 text-sm text-[var(--color-onetextsecondary)]">
              {t("companies.delete.body")}
            </p>
            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-medium text-[var(--color-onetextsecondary)]">
                {t("companies.delete.reason")}
              </span>
              <textarea
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder={t("companies.delete.reasonPlaceholder")}
                rows={3}
                className="w-full rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-2 text-sm outline-none focus:border-[var(--color-oneprimary)]"
              />
            </label>
            {deleteError && (
              <p role="alert" className="mt-3 text-sm text-[var(--color-onerror)]">
                {deleteError.userMessage}
                <span className="mt-1 block font-mono text-xs opacity-70">{deleteError.code}</span>
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" disabled={deleteBusy} onClick={() => setDeleting(null)}>
                {t("companies.delete.cancel")}
              </Button>
              <Button
                variant="danger"
                disabled={deleteBusy || deleteReason.trim().length === 0}
                onClick={() => void confirmDelete()}
              >
                {t("companies.delete.confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {cloning && (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label={t("common.close")}
            tabIndex={-1}
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              if (!cloneBusy) setCloning(null);
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("companies.clone.title", { name: cloning.name })}
            className="absolute left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-6 shadow-xl"
          >
            <h2 className="text-sm font-semibold">
              {t("companies.clone.title", { name: cloning.name })}
            </h2>
            <p className="mt-2 text-sm text-[var(--color-onetextsecondary)]">
              {t("companies.clone.body")}
            </p>
            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-medium text-[var(--color-onetextsecondary)]">
                {t("companies.clone.name")}
              </span>
              <input
                type="text"
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                placeholder={t("companies.clone.namePlaceholder")}
                className="w-full rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-2 text-sm outline-none focus:border-[var(--color-oneprimary)]"
              />
            </label>
            {cloneError && (
              <p role="alert" className="mt-3 text-sm text-[var(--color-onerror)]">
                {cloneError.userMessage}
                <span className="mt-1 block font-mono text-xs opacity-70">{cloneError.code}</span>
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" disabled={cloneBusy} onClick={() => setCloning(null)}>
                {t("companies.clone.cancel")}
              </Button>
              <Button
                disabled={cloneBusy || cloneName.trim().length < 2}
                onClick={() => void confirmClone()}
              >
                {t("companies.clone.action")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
