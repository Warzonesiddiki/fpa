import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { ImportHubPage } from "./index";
import { useImportStore } from "@/stores/import";
import { useSessionStore } from "@/stores/session";
import { useSettingsStore } from "@/stores/settings";

const { callMock, runtimeMock, dialogOpenMock, dragDropMock } = vi.hoisted(() => ({
  callMock: vi.fn(),
  runtimeMock: vi.fn(),
  dialogOpenMock: vi.fn(),
  dragDropMock: vi.fn(),
}));
vi.mock("@/api/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/bridge")>();
  return { ...actual, call: (...args: unknown[]) => callMock(...args) };
});
vi.mock("@/api/mock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/mock")>();
  return { ...actual, isTauriRuntime: () => runtimeMock() };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => dialogOpenMock(...args),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (...args: unknown[]) => dragDropMock(...args),
  }),
}));

const COMPANY_ID = "11111111-2222-3333-4444-555555555555";
const PARSED = {
  parse_id: "3f9f2c9e-9f8b-4e2d-9a1c-100000000001",
  sheets: [
    { name: "GL", kind: "gl", row_count: 48_000 },
    { name: "COA", kind: "coa", row_count: 120 },
  ],
  encodings: [{ scope: "GL", encoding: "utf-8", bom: true, auto_detected: false }],
  row_counts: { GL: 48_000, COA: 120 },
  source_name: "SAP_GL_Aug2026.xlsx",
  source_hash: "a".repeat(64),
  size_bytes: 4_821_136,
  headers: ["period", "account_code", "debit", "credit"],
};

function resetPageState(companyId: string | null = COMPANY_ID) {
  useSessionStore.setState({ companyId, unlocked: companyId !== null, readOnly: false });
  useImportStore.setState({
    status: "empty",
    error: null,
    companyId,
    kind: "gl_dump",
    filePath: "",
    parsed: null,
    mappingStatus: "empty",
    mappingError: null,
    mappingId: null,
    mappingVersion: null,
    requestId: 0,
    mappingRequestId: 0,
  });
  useSettingsStore.setState((state) => ({
    preferences: { ...state.preferences, locale: "en-US" },
  }));
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ImportHubPage />
    </MemoryRouter>,
  );
}

