/**
 * S-055 FVA (Forecast Value Add) store (F-025 · M5-3 · WIREFRAMES-ANALYTICS S-055).
 *
 * Owns the FVA accuracy analysis state:
 *   * Load FVA scores: `fva.get` IPC ({ company_id, line_ids? })
 *     - Returns { scores: FvaScoreItem[], restated?: boolean }
 *   * 5 canonical screen states:
 *     - `empty`: when line/selection has < 3 versions (US-026: "Need ≥3 versions to score", never fake 0%)
 *     - `loading`: during IPC fetch
 *     - `error`: on IPC error (mapped strictly via `toBridgeError`)
 *     - `success`: when load completes but no rows/scores returned
 *     - `populated`: when valid scored lines exist (≥3 versions)
 *   * Persistent banner state for `FVA_RESTATEMENT_FLAG`:
 *     - Returned as an error code or indicated via restated flag;
 *     - Changes interpretation, so it must be a persistent banner above MAIN (not a dismissable toast).
 *   * Selectors & aggregated values:
 *     - Horizon and version set selectors
 *     - By-line table data
 *     - KPI cards aggregate (overall MAPE, Bias, Hit Rate)
 *     - BU rollup strip
 *   * Strict money & decimal rules: exact representations, never floating precision drift.
 */

import { create } from "zustand";
import Decimal from "decimal.js";
import { call, toBridgeError, type BridgeError } from "@/api/bridge";
import type { ScreenState } from "@/components/ui/StatePanel";
import type { FvaScoreItem } from "@/api/schema";

export type FvaHorizon = "13w" | "1m" | "3m" | "6m" | "1y" | "all";

export interface BuRollupItem {
  businessUnitId: string;
  businessUnitName: string;
  lineCount: number;
  overallMapePct: number | null;
  overallBiasPct: number | null;
  overallHitRatePct: number | null;
}

export interface KpiAggregate {
  overallMapePct: number | null;
  overallBiasPct: number | null;
  overallHitRatePct: number | null;
  scoredLineCount: number;
  unscoredLineCount: number;
}

export interface FvaStoreState {
  /* ── 5 Screen states & error ───────────────────────────────────── */
  status: ScreenState;
  error: BridgeError | null;

  /* ── Persistent Restatement Banner ─────────────────────────────── */
  /**
   * Persistent banner state when FVA_RESTATEMENT_FLAG is returned.
   * Changes interpretation, so it must not be a dismissable toast.
   */
  hasRestatementBanner: boolean;
  restatementMessage: string | null;

  /* ── Scoping & Selectors ───────────────────────────────────────── */
  companyId: string | null;
  selectedHorizon: FvaHorizon;
  selectedVersionSet: string;
  selectedLineIds: string[];

  /* ── Raw Scores ────────────────────────────────────────────────── */
  scores: FvaScoreItem[];

  /* ── Actions ───────────────────────────────────────────────────── */
  setCompanyId: (companyId: string | null) => void;
  setHorizon: (horizon: FvaHorizon) => void;
  setVersionSet: (versionSet: string) => void;
  setSelectedLineIds: (lineIds: string[]) => void;

  /** Load FVA scores via fva.get */
  loadFva: (params?: {
    companyId?: string;
    lineIds?: string[];
  }) => Promise<boolean>;

  /** Retry previous load query */
  retry: () => Promise<boolean>;

  /** Reset all store state */
  reset: () => void;
  clearError: () => void;

  /* ── Selectors ─────────────────────────────────────────────────── */
  /** By-line table data selector */
  getByLineData: () => FvaScoreItem[];

  /** KPI cards aggregate selector (overall MAPE, Bias, Hit Rate) */
  getKpiAggregate: () => KpiAggregate;

  /** BU rollup strip selector */
  getBuRollupStrip: () => BuRollupItem[];
}

export const MIN_VERSIONS_REQUIRED = 3;

