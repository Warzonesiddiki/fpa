/**
 * S-070 Audit Trail store (F-033 · US-034 · SCREENS-SPEC S-070 · API-SPEC §2 `audit.list`).
 *
 * Owns the read state of the immutable HMAC-chained event log:
 *   * `audit.list` `{company_id, filters, page}` → `{events[], chain_status, meta, facets}`
 *   * 5 canonical screen states (loading / empty "No events yet" / error / success / populated)
 *   * Toolbar filters (date range · actor · action · object type/id) and paging both re-run
 *     the read; filter changes reset to page 1 so the user can never land on an empty tail page.
 *   * `chain_status` is DATA, not an error: a tampered chain still renders every event, plus
 *     the read-only banner + restore offer (US-034 / AUTH-SPEC §2.5). `AUDIT_CHAIN_BREAK`
 *     arriving as a typed error is still surfaced through the normal error state.
 *
 * This store performs NO mutation of any kind — the Audit Trail has no edit/delete surface
 * (B7 / WIREFRAMES-ANALYTICS S-070). It also never parses money out of event payloads: the
 * `before_json`/`after_json` strings are the exact hashed bytes and are rendered verbatim (B3/B6).
 */

import { create } from "zustand";
import { call, toBridgeError, type BridgeError } from "@/api/bridge";
import type { ScreenState } from "@/components/ui/StatePanel";
import type {
  AuditChainStatus,
  AuditEventRecord,
  AuditListData,
  AuditListMeta,
} from "@/api/schema";

export interface AuditFilterState {
  from: string | null;
  to: string | null;
  actor: string | null;
  action: string | null;
  objectType: string | null;
  objectId: string | null;
}

export interface AuditFacetState {
  actors: string[];
  actions: string[];
  objectTypes: string[];
}

export interface AuditStoreState {
  status: ScreenState;
  error: BridgeError | null;

  companyId: string | null;
  events: AuditEventRecord[];
  chainStatus: AuditChainStatus | null;
  meta: AuditListMeta | null;
  facets: AuditFacetState;
  filters: AuditFilterState;
  page: number;

  setCompanyId: (companyId: string | null) => void;
  setFilter: <K extends keyof AuditFilterState>(
    key: K,
    value: AuditFilterState[K],
  ) => Promise<boolean>;
  clearFilters: () => Promise<boolean>;
  goToPage: (page: number) => Promise<boolean>;
  load: (params?: { companyId?: string; page?: number }) => Promise<boolean>;
  retry: () => Promise<boolean>;
  reset: () => void;

  /** True while the chain verdict says the Company is tampered (read-only banner). */
  isChainBroken: () => boolean;
  hasActiveFilter: () => boolean;
}

const EMPTY_FILTERS: AuditFilterState = {
  from: null,
  to: null,
  actor: null,
  action: null,
  objectType: null,
  objectId: null,
};

const EMPTY_FACETS: AuditFacetState = { actors: [], actions: [], objectTypes: [] };

function toWireFilters(filters: AuditFilterState) {
  // Only send the fields the user actually set — the args schema is `.strict()` and the
  // native handler treats blank/absent identically (see commands/audit.rs::filter_clause).
  const wire: Record<string, string> = {};
  if (filters.from) wire.from = filters.from;
  if (filters.to) wire.to = filters.to;
  if (filters.actor) wire.actor = filters.actor;
  if (filters.action) wire.action = filters.action;
  if (filters.objectType) wire.object_type = filters.objectType;
  if (filters.objectId) wire.object_id = filters.objectId;
  return wire;
}

export const useAuditStore = create<AuditStoreState>((set, get) => ({
  status: "empty",
  error: null,
  companyId: null,
  events: [],
  chainStatus: null,
  meta: null,
  facets: EMPTY_FACETS,
  filters: EMPTY_FILTERS,
  page: 1,

  setCompanyId: (companyId) => set({ companyId }),

  async load(params) {
    const current = get();
    const companyId = params?.companyId ?? current.companyId;
    const page = params?.page ?? current.page;

    if (!companyId) {
      set({
        status: "empty",
        error: null,
        events: [],
        chainStatus: null,
        meta: null,
        facets: EMPTY_FACETS,
      });
      return false;
    }

    set({ status: "loading", error: null, companyId, page });
    try {
      const response = (await call("audit.list", {
        company_id: companyId,
        filters: toWireFilters(get().filters),
        page,
      })) as AuditListData;

      set({
        status: response.events.length > 0 ? "populated" : "empty",
        events: response.events,
        chainStatus: response.chain_status,
        meta: response.meta,
        facets: {
          actors: response.facets.actors,
          actions: response.facets.actions,
          objectTypes: response.facets.object_types,
        },
        error: null,
      });
      return true;
    } catch (e) {
      const error = toBridgeError(e);
      // Stale rows are cleared: an auditor must never read a page that no longer
      // corresponds to a successful verification pass.
      set({ status: "error", error, events: [], chainStatus: null, meta: null });
      return false;
    }
  },

  async setFilter(key, value) {
    const normalized = (typeof value === "string" && value.trim() === "" ? null : value) as
      | AuditFilterState[typeof key]
      | null;
    if (get().filters[key] === normalized) return false;
    set({ filters: { ...get().filters, [key]: normalized }, page: 1 });
    return get().load({ page: 1 });
  },

  async clearFilters() {
    set({ filters: EMPTY_FILTERS, page: 1 });
    return get().load({ page: 1 });
  },

  async goToPage(page) {
    if (page < 1) return false;
    const totalPages = get().meta?.total_pages ?? 0;
    if (totalPages > 0 && page > totalPages) return false;
    return get().load({ page });
  },

  async retry() {
    return get().load();
  },

  reset: () =>
    set({
      status: "empty",
      error: null,
      companyId: null,
      events: [],
      chainStatus: null,
      meta: null,
      facets: EMPTY_FACETS,
      filters: EMPTY_FILTERS,
      page: 1,
    }),

  isChainBroken: () => get().chainStatus?.verified === false,
  hasActiveFilter: () => Object.values(get().filters).some((v) => v !== null),
}));
