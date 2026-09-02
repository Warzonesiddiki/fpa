import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { useImportStore } from "@/stores/import";
import { useSessionStore } from "@/stores/session";
import { useSettingsStore } from "@/stores/settings";
import { ImportCommitPage } from "./index";

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn() }));
vi.mock("@/api/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/bridge")>();
  return { ...actual, call: (...args: unknown[]) => callMock(...args) };
});

const COMPANY_ID = "11111111-2222-4333-8444-555555555555";
const HASH = "a".repeat(64);
const PARSED = {
  parse_id: "3f9f2c9e-9f8b-4e2d-9a1c-100000000001",
  sheets: [{ name: "GL", kind: "gl", row_count: 3 }],
  encodings: [{ scope: "GL", encoding: "utf-8", bom: true, auto_detected: false }],
  row_counts: { GL: 3 },
  source_name: "SAP_GL_Aug2026.xlsx",
  source_hash: HASH,
  size_bytes: 4_821_136,
  headers: ["period", "account_code", "debit", "credit"],
};
const VALIDATION = {
  hard: [],
  warnings: [],
  preview: [],
  rows: 3,
  mapping_version: "canonical-v1",
};
const BALANCED = {
  debits_minor: 635_000_000,
  credits_minor: 635_000_000,
  balanced: true,
  currency: "USD",
  rows: 3,
  diff_rows: [],
};
const UNBALANCED = {
  debits_minor: 635_000_005,
  credits_minor: 635_000_000,
  balanced: false,
  currency: "USD",
  rows: 3,
  diff_rows: [
    {
      line_no: 5,
      posting_ref: "ROUNDING-5",
      debit_minor: 5,
      credit_minor: null,
      amount_minor: 5,
      residual_minor: 5,
    },
  ],
};
const COMMITTED = {
  batch_id: "3f9f2c9e-9f8b-4e2d-9a1c-300000000001",
  rows: 3,
  debits_minor: 635_000_000,
  credits_minor: 635_000_000,
  tie_out_status: "pass",
  audit_id: 99,
  excluded_rows: 0,
  source_hash: HASH,
};