export const useFvaStore = create<FvaStoreState>((set, get) => ({
  status: "empty",
  error: null,
  hasRestatementBanner: false,
  restatementMessage: null,
  companyId: null,
  selectedHorizon: "6m",
  selectedVersionSet: "latest_3",
  selectedLineIds: [],
  scores: [],

  setCompanyId: (companyId) => {
    set({ companyId });
  },

  setHorizon: (selectedHorizon) => {
    set({ selectedHorizon });
  },

  setVersionSet: (selectedVersionSet) => {
    set({ selectedVersionSet });
  },

  setSelectedLineIds: (selectedLineIds) => {
    set({ selectedLineIds });
  },

  loadFva: async (params) => {
    const current = get();
    const companyId = params?.companyId ?? current.companyId;
    const lineIds = params?.lineIds ?? (current.selectedLineIds.length > 0 ? current.selectedLineIds : undefined);

    if (!companyId) {
      set({
        status: "empty",
        error: null,
        scores: [],
        hasRestatementBanner: false,
        restatementMessage: null,
      });
      return false;
    }

    set({
      status: "loading",
      error: null,
      companyId,
      selectedLineIds: lineIds ?? [],
    });

    try {
      const response = (await call("fva.get" as never, {
        company_id: companyId,
        line_ids: lineIds,
      } as never)) as {
        scores?: FvaScoreItem[];
        restated?: boolean;
      };

      const rawScores = response?.scores ?? [];
      const isRestated = Boolean(response?.restated);

      // Determine 5 canonical states:
      // - If 0 scores returned -> success (clean empty query result)
      // - If all lines have version_count < 3 -> empty ("Need at least 3 Forecast Versions to score a line")
      // - If lines with >= 3 versions exist -> populated
      let computedStatus: ScreenState = "success";
      if (rawScores.length === 0) {
        computedStatus = "success";
      } else {
        const hasQualifyingLine = rawScores.some(
          (s) => (s.version_count ?? 0) >= MIN_VERSIONS_REQUIRED,
        );
        computedStatus = hasQualifyingLine ? "populated" : "empty";
      }

      set({
        status: computedStatus,
        scores: rawScores,
        error: null,
        hasRestatementBanner: isRestated,
        restatementMessage: isRestated
          ? "Actuals were restated for these periods — FVA recomputed; versions unchanged."
          : null,
      });

      return true;
    } catch (cause) {
      const bridgeErr = toBridgeError(cause);

      // Persistent banner when FVA_RESTATEMENT_FLAG is returned
      if (bridgeErr.code === "FVA_RESTATEMENT_FLAG") {
        set({
          status: "error",
          error: bridgeErr,
          hasRestatementBanner: true,
          restatementMessage:
            bridgeErr.userMessage ||
            "Actuals were restated for these periods — FVA recomputed; versions unchanged.",
          scores: [],
        });
      } else {
        set({
          status: "error",
          error: bridgeErr,
          scores: [],
        });
      }

      return false;
    }
  },

  retry: async () => {
    const current = get();
    if (!current.companyId) {
      return false;
    }
    return get().loadFva({
      companyId: current.companyId,
      lineIds: current.selectedLineIds.length > 0 ? current.selectedLineIds : undefined,
    });
  },

  reset: () => {
    set({
      status: "empty",
      error: null,
      hasRestatementBanner: false,
      restatementMessage: null,
      companyId: null,
      selectedHorizon: "6m",
      selectedVersionSet: "latest_3",
      selectedLineIds: [],
      scores: [],
    });
  },

  clearError: () => {
    set({ error: null });
  },

  getByLineData: () => {
    const { scores, selectedLineIds } = get();
    if (selectedLineIds.length === 0) {
      return scores;
    }
    const filterSet = new Set(selectedLineIds);
    return scores.filter((s) => filterSet.has(s.line_id));
  },

  getKpiAggregate: () => {
    const rows = get().getByLineData();
    // Only score lines that meet MIN_VERSIONS_REQUIRED and have non-null metrics
    const scoredRows = rows.filter((r) => (r.version_count ?? 0) >= MIN_VERSIONS_REQUIRED);

    if (scoredRows.length === 0) {
      return {
        overallMapePct: null,
        overallBiasPct: null,
        overallHitRatePct: null,
        scoredLineCount: 0,
        unscoredLineCount: rows.length,
      };
    }

    let mapeSum = 0;
    let mapeCount = 0;
    let biasSum = 0;
    let biasCount = 0;
    let hitRateSum = 0;
    let hitRateCount = 0;

    for (const row of scoredRows) {
      if (row.mape_pct !== null && row.mape_pct !== undefined) {
        mapeSum += row.mape_pct;
        mapeCount++;
      }
      if (row.bias_pct !== null && row.bias_pct !== undefined) {
        biasSum += row.bias_pct;
        biasCount++;
      }
      if (row.hit_rate_pct !== null && row.hit_rate_pct !== undefined) {
        hitRateSum += row.hit_rate_pct;
        hitRateCount++;
      }
    }

    // Round to 2 decimal places using Decimal (B3 clean)
    const round2 = (val: number) => new Decimal(val).toDecimalPlaces(2).toNumber();

    return {
      overallMapePct: mapeCount > 0 ? round2(mapeSum / mapeCount) : null,
      overallBiasPct: biasCount > 0 ? round2(biasSum / biasCount) : null,
      overallHitRatePct: hitRateCount > 0 ? round2(hitRateSum / hitRateCount) : null,
      scoredLineCount: scoredRows.length,
      unscoredLineCount: rows.length - scoredRows.length,
    };
  },

  getBuRollupStrip: () => {
    const rows = get().getByLineData();
    const buMap = new Map<
      string,
      {
        buName: string;
        scores: FvaScoreItem[];
      }
    >();

    for (const row of rows) {
      const buId = row.business_unit_id ?? "group";
      const buName = row.business_unit_name ?? "Group / Unassigned";
      let entry = buMap.get(buId);
      if (!entry) {
        entry = { buName, scores: [] };
        buMap.set(buId, entry);
      }
      entry.scores.push(row);
    }

    const round2 = (val: number) => new Decimal(val).toDecimalPlaces(2).toNumber();

    const rollups: BuRollupItem[] = [];
    for (const [buId, { buName, scores }] of buMap.entries()) {
      const qualifying = scores.filter((s) => (s.version_count ?? 0) >= MIN_VERSIONS_REQUIRED);

      let mapeSum = 0;
      let mapeCount = 0;
      let biasSum = 0;
      let biasCount = 0;
      let hitSum = 0;
      let hitCount = 0;

      for (const s of qualifying) {
        if (s.mape_pct !== null && s.mape_pct !== undefined) {
          mapeSum += s.mape_pct;
          mapeCount++;
        }
        if (s.bias_pct !== null && s.bias_pct !== undefined) {
          biasSum += s.bias_pct;
          biasCount++;
        }
        if (s.hit_rate_pct !== null && s.hit_rate_pct !== undefined) {
          hitSum += s.hit_rate_pct;
          hitCount++;
        }
      }

      rollups.push({
        businessUnitId: buId,
        businessUnitName: buName,
        lineCount: scores.length,
        overallMapePct: mapeCount > 0 ? round2(mapeSum / mapeCount) : null,
        overallBiasPct: biasCount > 0 ? round2(biasSum / biasCount) : null,
        overallHitRatePct: hitCount > 0 ? round2(hitSum / hitCount) : null,
      });
    }

    // Sort stably by BU name
    return rollups.sort((a, b) => a.businessUnitName.localeCompare(b.businessUnitName));
  },
}));
