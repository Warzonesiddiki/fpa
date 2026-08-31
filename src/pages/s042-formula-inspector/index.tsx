import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, StatePanel } from "@/components/ui";
import { ModelSectionNav } from "@/components/domain/ModelSectionNav";
import { useModelGridStore } from "@/stores/model";
import type { CellInspectResult } from "@/workers/modelEngine";

/** S-042 Formula Inspector — read-only cell inspection (F-012 · M3-2 · SCREENS-SPEC S-042). */
export function FormulaInspectorPage() {
  const { t } = useTranslation();
  const lines = useModelGridStore((s) => s.lines);
  const periods = useModelGridStore((s) => s.periods);
  const status = useModelGridStore((s) => s.status);
  const load = useModelGridStore((s) => s.load);
  const inspectCell = useModelGridStore((s) => s.inspectCell);

  const [selectedLine, setSelectedLine] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [inspectResult, setInspectResult] = useState<CellInspectResult | null>(null);
  const [inspectState, setInspectState] = useState<
    "idle" | "loading" | "error" | "success" | "populated"
  >("idle");
  const [inspectError, setInspectError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading" || status === "error" || status === "empty") {
      void load();
    }
  }, [status, load]);

  const lineOptions = useMemo(() => lines, [lines]);
  const periodOptions = useMemo(() => periods, [periods]);

  const handleInspect = useCallback(async () => {
    if (!selectedLine || !selectedPeriod) return;
    setInspectState("loading");
    setInspectResult(null);
    setInspectError(null);
    try {
      const result = await inspectCell(selectedLine, selectedPeriod);
      setInspectResult(result);
      setInspectState("populated");
    } catch (err) {
      setInspectState("error");
      // Ban: never surface raw error.message — show a locked user-facing message instead.
      const msg = (err as { userMessage?: string }).userMessage;
      setInspectError(
        typeof msg === "string" && msg.length > 0 ? msg : t("inspectorPage.error.generic"),
      );
    }
  }, [inspectCell, selectedLine, selectedPeriod, t]);

  const hasSelection = selectedLine !== "" && selectedPeriod !== "";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("inspectorPage.title")}</h1>
      <ModelSectionNav />

      {(status === "loading" || status === "empty") && (
        <StatePanel state="loading" message={t("common.loading")} />
      )}

      {status === "error" && (
        <StatePanel
          state="error"
          message={t("inspectorPage.error.noGrid")}
          onRetry={() => void load()}
        />
      )}

      {status === "success" || status === "populated" ? (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-oneborder)] p-4">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t("inspectorPage.lineLabel")}
              <select
                value={selectedLine}
                onChange={(e) => {
                  setSelectedLine(e.target.value);
                  setInspectState("idle");
                  setInspectResult(null);
                }}
                className="h-9 min-w-48 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 text-sm"
                aria-label={t("inspectorPage.lineLabel")}
              >
                <option value="">{t("inspectorPage.selectLine")}</option>
                {lineOptions.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t("inspectorPage.periodLabel")}
              <select
                value={selectedPeriod}
                onChange={(e) => {
                  setSelectedPeriod(e.target.value);
                  setInspectState("idle");
                  setInspectResult(null);
                }}
                className="h-9 min-w-32 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 text-sm"
                aria-label={t("inspectorPage.periodLabel")}
              >
                <option value="">{t("inspectorPage.selectPeriod")}</option>
                {periodOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code}
                  </option>
                ))}
              </select>
            </label>
            <Button
              onClick={() => void handleInspect()}
              disabled={!hasSelection || inspectState === "loading"}
            >
              {t("inspectorPage.inspect")}
            </Button>
          </div>

          {inspectState === "idle" && !hasSelection && (
            <StatePanel state="empty" message={t("inspectorPage.empty")} />
          )}

          {inspectState === "loading" && (
            <StatePanel state="loading" message={t("common.loading")} />
          )}

          {inspectState === "error" && (
            <StatePanel state="error" message={inspectError ?? t("inspectorPage.error.generic")} />
          )}

          {inspectState === "populated" && inspectResult && (
            <div
              role="region"
              aria-label={t("inspectorPage.resultLabel")}
              className="flex flex-col gap-3 rounded-lg border border-[var(--color-oneborder)] p-4"
            >
              <h2 className="text-base font-semibold">{t("inspectorPage.resultLabel")}</h2>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">{t("inspectorPage.formula")}</span>
                  <code className="ml-2 rounded bg-[var(--color-onesurfacealt)] px-2 py-0.5 font-mono">
                    {inspectResult.formula ?? "—"}
                  </code>
                </div>
                <div>
                  <span className="font-medium">{t("inspectorPage.computedText")}</span>
                  <span className="ml-2 font-mono">{inspectResult.computed_text ?? "—"}</span>
                </div>
                <div>
                  <span className="font-medium">{t("inspectorPage.errorCode")}</span>
                  <span
                    className={`ml-2 font-mono ${inspectResult.error_code ? "text-[var(--color-onerror)]" : ""}`}
                  >
                    {inspectResult.error_code ?? "—"}
                  </span>
                </div>
                <div>
                  <span className="font-medium">{t("inspectorPage.isCycle")}</span>
                  <span className="ml-2">{inspectResult.is_cycle ? "⚠️ Yes" : "No"}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-[var(--color-oneprimary)]">
                    {t("inspectorPage.precedents")} ({inspectResult.precedents.length})
                  </h3>
                  <div className="max-h-48 overflow-y-auto rounded border border-[var(--color-oneborder)] p-2 text-xs">
                    {inspectResult.precedents.length > 0 ? (
                      <ul className="flex flex-col gap-1">
                        {inspectResult.precedents.map((p, i) => (
                          <li key={i} className="font-mono text-[var(--color-onetextsecondary)]">
                            <span className="text-[var(--color-oneprimary)]">⬆</span>{" "}
                            {p.line_id ?? `sheet ${p.sheet}:${p.col},${p.row}`}
                            {p.period_id ? ` · ${p.period_id}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-[var(--color-onetextmuted)]">
                        {t("inspectorPage.noPrecedents")}
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="mb-1 text-sm font-semibold text-[var(--color-oneprimary)]">
                    {t("inspectorPage.dependents")} ({inspectResult.dependents.length})
                  </h3>
                  <div className="max-h-48 overflow-y-auto rounded border border-[var(--color-oneborder)] p-2 text-xs">
                    {inspectResult.dependents.length > 0 ? (
                      <ul className="flex flex-col gap-1">
                        {inspectResult.dependents.map((d, i) => (
                          <li key={i} className="font-mono text-[var(--color-onetextsecondary)]">
                            <span className="text-[var(--color-oneprimary)]">⬇</span>{" "}
                            {d.line_id ?? `sheet ${d.sheet}:${d.col},${d.row}`}
                            {d.period_id ? ` · ${d.period_id}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-[var(--color-onetextmuted)]">
                        {t("inspectorPage.noDependents")}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {inspectResult.cycle && inspectResult.cycle.length > 0 && (
                <div className="rounded-md border border-[var(--color-oneerror)] bg-[var(--color-onesurface)] p-3">
                  <h3 className="mb-1 text-sm font-semibold text-[var(--color-onerror)]">
                    {t("inspectorPage.cyclePath")}
                  </h3>
                  <ol className="flex list-inside list-decimal flex-col gap-1 text-xs font-mono text-[var(--color-onetextsecondary)]">
                    {inspectResult.cycle.map((c, i) => (
                      <li key={i}>
                        {c.line_id ?? `sheet ${c.sheet}:${c.col},${c.row}`}
                        {c.period_id ? ` · ${c.period_id}` : ""}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