describe("S-030 Import Hub (M2-1)", () => {
  beforeEach(() => {
    callMock.mockReset();
    runtimeMock.mockReset();
    runtimeMock.mockReturnValue(false);
    dialogOpenMock.mockReset();
    dragDropMock.mockReset();
    dragDropMock.mockResolvedValue(() => undefined);
    resetPageState();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the honest empty hub with sources, mappings, history, connectors, and native gates", () => {
    const { container } = renderPage();

    expect(container.querySelector('[data-screen-state="empty"]')).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Import Hub" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "GL Dump" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Excel / CSV" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: "Connectors" })).toBeDisabled();
    expect(screen.getByText("OneFP&A Canonical GL")).toBeInTheDocument();
    expect(screen.getByText("Batch history is unavailable in this build.")).toBeInTheDocument();
    expect(screen.getByText(/import\.history is catalogued/)).toBeInTheDocument();
    expect(screen.getByText("QuickBooks Online")).toBeInTheDocument();
    expect(screen.getByText("Source Vault")).toBeInTheDocument();
    expect(screen.getByText("Source Reconciliation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Parse locally" })).toBeDisabled();
    expect(screen.getByLabelText("Choose an import file")).not.toHaveAttribute(
      "accept",
      expect.stringContaining(".zip"),
    );
  });

  it("shows a Company-scoped empty state when no Company is open", () => {
    resetPageState(null);
    renderPage();

    expect(screen.getByText("Open a Company before importing data.")).toBeInTheDocument();
    expect(screen.getByText(/never cross Company files/)).toBeInTheDocument();
  });

  it("uses the browser file input only for the dev path and reaches populated", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    const input = screen.getByLabelText("Choose an import file");
    const inputClick = vi.spyOn(input, "click");
    await user.click(screen.getByRole("button", { name: "Choose file" }));
    expect(inputClick).toHaveBeenCalledTimes(1);

    const dropZone = screen.getByText("Drop a workbook or delimited file here").parentElement;
    expect(dropZone).not.toBeNull();
    fireEvent.dragEnter(dropZone as HTMLElement);
    expect(dropZone).toHaveClass("border-[var(--color-oneprimary)]");
    fireEvent.dragLeave(dropZone as HTMLElement);
    fireEvent.change(input, { target: { files: [] } });

    await user.upload(
      input,
      new File(["period,account_code,debit,credit"], "GL.csv", { type: "text/csv" }),
    );

    expect(container.querySelector('[data-screen-state="populated"]')).not.toBeNull();
    expect(screen.getByText("Source selected")).toBeInTheDocument();
    expect(screen.getByText("GL.csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Parse locally" })).toBeEnabled();
  });

  it("never exposes browser file paths outside the development preview", () => {
    vi.stubEnv("DEV", false);
    renderPage();

    expect(screen.queryByLabelText("Choose an import file")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose file" })).toBeDisabled();
    expect(
      screen.getByText(
        "File selection is available in the desktop app. The browser fallback is enabled only by the development server.",
      ),
    ).toBeInTheDocument();
  });

  it("uses registered desktop drop/dialog paths and keeps ZIP outside the production picker", async () => {
    runtimeMock.mockReturnValue(true);
    dialogOpenMock
      .mockResolvedValueOnce("/Users/ravi/SAP_GL_Aug2026.xlsx")
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("dialog unavailable"));
    const user = userEvent.setup();
    const { container, unmount } = renderPage();

    await waitFor(() => expect(dragDropMock).toHaveBeenCalledTimes(1));
    const onDragDrop = dragDropMock.mock.calls[0]?.[0] as (event: unknown) => void;
    const desktopDropZone = screen.getByText(
      "Drop a workbook or delimited file here",
    ).parentElement;
    expect(desktopDropZone).not.toBeNull();
    fireEvent.drop(desktopDropZone as HTMLElement, {
      dataTransfer: { files: [new File(["ignored"], "browser-only.csv")] },
    });
    expect(screen.queryByText("browser-only.csv")).not.toBeInTheDocument();
    act(() => {
      onDragDrop({ payload: { type: "enter", paths: [], position: { x: 1, y: 1 } } });
    });
    expect(desktopDropZone).toHaveClass("border-[var(--color-oneprimary)]");
    act(() => {
      onDragDrop({ payload: { type: "leave" } });
      onDragDrop({
        payload: {
          type: "drop",
          paths: ["/Users/ravi/dropped.csv"],
          position: { x: 1, y: 1 },
        },
      });
    });
    expect(screen.getByText("/Users/ravi/dropped.csv")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change file" }));

    expect(dialogOpenMock).toHaveBeenCalledWith({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "Financial data files",
          extensions: ["xlsx", "xlsm", "xlsb", "xls", "ods", "csv", "tsv", "txt"],
        },
      ],
    });
    expect(await screen.findByText("/Users/ravi/SAP_GL_Aug2026.xlsx")).toBeInTheDocument();
    expect(screen.queryByLabelText("Choose an import file")).not.toBeInTheDocument();
    expect(container.querySelector('[data-screen-state="populated"]')).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Change file" }));
    expect(screen.getByText("/Users/ravi/SAP_GL_Aug2026.xlsx")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change file" }));
    expect(
      await screen.findByText("An unexpected error occurred. Please try again."),
    ).toBeInTheDocument();
    expect(dialogOpenMock).toHaveBeenCalledTimes(3);

    unmount();
    resetPageState();
    dragDropMock.mockReset();
    dragDropMock.mockRejectedValueOnce(new Error("drag registration unavailable"));
    renderPage();
    expect(
      await screen.findByText(
        "Desktop drag-and-drop could not be registered. Use Choose file instead.",
      ),
    ).toBeInTheDocument();
  });

  it("accepts a dropped dev file and sends the selected source kind to import.parse", async () => {
    const user = userEvent.setup();
    callMock.mockResolvedValue(PARSED);
    renderPage();
    await user.click(screen.getByRole("tab", { name: "Excel / CSV" }));

    const dropZone = screen.getByText("Drop a workbook or delimited file here").parentElement;
    expect(dropZone).not.toBeNull();
    fireEvent.drop(dropZone as HTMLElement, {
      dataTransfer: {
        files: [new File(["a,b"], "operations.csv", { type: "text/csv" })],
      },
    });
    await user.click(screen.getByRole("button", { name: "Parse locally" }));

    expect(callMock).toHaveBeenCalledWith("import.parse", {
      file_path: "operations.csv",
      kind: "excel_csv",
    });
    expect(await screen.findByText("Source parsed")).toBeInTheDocument();
  });

  it("renders the loading state while the local parser is working", async () => {
    const user = userEvent.setup();
    callMock.mockReturnValue(new Promise(() => undefined));
    useImportStore.getState().selectFile("/tmp/large.xlsx");
    const { container } = renderPage();

    await user.click(screen.getByRole("button", { name: "Parse locally" }));

    expect(container.querySelector('[data-screen-state="loading"]')).not.toBeNull();
    expect(
      screen.getByRole("status", { name: "Reading and fingerprinting the source file…" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "GL Dump" })).toBeDisabled();
  });

  it("renders the successful typed parse summary without claiming a commit", async () => {
    const user = userEvent.setup();
    callMock.mockResolvedValue(PARSED);
    useImportStore.getState().selectFile("/tmp/SAP_GL_Aug2026.xlsx");
    const { container } = renderPage();

    await user.click(screen.getByRole("button", { name: "Parse locally" }));
    expect(await screen.findByText("Source parsed")).toBeInTheDocument();

    expect(container.querySelector('[data-screen-state="success"]')).not.toBeNull();
    expect(
      screen.getByText(/No Import Batch or Company data has been written/),
    ).toBeInTheDocument();
    expect(screen.getByText("SAP_GL_Aug2026.xlsx")).toBeInTheDocument();
    expect(screen.getByText("48,000")).toBeInTheDocument();
    expect(screen.getByText("4,821,136 bytes")).toBeInTheDocument();
    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
    expect(screen.getByText("GL: utf-8 · BOM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to Mapping" })).toBeEnabled();
    expect(screen.getByText(/Review every suggested column/)).toBeInTheDocument();
  });

  it("navigates the intact parse working set to S-031", async () => {
    const user = userEvent.setup();
    useImportStore.setState({
      status: "success",
      mappingStatus: "populated",
      parsed: PARSED,
      filePath: "/tmp/SAP_GL_Aug2026.xlsx",
    });
    render(
      <MemoryRouter initialEntries={["/app/import"]}>
        <Routes>
          <Route path="/app/import" element={<ImportHubPage />} />
          <Route path="/app/import/map" element={<div>Mapping route reached</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Continue to Mapping" }));

    expect(screen.getByText("Mapping route reached")).toBeInTheDocument();
    expect(useImportStore.getState().parsed?.parse_id).toBe(PARSED.parse_id);
  });

  it("shows a password-protected workbook error verbatim without a false retry", async () => {
    const user = userEvent.setup();
    callMock.mockRejectedValue({
      code: "IMPORT_FILE_LOCKED",
      userMessage: "This file is password-protected. Remove protection and export again.",
      httpStatus: 422,
      retryable: false,
      retryAfterMs: null,
      details: {},
    });
    useImportStore.getState().selectFile("/tmp/locked.xlsx");
    renderPage();

    await user.click(screen.getByRole("button", { name: "Parse locally" }));

    expect(
      await screen.findByText(
        "This file is password-protected. Remove protection and export again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("IMPORT_FILE_LOCKED")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose another file" })).toBeEnabled();
  });

  it("surfaces retryable encoding errors verbatim and confirms Latin-1 after retry", async () => {
    const user = userEvent.setup();
    callMock
      .mockRejectedValueOnce({
        code: "ENCODING_UNSUPPORTED",
        userMessage: "Encoding not detected. Choose UTF-8 or Latin-1 (preview) and continue.",
        httpStatus: 422,
        retryable: true,
        retryAfterMs: null,
        details: {},
      })
      .mockResolvedValueOnce({
        ...PARSED,
        encodings: [{ scope: "GL", encoding: "latin-1", bom: false, auto_detected: true }],
      });
    useImportStore.getState().selectFile("/tmp/tally.csv");
    renderPage();

    await user.click(screen.getByRole("button", { name: "Parse locally" }));
    expect(
      await screen.findByText(
        "Encoding not detected. Choose UTF-8 or Latin-1 (preview) and continue.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("ENCODING_UNSUPPORTED")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Source parsed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Latin-1 was auto-detected");
    expect(screen.getByText("GL: latin-1 · auto-detected")).toBeInTheDocument();
  });

  it("is axe-clean in the successful populated summary", async () => {
    useImportStore.setState({
      status: "success",
      parsed: PARSED,
      filePath: "/tmp/SAP_GL_Aug2026.xlsx",
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Source parsed")).toBeInTheDocument());
    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });
});
