import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { useImportHistoryStore } from "@/stores/importHistory";
import { useSettingsStore } from "@/stores/settings";
import { ImportHistoryPanel } from "./ImportHistoryPanel";

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn() }));
vi.mock("@/api/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/bridge")>();
  return { ...actual, call: (...args: unknown[]) => callMock(...args) };
});

const COMPANY_ID = "11111111-2222-4333-8444-555555555555";
const BATCH_ID = "3f9f2c9e-9f8b-4e2d-9a1c-300000000002";
const PRIOR_BATCH_ID = "3f9f2c9e-9f8b-4e2d-9a1c-300000000001";
const ROW = {
  batch_id: BATCH_ID,
  name: "August actuals",
  kind: "gl_dump",
  source_name: "SAP_GL_Aug2026.xlsx",
  source_hash: "a".repeat(64),
  mapping_version: "canonical-v1",
  status: "committed",
  rows: 48_000,
  currency: "USD",
  debits_minor: 635_000_000,
  credits_minor: 635_000_000,
  tie_out_status: "pass",
  rollback_to_batch_id: null,
  committed_at: "2026-09-02T00:00:02Z",
  created_at: "2026-09-02T00:00:02Z",
};
const PAGE = {
  rows: [ROW],
  meta: { page: 1, page_size: 25, total: 1, total_pages: 1 },
};
const PAGINATED_PAGE = {
  rows: Array.from({ length: 25 }, (_, index) => ({
    ...ROW,
    batch_id: `3f9f2c9e-9f8b-4e2d-9a1c-${String(index + 1).padStart(12, "0")}`,
    source_hash: index.toString(16).padStart(64, "0"),
  })),
  meta: { page: 1, page_size: 25, total: 26, total_pages: 2 },
};

function resetState() {
  useImportHistoryStore.setState({
    companyId: null,
    status: "empty",
    error: null,
    result: null,
    requestId: 0,
    rollbackStatus: "empty",
    rollbackError: null,
    rollbackResult: null,
    rollbackBatchId: null,
    rollbackRequestId: 0,
  });
  useSettingsStore.setState((state) => ({
    preferences: {
      ...state.preferences,
      locale: "en-US",
      displayThousands: false,
      displayDecimals: "2",
    },
  }));
}

