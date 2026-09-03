import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Decimal from "decimal.js";
import { Button } from "@/components/ui";
import { equalPercentCurve, percentToFraction } from "./spreadInputs";
import type { BridgeError } from "@/api/bridge";
import type { SpreadLineRequest } from "@/stores/model";
import type { ModelGridPeriod } from "@/workers/modelEngine";
import type { SpreadMethod, SpreadResult } from "@/workers/spreading";

export interface SpreadDialogProps {
  lineId: string;
  lineLabel: string;
  periods: ModelGridPeriod[];
  currency: string;
  /** Last HARD rejection from the store (`SPREAD_WEIGHTS_INVALID` / `VALUE_INVALID`). */
  error: BridgeError | null;
  onSpread: (req: SpreadLineRequest) => Promise<SpreadResult | null>;
  onClose: () => void;
  onClearError: () => void;
}

const METHODS: SpreadMethod[] = ["equal", "seasonal", "custom", "lump"];

/**
 * S-041 "Spread" action (M3-5 · F-015 · US-016). Explicit, one-time spread of a total across the
 * loaded horizon of the active line. HARD `SPREAD_WEIGHTS_INVALID` is shown verbatim with the
 * documented choice — **Normalize** (explicit, audited via the spread provenance) or **Fix** (edit
 * the curve) — never silently normalised.
 */
