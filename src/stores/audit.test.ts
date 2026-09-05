/**
 * S-070 Audit Trail store tests (F-033 · US-034).
 *
 * The bridge `call` is mocked (toBridgeError stays real). Covers the contract the page
 * depends on: state transitions, company scoping, filter → page-1 reset, wire-arg shape,
 * pagination guards, chain-status-as-data, error handling and reset.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuditStore } from "./audit";
import type { AuditEventRecord, AuditListData } from "@/api/schema";

const callMock = vi.fn();
vi.mock("@/api/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/bridge")>();
  return {
    ...actual,
    call: (...args: unknown[]) => callMock(...args),
  };
});

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

function event(overrides: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return {
    seq: 1,
    actor: "owner",
    action: "import.commit",
    object_type: "import_batch",
    object_id: "2026-08-30_001",
    before_json: null,
    after_json: '{"rows":48213}',
    prev_hash: "genesis",
    hash: "0a1b2c3d",
    created_at: "2026-08-30T09:14:00Z",
    ...overrides,
  };
}

function response(overrides: Partial<AuditListData> = {}): AuditListData {
  return {
    events: [event()],
    chain_status: { verified: true, broken_at_seq: null, event_count: 1 },
    meta: { page: 1, page_size: 50, total: 1, total_pages: 1 },
    facets: {
      actors: ["owner"],
      actions: ["import.commit"],
      object_types: ["import_batch"],
    },
    ...overrides,
  };
}

describe("audit store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuditStore.getState().reset();
  });

  describe("load lifecycle", () => {
    it("goes loading → populated and keeps the engine payload verbatim", async () => {
      callMock.mockResolvedValueOnce(response());
      const pending = useAuditStore.getState().load({ companyId: COMPANY_ID });
      expect(useAuditStore.getState().status).toBe("loading");
      expect(await pending).toBe(true);

      const s = useAuditStore.getState();
      expect(s.status).toBe("populated");
      expect(s.events).toHaveLength(1);
      // The exact hashed bytes are preserved — never re-serialized (B3/B6).
      expect(s.events[0].after_json).toBe('{"rows":48213}');
      expect(s.meta?.page_size).toBe(50);
      expect(s.facets.objectTypes).toEqual(["import_batch"]);
    });

    it("an empty page is the empty state, not an error", async () => {
      callMock.mockResolvedValueOnce(
        response({
          events: [],
          meta: { page: 1, page_size: 50, total: 0, total_pages: 0 },
          chain_status: { verified: true, broken_at_seq: null, event_count: 0 },
        }),
      );
      expect(await useAuditStore.getState().load({ companyId: COMPANY_ID })).toBe(true);
      expect(useAuditStore.getState().status).toBe("empty");
    });

    it("without a Company it stays empty and never calls the command", async () => {
      expect(await useAuditStore.getState().load()).toBe(false);
      expect(callMock).not.toHaveBeenCalled();
      expect(useAuditStore.getState().status).toBe("empty");
    });

    it("maps a typed failure to error state and clears stale rows", async () => {
      callMock.mockResolvedValueOnce(response());
      await useAuditStore.getState().load({ companyId: COMPANY_ID });
      callMock.mockRejectedValueOnce({
        code: "AUDIT_CHAIN_BREAK",
        userMessage: "Audit integrity check failed. Restore from the last verified Snapshot?",
        httpStatus: 409,
        retryable: false,
        details: {},
      });
      expect(await useAuditStore.getState().retry()).toBe(false);
      const s = useAuditStore.getState();
      expect(s.status).toBe("error");
      expect(s.error?.code).toBe("AUDIT_CHAIN_BREAK");
      expect(s.events).toEqual([]);
      expect(s.chainStatus).toBeNull();
    });
  });

  describe("chain status is data, not an error", () => {
    it("a broken chain still renders every event and exposes the failing seq", async () => {
      callMock.mockResolvedValueOnce(
        response({
          events: [event({ seq: 2 }), event({ seq: 1 })],
          chain_status: { verified: false, broken_at_seq: 2, event_count: 2 },
        }),
      );
      await useAuditStore.getState().load({ companyId: COMPANY_ID });
      const s = useAuditStore.getState();
      expect(s.status).toBe("populated");
      expect(s.events).toHaveLength(2);
      expect(s.isChainBroken()).toBe(true);
      expect(s.chainStatus?.broken_at_seq).toBe(2);
    });

    it("isChainBroken is false before any load (no verdict is not a bad verdict)", () => {
      expect(useAuditStore.getState().isChainBroken()).toBe(false);
    });
  });

  describe("filters", () => {
    it("only sends the fields the user set, and resets to page 1", async () => {
      callMock.mockResolvedValue(
        response({ meta: { page: 3, page_size: 50, total: 200, total_pages: 4 } }),
      );
      await useAuditStore.getState().load({ companyId: COMPANY_ID, page: 3 });
      expect(callMock).toHaveBeenLastCalledWith("audit.list", {
        company_id: COMPANY_ID,
        filters: {},
        page: 3,
      });

      await useAuditStore.getState().setFilter("actor", "owner");
      expect(callMock).toHaveBeenLastCalledWith("audit.list", {
        company_id: COMPANY_ID,
        filters: { actor: "owner" },
        page: 1,
      });
      expect(useAuditStore.getState().page).toBe(1);
      expect(useAuditStore.getState().hasActiveFilter()).toBe(true);
    });

    it("treats a blank string as clearing the filter", async () => {
      callMock.mockResolvedValue(response());
      await useAuditStore.getState().load({ companyId: COMPANY_ID });
      await useAuditStore.getState().setFilter("action", "import.commit");
      await useAuditStore.getState().setFilter("action", "   ");
      expect(callMock).toHaveBeenLastCalledWith("audit.list", {
        company_id: COMPANY_ID,
        filters: {},
        page: 1,
      });
      expect(useAuditStore.getState().filters.action).toBeNull();
    });

    it("a same-value filter change is a no-op", async () => {
      callMock.mockResolvedValue(response());
      await useAuditStore.getState().load({ companyId: COMPANY_ID });
      callMock.mockClear();
      expect(await useAuditStore.getState().setFilter("actor", null)).toBe(false);
      expect(callMock).not.toHaveBeenCalled();
    });

    it("clearFilters wipes every field and reloads page 1", async () => {
      callMock.mockResolvedValue(response());
      await useAuditStore.getState().load({ companyId: COMPANY_ID });
      await useAuditStore.getState().setFilter("actor", "owner");
      await useAuditStore.getState().setFilter("objectType", "scenario");
      await useAuditStore.getState().clearFilters();
      expect(useAuditStore.getState().hasActiveFilter()).toBe(false);
      expect(callMock).toHaveBeenLastCalledWith("audit.list", {
        company_id: COMPANY_ID,
        filters: {},
        page: 1,
      });
    });
  });

  describe("pagination", () => {
    beforeEach(async () => {
      callMock.mockResolvedValue(
        response({ meta: { page: 1, page_size: 50, total: 120, total_pages: 3 } }),
      );
      await useAuditStore.getState().load({ companyId: COMPANY_ID });
      callMock.mockClear();
    });

    it("moves to a valid page", async () => {
      callMock.mockResolvedValue(
        response({ meta: { page: 2, page_size: 50, total: 120, total_pages: 3 } }),
      );
      expect(await useAuditStore.getState().goToPage(2)).toBe(true);
      expect(callMock).toHaveBeenLastCalledWith("audit.list", {
        company_id: COMPANY_ID,
        filters: {},
        page: 2,
      });
    });

    it("refuses page 0 and pages past the end without calling the command", async () => {
      expect(await useAuditStore.getState().goToPage(0)).toBe(false);
      expect(await useAuditStore.getState().goToPage(4)).toBe(false);
      expect(callMock).not.toHaveBeenCalled();
    });
  });

  it("reset returns every field to its initial value", async () => {
    callMock.mockResolvedValueOnce(response());
    await useAuditStore.getState().load({ companyId: COMPANY_ID });
    useAuditStore.getState().reset();
    const s = useAuditStore.getState();
    expect(s.status).toBe("empty");
    expect(s.companyId).toBeNull();
    expect(s.events).toEqual([]);
    expect(s.chainStatus).toBeNull();
    expect(s.meta).toBeNull();
    expect(s.page).toBe(1);
    expect(s.hasActiveFilter()).toBe(false);
  });
});