function resetState({ ready = true, readOnly = false } = {}) {
  useSessionStore.setState({ companyId: COMPANY_ID, unlocked: true, readOnly });
  useImportStore.setState({
    status: ready ? "success" : "empty",
    error: null,
    companyId: COMPANY_ID,
    kind: "gl_dump",
    filePath: ready ? "/tmp/SAP_GL_Aug2026.xlsx" : "",
    parsed: ready ? PARSED : null,
    mappingStatus: ready ? "success" : "empty",
    mappingError: null,
    mappingId: ready ? "canonical" : null,
    mappingVersion: ready ? "canonical-v1" : null,
    validationStatus: ready ? "success" : "empty",
    validationError: null,
    validationResult: ready ? VALIDATION : null,
    tieOutStatus: "empty",
    tieOutError: null,
    tieOutResult: null,
    commitStatus: "empty",
    commitError: null,
    commitResult: null,
    requestId: 0,
    mappingRequestId: 0,
    validationRequestId: 0,
    tieOutRequestId: 0,
    commitRequestId: 0,
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/import/commit"]}>
      <Routes>
        <Route path="/app/import/commit" element={<ImportCommitPage />} />
        <Route path="/app/import/map" element={<div>Mapping route reached</div>} />
        <Route path="/app/import" element={<div>Import history reached</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("S-032 Tie-Out and Import Batch commit", () => {
  beforeEach(() => {
    callMock.mockReset();
    resetState();
  });

  it("requires the clean S-031 hand-off and routes back without inventing state", async () => {
    resetState({ ready: false });
    const user = userEvent.setup();
    renderPage();
    expect(
      screen.getByText(
        "No clean validated import is ready. Complete mapping and validation first.",
      ),
    ).toBeInTheDocument();
    expect(callMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Return to Mapping Wizard" }));
    expect(screen.getByText("Mapping route reached")).toBeInTheDocument();
  });

  it("renders loading then exact balanced Tie-Out identity and is axe-clean", async () => {
    let resolveTieOut: (value: typeof BALANCED) => void = () => undefined;
    callMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTieOut = resolve;
      }),
    );
    const { container } = renderPage();
    expect(await screen.findByText("Running authoritative Tie-Out…")).toBeInTheDocument();
    act(() => resolveTieOut(BALANCED));

    expect(await screen.findByText("Balanced")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tie-Out & Commit" })).toBeInTheDocument();
    expect(screen.getByText("SAP_GL_Aug2026.xlsx")).toBeInTheDocument();
    expect(screen.getByText(HASH)).toBeInTheDocument();
    expect(screen.getByText(/canonical-v1/)).toBeInTheDocument();
    expect(screen.getByText("USD")).toBeInTheDocument();
    expect(screen.getByText("Balanced")).toBeInTheDocument();
    const tieOut = screen.getByRole("heading", { name: "Exact Tie-Out" }).closest("section");
    expect(tieOut).not.toBeNull();
    expect(within(tieOut as HTMLElement).getAllByText("USD 6,350,000.00")).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "Batch name" })).toHaveValue("SAP_GL_Aug2026");
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it("commits a balanced batch and links to real persisted history", async () => {
    callMock.mockResolvedValueOnce(BALANCED).mockResolvedValueOnce(COMMITTED);
    const user = userEvent.setup();
    renderPage();

    const commit = await screen.findByRole("button", { name: "Commit Import Batch" });
    expect(commit).toBeEnabled();
    await user.clear(screen.getByRole("textbox", { name: "Batch name" }));
    expect(commit).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Batch name" }), "August actuals");
    await user.click(commit);

    await waitFor(() =>
      expect(callMock).toHaveBeenLastCalledWith("import.commit", {
        parse_id: PARSED.parse_id,
        mapping_id: "canonical",
        name: "August actuals",
        exclusions: [],
      }),
    );
    expect(await screen.findByText("Import Batch committed")).toBeInTheDocument();
    expect(screen.getByText(`Batch ID: ${COMMITTED.batch_id}`)).toBeInTheDocument();
    expect(screen.getByText("3 rows committed; 0 explicitly excluded.")).toBeInTheDocument();
    expect(screen.getByText("Audit event #99")).toBeInTheDocument();
    expect(screen.getByText("Persisted Tie-Out status: pass")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "View Import History" }));
    expect(screen.getByText("Import history reached")).toBeInTheDocument();
  });

  it("logs only attributable exclusions with required reasons before authoritative commit", async () => {
    callMock.mockResolvedValueOnce(UNBALANCED).mockResolvedValueOnce({
      ...COMMITTED,
      rows: 2,
      tie_out_status: "excluded_rows_logged",
      excluded_rows: 1,
    });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("Difference requires explicit exclusions")).toBeInTheDocument();
    expect(screen.getByText("Source row 5")).toBeInTheDocument();
    expect(screen.getByText("ROUNDING-5", { exact: false })).toBeInTheDocument();
    const commit = screen.getByRole("button", { name: "Commit Import Batch" });
    expect(commit).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    expect(commit).toBeDisabled();
    await user.type(
      screen.getByRole("textbox", { name: "Required exclusion reason" }),
      "Source rounding adjustment",
    );
    expect(commit).toBeEnabled();
    await user.click(commit);

    await waitFor(() =>
      expect(callMock).toHaveBeenLastCalledWith("import.commit", {
        parse_id: PARSED.parse_id,
        mapping_id: "canonical",
        name: "SAP_GL_Aug2026",
        exclusions: [{ line_no: 5, reason: "Source rounding adjustment" }],
      }),
    );
    expect(await screen.findByText("2 rows committed; 1 explicitly excluded.")).toBeInTheDocument();
    expect(screen.getByText("Persisted Tie-Out status: excluded_rows_logged")).toBeInTheDocument();
    expect(screen.queryByText("Difference requires explicit exclusions")).not.toBeInTheDocument();
    const committedTieOut = screen
      .getByRole("heading", { name: "Exact Tie-Out" })
      .closest("section");
    expect(committedTieOut).not.toBeNull();
    expect(within(committedTieOut as HTMLElement).getAllByText("USD 6,350,000.00")).toHaveLength(2);
  });

  it("preserves locked duplicate-file text without a fabricated override action", async () => {
    callMock.mockResolvedValueOnce(BALANCED).mockRejectedValueOnce({
      code: "IMPORT_BATCH_HASH_EXISTS",
      userMessage:
        "This exact file was already imported (batch prior-batch). Re-import? This will create a new batch — confirm: duplicate rows are excluded automatically.",
      httpStatus: 409,
      retryable: false,
      retryAfterMs: null,
      details: { existingBatch: "prior-batch" },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Commit Import Batch" }));

    expect(
      await screen.findByText(
        "This exact file was already imported (batch prior-batch). Re-import? This will create a new batch — confirm: duplicate rows are excluded automatically.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("IMPORT_BATCH_HASH_EXISTS")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /re-import|override|confirm duplicate/i }),
    ).not.toBeInTheDocument();
  });

  it("surfaces the authoritative post-exclusion Tie-Out failure verbatim", async () => {
    callMock.mockResolvedValueOnce(UNBALANCED).mockRejectedValueOnce({
      code: "IMPORT_TIE_OUT_FAILED",
      userMessage:
        "Import blocked: debits 6350000.05 vs credits 6350000.00. Review flagged rows below.",
      httpStatus: 422,
      retryable: false,
      retryAfterMs: null,
      details: {},
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("checkbox"));
    await user.type(
      screen.getByRole("textbox", { name: "Required exclusion reason" }),
      "Investigate source rounding",
    );
    await user.click(screen.getByRole("button", { name: "Commit Import Batch" }));

    expect(
      await screen.findByText(
        "Import blocked: debits 6350000.05 vs credits 6350000.00. Review flagged rows below.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("IMPORT_TIE_OUT_FAILED")).toBeInTheDocument();
    expect(screen.queryByText("Import Batch committed")).not.toBeInTheDocument();
  });

  it("retries a retryable Tie-Out transport error without losing the hand-off", async () => {
    callMock
      .mockRejectedValueOnce({
        code: "TRANSPORT_UNAVAILABLE",
        userMessage: "The local core is unavailable. Try again.",
        httpStatus: 503,
        retryable: true,
        retryAfterMs: null,
        details: {},
      })
      .mockResolvedValueOnce(BALANCED);
    const user = userEvent.setup();
    renderPage();
    expect(
      await screen.findByText("The local core is unavailable. Try again."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Balanced")).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledTimes(2);
  });

  it("handles parse expiry, zero rows, and read-only commit gating", async () => {
    callMock.mockRejectedValueOnce({
      code: "IMPORT_PARSE_EXPIRED",
      userMessage: "This parse session expired. Re-run the import.",
      httpStatus: 410,
      retryable: true,
      retryAfterMs: null,
      details: {},
    });
    const first = renderPage();
    expect(
      await screen.findByText("This parse session expired. Re-run the import."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /select the source again/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    first.unmount();

    resetState();
    callMock.mockReset();
    useImportStore.setState({
      validationResult: { ...VALIDATION, rows: 0 },
      validationStatus: "empty",
    });
    callMock.mockResolvedValueOnce({
      ...BALANCED,
      rows: 0,
      debits_minor: 0,
      credits_minor: 0,
    });
    const second = renderPage();
    expect(
      await screen.findByText("There are no valid mapped rows to commit."),
    ).toBeInTheDocument();
    second.unmount();

    resetState({ readOnly: true });
    callMock.mockReset();
    callMock.mockResolvedValueOnce(BALANCED);
    renderPage();
    expect(await screen.findByText(/This Company is read-only/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit Import Batch" })).toBeDisabled();
  });
});