export function SpreadDialog({
  lineId,
  lineLabel,
  periods,
  currency,
  error,
  onSpread,
  onClose,
  onClearError,
}: SpreadDialogProps) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<SpreadMethod>("equal");
  const [total, setTotal] = useState("");
  const [percents, setPercents] = useState<string[]>(() => equalPercentCurve(periods.length));
  const [amounts, setAmounts] = useState<string[]>(() => periods.map(() => ""));
  const [lumps, setLumps] = useState<Record<string, string>>({});
  const [excludeLast, setExcludeLast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SpreadResult | null>(null);

  const lastPeriod = periods[periods.length - 1];
  const canExcludeLast = periods.length === 13; // P13 / W53 (§3.5)

  const percentSum = useMemo(
    () =>
      percents
        .reduce(
          (acc, p) => acc.plus(/^-?\d+(?:\.\d+)?$/.test(p.trim()) ? p.trim() : "0"),
          new Decimal(0),
        )
        .toString(),
    [percents],
  );
  const amountSum = useMemo(
    () =>
      amounts
        .reduce(
          (acc, p) => acc.plus(/^-?\d+(?:\.\d+)?$/.test(p.trim()) ? p.trim() : "0"),
          new Decimal(0),
        )
        .toString(),
    [amounts],
  );
  const lumpSum = useMemo(
    () =>
      Object.values(lumps)
        .reduce(
          (acc, p) => acc.plus(/^-?\d+(?:\.\d+)?$/.test(p.trim()) ? p.trim() : "0"),
          new Decimal(0),
        )
        .toString(),
    [lumps],
  );

  const canNormalize =
    error?.code === "SPREAD_WEIGHTS_INVALID" && error.details?.canNormalize === true;

  function buildRequest(normalize: boolean): SpreadLineRequest {
    const req: SpreadLineRequest = { lineId, total: total.trim(), method, normalize };
    if (method === "seasonal") req.weights = percents.map(percentToFraction);
    if (method === "custom") req.amounts = amounts.map((a) => (a.trim() === "" ? "0" : a.trim()));
    if (method === "lump") {
      const map: Record<string, string> = {};
      for (const [id, v] of Object.entries(lumps)) if (v.trim() !== "") map[id] = v.trim();
      req.lumps = map;
    }
    if (canExcludeLast && excludeLast && lastPeriod) req.excludePeriodIds = [lastPeriod.id];
    return req;
  }

  async function run(normalize: boolean) {
    setBusy(true);
    try {
      const result = await onSpread(buildRequest(normalize));
      if (result) setDone(result);
    } finally {
      setBusy(false);
    }
  }

  const totalValid = /^-?\d+(?:\.\d+)?$/.test(total.trim());

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="spread-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="max-h-[90vh] w-[min(94vw,640px)] overflow-y-auto rounded-xl border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-4 shadow-xl">
        <h2 id="spread-dialog-title" className="mb-1 text-sm font-semibold">
          {t("gridPage.spread.title")}
        </h2>
        <p className="mb-3 text-xs text-[var(--color-onetextsecondary)]">
          {t("gridPage.spread.help", { line: lineLabel, count: periods.length })}
        </p>

        {done ? (
          <div className="flex flex-col gap-3">
            <p role="status" data-testid="spread-done" className="text-sm">
              {t("gridPage.spread.done", {
                count: done.values.length,
                sum: done.sum_text,
                currency,
                method: t(`gridPage.spread.method.${done.method}`),
              })}
              {done.normalized && ` ${t("gridPage.spread.doneNormalized")}`}
              {done.excluded.length > 0 &&
                ` ${t("gridPage.spread.doneExcluded", { periods: done.excluded.join(", ") })}`}
            </p>
            <div className="flex justify-end">
              <Button size="sm" onClick={onClose}>
                {t("common.close")}
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(false);
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="spread-total"
                className="text-sm font-medium text-[var(--color-onetextsecondary)]"
              >
                {t("gridPage.spread.total", { currency })}
              </label>
              <input
                id="spread-total"
                inputMode="decimal"
                value={total}
                onChange={(e) => {
                  setTotal(e.target.value);
                  if (error) onClearError();
                }}
                placeholder="12000000.00"
                className="h-10 w-full rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-3 font-mono text-sm"
              />
            </div>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-sm font-medium text-[var(--color-onetextsecondary)]">
                {t("gridPage.spread.methodLabel")}
              </legend>
              <div
                role="radiogroup"
                aria-label={t("gridPage.spread.methodLabel")}
                className="flex flex-wrap gap-1"
              >
                {METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={method === m}
                    onClick={() => {
                      setMethod(m);
                      if (error) onClearError();
                    }}
                    className={`rounded-md border px-2.5 py-1 text-xs ${
                      method === m
                        ? "border-[var(--color-oneprimary)] bg-[var(--color-onesurfacealt)] font-semibold"
                        : "border-[var(--color-oneborder)]"
                    }`}
                  >
                    {t(`gridPage.spread.method.${m}`)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[var(--color-onetextmuted)]">
                {t(`gridPage.spread.methodHint.${method}`)}
              </p>
            </fieldset>

            {method === "seasonal" && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--color-onetextsecondary)]">
                    {t("gridPage.spread.weights")}
                  </span>
                  <span
                    className={`font-mono text-xs ${
                      new Decimal(percentSum).minus(100).abs().lte("0.0001")
                        ? "text-[var(--color-onetextsecondary)]"
                        : "text-[var(--color-onerror)]"
                    }`}
                    aria-live="polite"
                  >
                    {t("gridPage.spread.weightsSum", { sum: percentSum })}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {periods.map((p, i) => (
                    <label key={p.id} className="flex flex-col gap-0.5 text-xs">
                      <span className="text-[var(--color-onetextmuted)]">{p.code} %</span>
                      <input
                        inputMode="decimal"
                        aria-label={t("gridPage.spread.weightFor", { period: p.code })}
                        value={percents[i] ?? ""}
                        disabled={canExcludeLast && excludeLast && i === periods.length - 1}
                        onChange={(e) => {
                          const next = [...percents];
                          next[i] = e.target.value;
                          setPercents(next);
                          if (error) onClearError();
                        }}
                        className="h-8 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 font-mono text-xs"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {method === "custom" && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--color-onetextsecondary)]">
                    {t("gridPage.spread.amounts")}
                  </span>
                  <span
                    className="font-mono text-xs text-[var(--color-onetextsecondary)]"
                    aria-live="polite"
                  >
                    {t("gridPage.spread.amountsSum", { sum: amountSum, currency })}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {periods.map((p, i) => (
                    <label key={p.id} className="flex flex-col gap-0.5 text-xs">
                      <span className="text-[var(--color-onetextmuted)]">{p.code}</span>
                      <input
                        inputMode="decimal"
                        aria-label={t("gridPage.spread.amountFor", { period: p.code })}
                        value={amounts[i] ?? ""}
                        disabled={canExcludeLast && excludeLast && i === periods.length - 1}
                        onChange={(e) => {
                          const next = [...amounts];
                          next[i] = e.target.value;
                          setAmounts(next);
                          if (error) onClearError();
                        }}
                        className="h-8 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 font-mono text-xs"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {method === "lump" && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--color-onetextsecondary)]">
                    {t("gridPage.spread.lumps")}
                  </span>
                  <span
                    className="font-mono text-xs text-[var(--color-onetextsecondary)]"
                    aria-live="polite"
                  >
                    {t("gridPage.spread.amountsSum", { sum: lumpSum, currency })}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {periods.map((p, i) => (
                    <label key={p.id} className="flex flex-col gap-0.5 text-xs">
                      <span className="text-[var(--color-onetextmuted)]">{p.code}</span>
                      <input
                        inputMode="decimal"
                        aria-label={t("gridPage.spread.lumpFor", { period: p.code })}
                        value={lumps[p.id] ?? ""}
                        disabled={canExcludeLast && excludeLast && i === periods.length - 1}
                        onChange={(e) => {
                          setLumps({ ...lumps, [p.id]: e.target.value });
                          if (error) onClearError();
                        }}
                        className="h-8 rounded-md border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] px-2 font-mono text-xs"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {canExcludeLast && lastPeriod && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={excludeLast}
                  onChange={(e) => {
                    setExcludeLast(e.target.checked);
                    if (error) onClearError();
                  }}
                />
                {t("gridPage.spread.excludeLast", { period: lastPeriod.code })}
              </label>
            )}

            {error && (
              <div
                role="alert"
                className="rounded-md border border-[var(--color-onerror)] p-2 text-xs text-[var(--color-onerror)]"
              >
                <p className="font-medium">{error.userMessage}</p>
                <p className="mt-0.5 font-mono text-[10px] opacity-80">{error.code}</p>
                {error.code === "SPREAD_WEIGHTS_INVALID" && (
                  <div className="mt-2 flex gap-2">
                    {canNormalize && (
                      <Button
                        size="sm"
                        type="button"
                        disabled={busy}
                        onClick={() => void run(true)}
                      >
                        {t("gridPage.spread.normalize")}
                      </Button>
                    )}
                    <Button size="sm" type="button" variant="ghost" onClick={onClearError}>
                      {t("gridPage.spread.fix")}
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" type="submit" disabled={busy || !totalValid}>
                {t("gridPage.spread.apply")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
