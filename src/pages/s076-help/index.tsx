import { useMemo, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Search,
  BookOpen,
  Keyboard,
  Calculator,
  Cpu,
  AlertTriangle,
  RotateCcw,
  Layers,
  XCircle,
  HelpCircle,
} from "lucide-react";
import { Button, Input, type ScreenState } from "@/components/ui";
import { HELP_TOPICS, SHORTCUTS_DATA, type HelpCategory } from "./helpData";
import { ERROR_CATALOG } from "./errorCatalog";

interface HelpPageProps {
  initialState?: ScreenState;
  initialTopic?: string;
}

export default function HelpPage({ initialState, initialTopic }: HelpPageProps = {}) {
  const { t } = useTranslation();
  const { topic: routeTopic } = useParams<{ topic?: string }>();
  const navigate = useNavigate();

  const [searchParams] = useSearchParams();
  // Deep-link seed (?q=CODE from a StatePanel chip): applies until the user types.
  const qSeed = searchParams.get("q") ?? "";
  const [userQuery, setUserQuery] = useState<string | null>(null);
  const searchQuery = userQuery ?? qSeed;
  const setSearchQuery = setUserQuery;
  const [selectedCategory, setSelectedCategory] = useState<HelpCategory | "all">("all");
  const [userActiveTopicId, setUserActiveTopicId] = useState<string | null>(null);
  const [userPageState, setUserPageState] = useState<ScreenState | null>(null);

  const pageState = userPageState ?? initialState ?? "populated";

  const filteredTopics = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return HELP_TOPICS.filter((item) => {
      const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
      if (!matchesCategory) return false;

      if (!query) return true;

      const inTitle = item.title.toLowerCase().includes(query);
      const inDef = item.definition.toLowerCase().includes(query);
      const inFormula = item.formula?.toLowerCase().includes(query) ?? false;
      const inExample = item.example?.toLowerCase().includes(query) ?? false;
      const inTags = item.tags.some((tag) => tag.toLowerCase().includes(query));
      const inSynonyms =
        item.synonymsBanned?.some((syn) => syn.toLowerCase().includes(query)) ?? false;

      return inTitle || inDef || inFormula || inExample || inTags || inSynonyms;
    });
  }, [searchQuery, selectedCategory]);

  const activeTopicId = useMemo(() => {
    if (selectedCategory === "shortcuts") {
      return "shortcuts";
    }
    if (userActiveTopicId && filteredTopics.some((t) => t.id === userActiveTopicId)) {
      return userActiveTopicId;
    }
    const target = routeTopic ?? initialTopic;
    if (target && filteredTopics.some((t) => t.id === target)) {
      return target;
    }
    return filteredTopics.length > 0 ? filteredTopics[0].id : "onefpa";
  }, [selectedCategory, userActiveTopicId, filteredTopics, routeTopic, initialTopic]);

  const setActiveTopicId = useCallback((id: string) => {
    setUserActiveTopicId(id);
  }, []);

  const setPageState = useCallback((state: ScreenState) => {
    setUserPageState(state);
  }, []);

  const activeTopic = useMemo(() => {
    return HELP_TOPICS.find((t) => t.id === activeTopicId) || null;
  }, [activeTopicId]);

  const isShortcutsActive = selectedCategory === "shortcuts" || activeTopicId === "shortcuts";
  // Errors category + /app/help/errors deep link both activate the Error reference
  // (ERROR-HANDLING §3 rule 5). Derived, never an effect-set state (React Compiler).
  const isErrorsActive = selectedCategory === "errors" || routeTopic === "errors";

  const filteredErrors = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return ERROR_CATALOG;
    return ERROR_CATALOG.filter(
      (e) =>
        e.code.toLowerCase().includes(query) ||
        e.userMessage.toLowerCase().includes(query) ||
        e.cause.toLowerCase().includes(query),
    );
  }, [searchQuery]);

  const handleSelectTopic = (id: string) => {
    setActiveTopicId(id);
    navigate(`/app/help/${id}`);
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setSelectedCategory("all");
    setActiveTopicId("onefpa");
  };

  const topicExists = useMemo(() => {
    if (!routeTopic) return true;
    if (routeTopic === "shortcuts" || routeTopic === "errors") return true;
    return HELP_TOPICS.some((t) => t.id === routeTopic);
  }, [routeTopic]);

  // 1. Loading State
  if (pageState === "loading") {
    return (
      <div className="flex flex-col gap-6" data-screen-state="loading">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-[var(--color-onetext)]">{t("help.title")}</h1>
          <p className="text-sm text-[var(--color-onetextsecondary)]">{t("help.subtitle")}</p>
        </div>
        <div
          role="status"
          aria-label={t("common.loading")}
          className="grid gap-6 md:grid-cols-[280px_1fr]"
        >
          <div className="flex flex-col gap-3">
            <div className="h-10 animate-pulse rounded-md bg-[var(--color-onesurfacealt)]" />
            <div className="flex flex-col gap-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-md bg-[var(--color-onesurfacealt)]"
                />
              ))}
            </div>
          </div>
          <div className="h-96 animate-pulse rounded-lg bg-[var(--color-onesurfacealt)]" />
          <span className="sr-only">{t("common.loading")}</span>
        </div>
      </div>
    );
  }

  // 2. Error State (e.g. HELP_TOPIC_MISSING)
  if (pageState === "error" || !topicExists) {
    return (
      <div className="flex flex-col gap-6" data-screen-state="error">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-[var(--color-onetext)]">{t("help.title")}</h1>
        </div>
        <div
          role="alert"
          className="mx-auto flex max-w-lg flex-col items-center gap-4 rounded-xl border border-[var(--color-onerror)] bg-[var(--color-onesurface)] p-8 text-center"
        >
          <AlertTriangle aria-hidden="true" className="h-10 w-10 text-[var(--color-onerror)]" />
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-[var(--color-onetext)]">
              {t("help.topicMissing")}
            </h2>
            <p className="text-sm text-[var(--color-onetextsecondary)]">{t("help.emptyHint")}</p>
            <p className="mt-2 font-mono text-xs text-[var(--color-onerror)]">
              {t("help.topicMissingCode")}
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPageState("populated");
                setActiveTopicId("onefpa");
                navigate("/app/help/onefpa");
              }}
            >
              <RotateCcw aria-hidden="true" className="mr-1.5 h-4 w-4" />
              {t("help.categories.all")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-6"
      data-screen-state={
        pageState === "success"
          ? "success"
          : filteredTopics.length === 0 && !isShortcutsActive
            ? "empty"
            : "populated"
      }
    >
      {/* Page Header */}
      <header className="flex flex-col gap-1 border-b border-[var(--color-oneborder)] pb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-onetext)]">
            {t("help.title")}
          </h1>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] px-3 py-1 text-xs font-medium text-[var(--color-onetextsecondary)]">
            <HelpCircle aria-hidden="true" className="h-3.5 w-3.5" />
            F-038 In-App Knowledge Base
          </span>
        </div>
        <p className="text-sm text-[var(--color-onetextsecondary)]">{t("help.subtitle")}</p>
      </header>

      {/* Main 2-Pane Geometry */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
        {/* Left Sidebar: Search & Category Navigation */}
        <nav aria-label="Help categories and topics" className="flex flex-col gap-4">
          {/* Search bar */}
          <div className="relative">
            <Input
              id="help-search-input"
              label=""
              placeholder={t("help.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leading={
                <Search aria-hidden="true" className="h-4 w-4 text-[var(--color-onetextmuted)]" />
              }
              aria-label={t("help.searchPlaceholder")}
              className="pr-8"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search input"
                className="absolute right-2.5 top-2.5 text-[var(--color-onetextmuted)] hover:text-[var(--color-onetext)]"
              >
                <XCircle aria-hidden="true" className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Category Tabs */}
          <div
            role="tablist"
            aria-label="Categories"
            className="flex flex-col gap-1 rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-1.5"
          >
            <button
              role="tab"
              aria-label={t("help.categories.all")}
              aria-selected={selectedCategory === "all"}
              onClick={() => setSelectedCategory("all")}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                selectedCategory === "all"
                  ? "bg-[var(--color-oneprimary)] text-white"
                  : "text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurfacealt)] hover:text-[var(--color-onetext)]"
              }`}
            >
              <Layers aria-hidden="true" className="h-3.5 w-3.5" />
              <span>{t("help.categories.all")}</span>
              <span aria-hidden="true" className="ml-auto text-[10px] opacity-80">
                {HELP_TOPICS.length}
              </span>
            </button>

            <button
              role="tab"
              aria-label={t("help.categories.glossary")}
              aria-selected={selectedCategory === "glossary"}
              onClick={() => setSelectedCategory("glossary")}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                selectedCategory === "glossary"
                  ? "bg-[var(--color-oneprimary)] text-white"
                  : "text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurfacealt)] hover:text-[var(--color-onetext)]"
              }`}
            >
              <BookOpen aria-hidden="true" className="h-3.5 w-3.5" />
              <span>{t("help.categories.glossary")}</span>
              <span aria-hidden="true" className="ml-auto text-[10px] opacity-80">
                {HELP_TOPICS.filter((t) => t.category === "glossary").length}
              </span>
            </button>

            <button
              role="tab"
              aria-label={t("help.categories.formulas")}
              aria-selected={selectedCategory === "formulas"}
              onClick={() => setSelectedCategory("formulas")}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                selectedCategory === "formulas"
                  ? "bg-[var(--color-oneprimary)] text-white"
                  : "text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurfacealt)] hover:text-[var(--color-onetext)]"
              }`}
            >
              <Calculator aria-hidden="true" className="h-3.5 w-3.5" />
              <span>{t("help.categories.formulas")}</span>
              <span aria-hidden="true" className="ml-auto text-[10px] opacity-80">
                {HELP_TOPICS.filter((t) => t.category === "formulas").length}
              </span>
            </button>

            <button
              role="tab"
              aria-label={t("help.categories.architecture")}
              aria-selected={selectedCategory === "architecture"}
              onClick={() => setSelectedCategory("architecture")}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                selectedCategory === "architecture"
                  ? "bg-[var(--color-oneprimary)] text-white"
                  : "text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurfacealt)] hover:text-[var(--color-onetext)]"
              }`}
            >
              <Cpu aria-hidden="true" className="h-3.5 w-3.5" />
              <span>{t("help.categories.architecture")}</span>
              <span aria-hidden="true" className="ml-auto text-[10px] opacity-80">
                {HELP_TOPICS.filter((t) => t.category === "architecture").length}
              </span>
            </button>

            <button
              role="tab"
              aria-label={t("help.categories.shortcuts")}
              aria-selected={selectedCategory === "shortcuts"}
              onClick={() => {
                setSelectedCategory("shortcuts");
                setActiveTopicId("shortcuts");
              }}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                selectedCategory === "shortcuts"
                  ? "bg-[var(--color-oneprimary)] text-white"
                  : "text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurfacealt)] hover:text-[var(--color-onetext)]"
              }`}
            >
              <Keyboard aria-hidden="true" className="h-3.5 w-3.5" />
              <span>{t("help.categories.shortcuts")}</span>
              <span aria-hidden="true" className="ml-auto text-[10px] opacity-80">
                {SHORTCUTS_DATA.length}
              </span>
            </button>

            <button
              role="tab"
              aria-label={t("help.categories.errors")}
              aria-selected={isErrorsActive}
              onClick={() => {
                setSelectedCategory("errors");
                navigate("/app/help/errors");
              }}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                isErrorsActive
                  ? "bg-[var(--color-oneprimary)] text-white"
                  : "text-[var(--color-onetextsecondary)] hover:bg-[var(--color-onesurfacealt)] hover:text-[var(--color-onetext)]"
              }`}
            >
              <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
              <span>{t("help.categories.errors")}</span>
              <span aria-hidden="true" className="ml-auto text-[10px] opacity-80">
                {ERROR_CATALOG.length}
              </span>
            </button>
          </div>

          {/* Topic List */}
          <div className="flex flex-col gap-1 overflow-y-auto max-h-[550px] pr-1">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-onetextmuted)]">
              Topics ({filteredTopics.length})
            </h2>

            {filteredTopics.map((topic) => (
              <button
                key={topic.id}
                type="button"
                onClick={() => handleSelectTopic(topic.id)}
                className={`flex flex-col gap-0.5 rounded-lg border p-2.5 text-left transition-colors ${
                  activeTopicId === topic.id && selectedCategory !== "shortcuts" && !isErrorsActive
                    ? "border-[var(--color-oneprimary)] bg-[var(--color-onesurfacealt)]"
                    : "border-transparent hover:border-[var(--color-oneborder)] hover:bg-[var(--color-onesurface)]"
                }`}
              >
                <span className="text-xs font-semibold text-[var(--color-onetext)]">
                  {topic.title}
                </span>
                <span className="line-clamp-1 text-[11px] text-[var(--color-onetextsecondary)]">
                  {topic.definition}
                </span>
              </button>
            ))}
          </div>
        </nav>

        {/* Right Content: Explainer Card or Shortcuts Cheatsheet */}
        <main aria-label="Help topic details" className="flex flex-col gap-6">
          {/* 3. Empty State */}
          {filteredTopics.length === 0 && !isShortcutsActive && !isErrorsActive ? (
            <div
              role="status"
              data-screen-state="empty"
              className="flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-8 text-center"
            >
              <Search aria-hidden="true" className="h-10 w-10 text-[var(--color-onetextmuted)]" />
              <div className="flex flex-col gap-1">
                <h2 className="text-base font-semibold text-[var(--color-onetext)]">
                  {t("help.empty")}
                </h2>
                <p className="text-sm text-[var(--color-onetextsecondary)]">
                  {t("help.emptyHint")}
                </p>
              </div>
              <Button size="sm" onClick={handleClearSearch}>
                {t("help.clearSearch")}
              </Button>
            </div>
          ) : isErrorsActive ? (
            /* Error Reference — every §2 code, generated (ERROR-HANDLING §3 rule 5) */
            <section
              aria-labelledby="error-reference-title"
              data-testid="error-reference"
              className="flex flex-col gap-4 rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-oneborder)] pb-3">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle
                    aria-hidden="true"
                    className="h-5 w-5 text-[var(--color-oneprimary)]"
                  />
                  <h2
                    id="error-reference-title"
                    className="text-lg font-semibold text-[var(--color-onetext)]"
                  >
                    {t("help.errors.title")}
                  </h2>
                </div>
                <span
                  className="text-xs text-[var(--color-onetextmuted)]"
                  data-testid="error-reference-count"
                >
                  {t("help.errors.count", { count: filteredErrors.length })}
                </span>
              </div>
              <p className="text-sm text-[var(--color-onetextsecondary)]">
                {t("help.errors.subtitle")}
              </p>

              {filteredErrors.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--color-onetextmuted)]">
                  {t("help.errors.noMatches")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm" role="table">
                    <caption className="sr-only">
                      Error reference: code, meaning, HTTP status, and whether the action can be
                      retried.
                    </caption>
                    <thead>
                      <tr className="border-b border-[var(--color-oneborder)] text-xs font-semibold text-[var(--color-onetextmuted)]">
                        <th scope="col" className="pb-3 pr-4 font-semibold">
                          {t("help.errors.colCode")}
                        </th>
                        <th scope="col" className="pb-3 px-4 font-semibold">
                          {t("help.errors.colMeaning")}
                        </th>
                        <th scope="col" className="pb-3 px-4 font-semibold">
                          {t("help.errors.colHttp")}
                        </th>
                        <th scope="col" className="pb-3 pl-4 font-semibold">
                          {t("help.errors.colRetry")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-oneborder)]">
                      {filteredErrors.map((e) => (
                        <tr key={e.code} data-testid={`error-row-${e.code}`}>
                          <td className="py-2.5 pr-4 align-top">
                            <code className="rounded bg-[var(--color-onesurfacealt)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-onetext)]">
                              {e.code}
                            </code>
                          </td>
                          <td className="py-2.5 px-4 align-top text-[var(--color-onetext)]">
                            {e.userMessage}
                          </td>
                          <td className="py-2.5 px-4 align-top text-xs text-[var(--color-onetextsecondary)]">
                            {e.httpStatus}
                          </td>
                          <td className="py-2.5 pl-4 align-top text-xs">
                            {e.retryable ? (
                              <span
                                className="rounded-full bg-[var(--color-onefavorable)]/10 px-2 py-0.5 font-medium text-[var(--color-onefavorable)]"
                                title={t("help.errors.retryableYes")}
                              >
                                {t("help.errors.retryableYes")}
                              </span>
                            ) : (
                              <span className="text-[var(--color-onetextmuted)]">
                                {t("help.errors.retryableNo")}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : isShortcutsActive ? (
            /* Shortcuts Cheatsheet Table */
            <section
              aria-labelledby="shortcuts-table-title"
              className="flex flex-col gap-4 rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-6"
            >
              <div className="flex items-center justify-between border-b border-[var(--color-oneborder)] pb-3">
                <div className="flex items-center gap-2.5">
                  <Keyboard aria-hidden="true" className="h-5 w-5 text-[var(--color-oneprimary)]" />
                  <h2
                    id="shortcuts-table-title"
                    className="text-lg font-semibold text-[var(--color-onetext)]"
                  >
                    {t("help.shortcutsTable.title")}
                  </h2>
                </div>
                <span className="text-xs text-[var(--color-onetextmuted)]">
                  F-038 Keyboard-Only Accessible
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm" role="table">
                  <caption className="sr-only">
                    Application keyboard shortcuts with action, Windows or Linux keys, macOS keys,
                    and scope context.
                  </caption>
                  <thead>
                    <tr className="border-b border-[var(--color-oneborder)] text-xs font-semibold text-[var(--color-onetextmuted)]">
                      <th scope="col" className="pb-3 pr-4 font-semibold">
                        {t("help.shortcutsTable.action")}
                      </th>
                      <th scope="col" className="pb-3 px-4 font-semibold">
                        {t("help.shortcutsTable.winLinux")}
                      </th>
                      <th scope="col" className="pb-3 px-4 font-semibold">
                        {t("help.shortcutsTable.mac")}
                      </th>
                      <th scope="col" className="pb-3 pl-4 font-semibold">
                        {t("help.shortcutsTable.context")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-oneborder)]">
                    {SHORTCUTS_DATA.map((sc) => (
                      <tr
                        key={sc.id}
                        className="hover:bg-[var(--color-onesurfacealt)] transition-colors"
                      >
                        <td className="py-3 pr-4 font-medium text-[var(--color-onetext)]">
                          {sc.action}
                        </td>
                        <td className="py-3 px-4">
                          <kbd className="inline-block rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] px-2 py-0.5 font-mono text-xs text-[var(--color-onetext)]">
                            {sc.keysWinLinux}
                          </kbd>
                        </td>
                        <td className="py-3 px-4">
                          <kbd className="inline-block rounded border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] px-2 py-0.5 font-mono text-xs text-[var(--color-onetext)]">
                            {sc.keysMac}
                          </kbd>
                        </td>
                        <td className="py-3 pl-4 text-xs text-[var(--color-onetextsecondary)]">
                          {sc.context}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : activeTopic ? (
            /* Explainer Card View (D-008 / S-076 Shape: Definition -> Formula -> Worked Example -> Source/Notes) */
            <article
              aria-labelledby={`topic-title-${activeTopic.id}`}
              className="flex flex-col gap-6 rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-6 shadow-sm"
            >
              {/* Card Header */}
              <div className="flex flex-col gap-2 border-b border-[var(--color-oneborder)] pb-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2
                    id={`topic-title-${activeTopic.id}`}
                    className="text-xl font-bold tracking-tight text-[var(--color-onetext)]"
                  >
                    {activeTopic.title}
                  </h2>
                  <span className="rounded-full bg-[var(--color-onesurfacealt)] px-3 py-1 text-xs font-medium capitalize text-[var(--color-oneprimary)]">
                    {activeTopic.category}
                  </span>
                </div>
                {/* Tags */}
                <div className="flex flex-wrap gap-1.5" aria-label="Topic tags">
                  {activeTopic.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded border border-[var(--color-oneborder)] px-2 py-0.5 text-[10px] text-[var(--color-onetextmuted)]"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* 1. Definition */}
              <section
                aria-labelledby={`def-title-${activeTopic.id}`}
                className="flex flex-col gap-1.5"
              >
                <h3
                  id={`def-title-${activeTopic.id}`}
                  className="text-xs font-semibold uppercase tracking-wider text-[var(--color-onetextmuted)]"
                >
                  {t("help.definition")}
                </h3>
                <p className="text-sm leading-relaxed text-[var(--color-onetext)]">
                  {activeTopic.definition}
                </p>
              </section>

              {/* 2. Mathematical Formula (if available) */}
              {activeTopic.formula && (
                <section
                  aria-labelledby={`formula-title-${activeTopic.id}`}
                  className="flex flex-col gap-1.5"
                >
                  <h3
                    id={`formula-title-${activeTopic.id}`}
                    className="text-xs font-semibold uppercase tracking-wider text-[var(--color-onetextmuted)]"
                  >
                    {t("help.formula")}
                  </h3>
                  <div className="overflow-x-auto rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-3">
                    <pre className="font-mono text-xs leading-relaxed text-[var(--color-onetext)] whitespace-pre-wrap">
                      {activeTopic.formula}
                    </pre>
                  </div>
                </section>
              )}

              {/* 3. Practical FP&A Example (if available) */}
              {activeTopic.example && (
                <section
                  aria-labelledby={`example-title-${activeTopic.id}`}
                  className="flex flex-col gap-1.5"
                >
                  <h3
                    id={`example-title-${activeTopic.id}`}
                    className="text-xs font-semibold uppercase tracking-wider text-[var(--color-onetextmuted)]"
                  >
                    {t("help.example")}
                  </h3>
                  <div className="rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-4">
                    <pre className="font-mono text-xs leading-relaxed text-[var(--color-onetextsecondary)] whitespace-pre-wrap">
                      {activeTopic.example}
                    </pre>
                  </div>
                </section>
              )}

              {/* 4. Source & Traceability */}
              {activeTopic.source && (
                <section
                  aria-labelledby={`source-title-${activeTopic.id}`}
                  className="flex flex-col gap-1.5"
                >
                  <h3
                    id={`source-title-${activeTopic.id}`}
                    className="text-xs font-semibold uppercase tracking-wider text-[var(--color-onetextmuted)]"
                  >
                    {t("help.source")}
                  </h3>
                  <p className="font-mono text-xs text-[var(--color-onetextsecondary)]">
                    {activeTopic.source}
                  </p>
                </section>
              )}

              {/* 5. Rules & Notes */}
              {activeTopic.notes && (
                <section
                  aria-labelledby={`notes-title-${activeTopic.id}`}
                  className="flex flex-col gap-1.5"
                >
                  <h3
                    id={`notes-title-${activeTopic.id}`}
                    className="text-xs font-semibold uppercase tracking-wider text-[var(--color-onetextmuted)]"
                  >
                    {t("help.notes")}
                  </h3>
                  <p className="text-xs leading-relaxed text-[var(--color-onetextsecondary)]">
                    {activeTopic.notes}
                  </p>
                </section>
              )}

              {/* 6. Banned Synonyms Alert (GLOSSARY.md Mirroring) */}
              {activeTopic.synonymsBanned && activeTopic.synonymsBanned.length > 0 && (
                <div
                  role="note"
                  aria-label="Banned terminology notice"
                  className="mt-2 rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurfacealt)] p-3 text-xs"
                >
                  <span className="font-semibold text-[var(--color-onerror)]">
                    {t("help.bannedSynonyms")}:{" "}
                  </span>
                  <span className="text-[var(--color-onetextmuted)] line-through">
                    {activeTopic.synonymsBanned.join(", ")}
                  </span>
                  <p className="mt-1 text-[11px] text-[var(--color-onetextmuted)]">
                    {t("help.bannedSynonymsHint")}
                  </p>
                </div>
              )}
            </article>
          ) : null}
        </main>
      </div>
    </div>
  );
}

export { HelpPage };
