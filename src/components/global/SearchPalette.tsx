import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { call } from "@/api/bridge";
import { useSessionStore } from "@/stores/session";
import { Loader2, Search, CornerDownLeft, AlertTriangle } from "lucide-react";

type ResultKind = "screen" | "company" | "pack";

interface IndexEntry {
  id: string;
  kind: ResultKind;
  title: string;
  subtitle: string | null;
  payload: string;
}

interface HistoryEntry extends IndexEntry {
  at: number;
}

const HISTORY_KEY = "onefpa.search.history.v1";
const HISTORY_MAX = 5;
const DEBOUNCE_MS = 150;

/** Route-catalog index (screens that exist in the router today; grows with each milestone). */
const SCREEN_INDEX: { id: string; path: string }[] = [
  { id: "dashboard", path: "/app/dashboard" },
  { id: "companies", path: "/app/companies" },
  { id: "import", path: "/app/import" },
  { id: "mapping", path: "/app/import/map" },
  { id: "importCommit", path: "/app/import/commit" },
  { id: "grid", path: "/app/model/grid" },
  { id: "coa", path: "/app/model/coa" },
  { id: "calendar", path: "/app/model/calendar" },
  { id: "packs", path: "/app/model/packs" },
  { id: "headcount", path: "/app/model/headcount" },
  { id: "settings", path: "/app/settings" },
  { id: "wizard", path: "/wizard" },
];

function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is HistoryEntry =>
          typeof e === "object" && e !== null && typeof (e as HistoryEntry).id === "string",
      )
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function writeHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX)));
  } catch {
    // storage unavailable (private mode) — history is best-effort, search still works
  }
}

function matches(entry: IndexEntry, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return `${entry.title} ${entry.subtitle ?? ""} ${entry.id}`.toLowerCase().includes(needle);
}