describe("S-030 persisted Import Batch history", () => {
  beforeEach(() => {
    callMock.mockReset();
    resetState();
  });

  it("renders no-Company, loading, and persisted empty states honestly", async () => {
    const first = render(<ImportHistoryPanel companyId={null} readOnly={false} />);
    expect(
      screen.getByText("Open a Company to view its Import Batch history."),
    ).toBeInTheDocument();
    expect(callMock).not.toHaveBeenCalled();
    first.unmount();

    let resolveHistory: (value: unknown) => void = () => undefined;
    callMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHistory = resolve;
      }),
    );
    render(<ImportHistoryPanel companyId={COMPANY_ID} readOnly={false} />);
    expect(
      await screen.findByText("Loading Company-scoped Import Batch history…"),
    ).toBeInTheDocument();
    act(() =>
      resolveHistory({
        rows: [],
        meta: { page: 1, page_size: 25, total: 0, total_pages: 0 },
      }),
    );
    expect(
      await screen.findByText("No Import Batches have been committed for this Company."),
    ).toBeInTheDocument();
  });

  it("renders exact persisted metadata, pagination, and an accessible populated table", async () => {
    callMock
      .mockResolvedValueOnce(PAGINATED_PAGE)
      .mockResolvedValueOnce({
        rows: [{ ...ROW, batch_id: PRIOR_BATCH_ID, name: "Oldest batch" }],
        meta: { page: 2, page_size: 25, total: 26, total_pages: 2 },
      })
      .mockRejectedValueOnce({
        code: "TRANSPORT_UNAVAILABLE",
        userMessage: "The local core is unavailable. Try again.",
        httpStatus: 503,
        retryable: true,
        retryAfterMs: null,
        details: {},
      });
    const { container } = render(<ImportHistoryPanel companyId={COMPANY_ID} readOnly={false} />);

    const table = await screen.findByRole("table", {
      name: "Persisted Company-scoped Import Batch history",
    });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(26);
    const firstBatch = within(rows[1]);
    expect(firstBatch.getByText("August actuals")).toBeInTheDocument();
    expect(firstBatch.getByText("SAP_GL_Aug2026.xlsx")).toBeInTheDocument();
    expect(firstBatch.getByTitle("0".repeat(64))).toBeInTheDocument();
    expect(firstBatch.getByText("48,000")).toBeInTheDocument();
    expect(firstBatch.getAllByText("USD 6,350,000.00")).toHaveLength(2);
    expect(firstBatch.getByText("canonical-v1")).toBeInTheDocument();
    expect(firstBatch.getByText("Tie-Out passed")).toBeInTheDocument();
    const results = await axe(container);
    expect(results.violations).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(callMock).toHaveBeenLastCalledWith("import.history", {
        company_id: COMPANY_ID,
        page: 2,
      }),
    );
    expect(await screen.findByText("Oldest batch")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2 · 26 batches")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(
      await screen.findByText("The local core is unavailable. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByText("TRANSPORT_UNAVAILABLE")).toBeInTheDocument();
    expect(screen.getByText("Oldest batch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("requires a rollback reason, calls the real command, and renders predecessor success", async () => {
    callMock.mockResolvedValueOnce(PAGE).mockResolvedValueOnce({
      rolled_back_to: PRIOR_BATCH_ID,
    });
    const user = userEvent.setup();
    render(<ImportHistoryPanel companyId={COMPANY_ID} readOnly={false} />);

    await user.click(await screen.findByRole("button", { name: /Roll back Import Batch/ }));
    const confirm = screen.getByRole("button", { name: "Confirm rollback" });
    expect(confirm).toBeDisabled();
    await user.type(
      screen.getByRole("textbox", { name: "Required rollback reason" }),
      "Duplicate source import",
    );
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() =>
      expect(callMock).toHaveBeenLastCalledWith("import.rollback", {
        batch_id: BATCH_ID,
        reason: "Duplicate source import",
      }),
    );
    expect(
      await screen.findByText(
        `Rollback committed. The prior committed batch is ${PRIOR_BATCH_ID}.`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Rolled back")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Roll back Import Batch/ })).toBeDisabled();
  });

  it("surfaces locked history/rollback errors and disables writes in read-only mode", async () => {
    callMock.mockRejectedValueOnce({
      code: "TRANSPORT_UNAVAILABLE",
      userMessage: "The local core is unavailable. Try again.",
      httpStatus: 503,
      retryable: true,
      retryAfterMs: null,
      details: {},
    });
    const first = render(<ImportHistoryPanel companyId={COMPANY_ID} readOnly={false} />);
    expect(
      await screen.findByText("The local core is unavailable. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByText("TRANSPORT_UNAVAILABLE")).toBeInTheDocument();
    first.unmount();

    resetState();
    callMock.mockReset();
    callMock.mockResolvedValueOnce(PAGE);
    render(<ImportHistoryPanel companyId={COMPANY_ID} readOnly />);
    expect(
      await screen.findByText(/Rollback is unavailable while audit integrity/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Roll back Import Batch/ })).toBeDisabled();
  });

  it("renders BATCH_ALREADY_ROLLED_BACK verbatim without false success", async () => {
    callMock.mockResolvedValueOnce(PAGE).mockRejectedValueOnce({
      code: "BATCH_ALREADY_ROLLED_BACK",
      userMessage: "This batch was already rolled back.",
      httpStatus: 409,
      retryable: false,
      retryAfterMs: null,
      details: {},
    });
    const user = userEvent.setup();
    render(<ImportHistoryPanel companyId={COMPANY_ID} readOnly={false} />);
    await user.click(await screen.findByRole("button", { name: /Roll back Import Batch/ }));
    await user.type(
      screen.getByRole("textbox", { name: "Required rollback reason" }),
      "Correction",
    );
    await user.click(screen.getByRole("button", { name: "Confirm rollback" }));

    expect(await screen.findByText("This batch was already rolled back.")).toBeInTheDocument();
    expect(screen.getByText("BATCH_ALREADY_ROLLED_BACK")).toBeInTheDocument();
    expect(screen.queryByText(/Rollback committed/)).not.toBeInTheDocument();
  });
});