/** S-003 Global Search Palette — ⌘K overlay, route-less (SCREENS-SPEC S-003). */
export function SearchPalette({
  open,
  onOpen,
  onClose,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openCompany = useSessionStore((s) => s.open);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [index, setIndex] = useState<IndexEntry[] | null>(null);
  const [indexState, setIndexState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [history, setHistory] = useState<HistoryEntry[]>(readHistory);
  const [active, setActive] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K opens the palette from anywhere in the shell (S-003).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpen();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);

  // Rebuild the live index (companies + packs) each time the palette opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let finished = false;
    const timer = window.setTimeout(() => {
      // If the (usually slower) IPC index already resolved, don't clobber it
      // back to "loading" — otherwise the palette wedges on the spinner.
      if (finished) {
        inputRef.current?.focus();
        return;
      }
      setQuery("");
      setDebounced("");
      setActive(0);
      setIndexState("loading");
      inputRef.current?.focus();
    }, 0);
    async function load() {
      try {
        const [companies, packs] = await Promise.all([
          call("company.list", {}),
          call("pack.list", {}),
        ]);
        if (cancelled) return;
        finished = true;
        const entries: IndexEntry[] = [
          ...(companies as { id: string; name: string; company_file_path: string }[]).map((c) => ({
            id: c.id,
            kind: "company" as const,
            title: c.name,
            subtitle: c.company_file_path,
            payload: c.company_file_path,
          })),
          ...(packs as { key: string; name: string; version: string }[]).map((p) => ({
            id: p.key,
            kind: "pack" as const,
            title: p.name,
            subtitle: `v${p.version}`,
            payload: p.key,
          })),
        ];
        setIndex(entries);
        setIndexState("ready");
      } catch {
        if (!cancelled) {
          finished = true;
          setIndexState("error");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, reloadKey]);

  // Debounced query → spinner while waiting; selection resets with the query (S-003 loading state).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(query);
      setActive(0);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const sections = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    const screens: IndexEntry[] = SCREEN_INDEX.map((s) => ({
      id: s.id,
      kind: "screen" as const,
      title: t(`search.screens.${s.id}`),
      subtitle: s.path,
      payload: s.path,
    })).filter((e) => matches(e, q));
    const companies = (index ?? []).filter((e) => e.kind === "company" && matches(e, q));
    const packs = (index ?? []).filter((e) => e.kind === "pack" && matches(e, q));
    const recent = q
      ? []
      : history
          .filter((h) => {
            const live = index?.some((e) => e.kind === h.kind && e.id === h.id) ?? false;
            return live || h.kind === "screen";
          })
          .filter((h) => matches(h, q));
    return { recent, screens, companies, packs };
  }, [debounced, index, history, t]);

  const flat = useMemo(
    () => [...sections.recent, ...sections.screens, ...sections.companies, ...sections.packs],
    [sections],
  );

  if (!open) return null;

  function select(entry: IndexEntry) {
    const next: HistoryEntry[] = [
      { ...entry, at: Date.now() },
      ...history.filter((h) => !(h.kind === entry.kind && h.id === entry.id)),
    ].slice(0, HISTORY_MAX);
    setHistory(next);
    writeHistory(next);
    onClose();
    if (entry.kind === "screen") {
      navigate(entry.payload);
      return;
    }
    if (entry.kind === "company") {
      void openCompany(entry.payload).then((ok) => {
        if (ok) navigate("/app/dashboard");
      });
      return;
    }
    navigate("/app/model/packs");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(flat.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
      return;
    }
    if (e.key === "Enter" && flat[active]) {
      e.preventDefault();
      select(flat[active]);
    }
  }

  const searching = query !== debounced || indexState === "loading";
  const noMatches = !searching && flat.length === 0;
  const groupLabels: { key: keyof typeof sections; label: string }[] = [
    { key: "recent", label: t("search.groups.recent") },
    { key: "screens", label: t("search.groups.screens") },
    { key: "companies", label: t("search.groups.companies") },
    { key: "packs", label: t("search.groups.packs") },
  ];

  let offset = 0;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={t("common.close")}
        tabIndex={-1}
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("search.title")}
        className="absolute left-1/2 top-[12vh] w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-oneborder)] px-4">
          <Search aria-hidden="true" className="h-4 w-4 text-[var(--color-onetextmuted)]" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="search-results"
            aria-activedescendant={flat[active] ? `search-result-${active}` : undefined}
            aria-label={t("search.inputLabel")}
            placeholder={t("search.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-[var(--color-onetextmuted)]"
          />
          <kbd className="rounded border border-[var(--color-oneborder)] px-1.5 py-0.5 text-[10px] text-[var(--color-onetextmuted)]">
            ESC
          </kbd>
        </div>

        <div
          id="search-results"
          role="listbox"
          aria-label={t("search.results")}
          className="max-h-80 overflow-y-auto"
        >
          {searching && (
            <p
              role="status"
              className="flex items-center gap-2 px-4 py-6 text-sm text-[var(--color-onetextsecondary)]"
            >
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </p>
          )}

          {!searching && indexState === "error" && (
            <div className="px-4 py-4">
              <p
                role="alert"
                className="flex items-center gap-2 text-sm text-[var(--color-onerror)]"
              >
                <AlertTriangle aria-hidden="true" className="h-4 w-4" />
                {t("search.error.index")}
              </p>
              <button
                type="button"
                onClick={() => {
                  setIndexState("loading");
                  setReloadKey((k) => k + 1);
                }}
                className="mt-2 text-xs text-[var(--color-oneprimary)] underline"
              >
                {t("common.retry")}
              </button>
            </div>
          )}

          {noMatches && (
            <p className="px-4 py-6 text-sm text-[var(--color-onetextsecondary)]">
              {t("search.empty", { query: debounced })}
            </p>
          )}

          {!searching &&
            flat.length > 0 &&
            groupLabels.map(({ key, label }) => {
              const group = sections[key];
              if (group.length === 0) return null;
              const start = offset;
              offset += group.length;
              return (
                <section key={key} aria-label={label}>
                  <h2 className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-onetextmuted)]">
                    {label}
                  </h2>
                  <ul>
                    {group.map((entry, i) => {
                      const flatIndex = start + i;
                      const isActive = flatIndex === active;
                      return (
                        <li key={`${entry.kind}:${entry.id}`}>
                          <button
                            type="button"
                            id={`search-result-${flatIndex}`}
                            role="option"
                            aria-selected={isActive}
                            onMouseEnter={() => setActive(flatIndex)}
                            onClick={() => select(entry)}
                            className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${
                              isActive
                                ? "bg-[var(--color-oneprimary)] text-white"
                                : "text-[var(--color-onetext)]"
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate">{entry.title}</span>
                              {entry.subtitle && (
                                <span
                                  className={`block truncate text-xs ${
                                    isActive ? "text-white/70" : "text-[var(--color-onetextmuted)]"
                                  }`}
                                >
                                  {entry.subtitle}
                                </span>
                              )}
                            </span>
                            <CornerDownLeft
                              aria-hidden="true"
                              className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-white/70" : "text-[var(--color-onetextmuted)]"}`}
                            />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
        </div>
      </div>
    </div>
  );
}
