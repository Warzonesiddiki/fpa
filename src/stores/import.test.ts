import { beforeEach, describe, expect, it, vi } from "vitest";
import { useImportStore } from "./import";

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn() }));
vi.mock("@/api/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/bridge")>();
  return { ...actual, call: (...args: unknown[]) => callMock(...args) };
});

const COMPANY_ID = "11111111-2222-3333-4444-555555555555";
const HASH = "a".repeat(64);

const PARSED = {
  parse_id: "3f9f2c9e-9f8b-4e2d-9a1c-100000000001",
  sheets: [
    { name: "GL", kind: "gl", row_count: 3 },
    { name: "COA", kind: "coa", row_count: 12 },
  ],
  encodings: [{ scope: "GL", encoding: "utf-8", bom: true, auto_detected: false }],
  row_counts: { GL: 3, COA: 12 },
  source_name: "SAP_GL_Aug2026.xlsx",
  source_hash: HASH,
  size_bytes: 4_821_136,
  headers: ["period", "account_code", "debit", "credit"],
};

function resetStore() {
  useImportStore.setState({
    status: "empty",
    error: null,
    companyId: COMPANY_ID,
    kind: "gl_dump",
    filePath: "",
    parsed: null,
    requestId: 0,
  });
}

describe("S-030 import working-set store", () => {
  beforeEach(() => {
    callMock.mockReset();
    resetStore();
  });

  it("keeps empty no-op selections stable, then moves to populated for a source", async () => {
    useImportStore.getState().scopeToCompany(COMPANY_ID);
    useImportStore.getState().setKind("gl_dump");
    useImportStore.getState().selectFile("   ");
    expect(await useImportStore.getState().parse()).toBe(false);
    expect(callMock).not.toHaveBeenCalled();
    expect(useImportStore.getState()).toMatchObject({ status: "empty", requestId: 1 });

    useImportStore.getState().selectFile(" /tmp/SAP_GL_Aug2026.xlsx ");
    const state = useImportStore.getState();
    expect(state.status).toBe("populated");
    expect(state.filePath).toBe("/tmp/SAP_GL_Aug2026.xlsx");
    expect(state.parsed).toBeNull();
  });

  it("parses through the typed import.parse boundary and reaches success", async () => {
    callMock.mockResolvedValue(PARSED);
    useImportStore.getState().selectFile("/tmp/SAP_GL_Aug2026.xlsx");

    const ok = await useImportStore.getState().parse();

    expect(ok).toBe(true);
    expect(callMock).toHaveBeenCalledWith("import.parse", {
      file_path: "/tmp/SAP_GL_Aug2026.xlsx",
      kind: "gl_dump",
    });
    const state = useImportStore.getState();
    expect(state.status).toBe("success");
    expect(state.parsed).toEqual(PARSED);
    expect(state.error).toBeNull();
  });

  it("rejects a malformed core response instead of accepting an unsafe hand-off", async () => {
    callMock.mockResolvedValue({ ...PARSED, source_hash: "not-a-sha256" });
    useImportStore.getState().selectFile("/tmp/GL.xlsx");

    expect(await useImportStore.getState().parse()).toBe(false);
    const state = useImportStore.getState();
    expect(state.status).toBe("error");
    expect(state.error?.code).toBe("INTERNAL");
    expect(state.error?.userMessage).toBe("An unexpected error occurred. Please try again.");
    expect(state.parsed).toBeNull();
  });

  it("preserves the locked parse error and retries the same source", async () => {
    callMock
      .mockRejectedValueOnce({
        code: "ENCODING_UNSUPPORTED",
        userMessage: "Encoding not detected. Choose UTF-8 or Latin-1 (preview) and continue.",
        httpStatus: 422,
        retryable: true,
        retryAfterMs: null,
        details: {},
      })
      .mockResolvedValueOnce(PARSED);
    useImportStore.getState().selectFile("/tmp/source.csv");

    expect(await useImportStore.getState().parse()).toBe(false);
    expect(useImportStore.getState().error?.code).toBe("ENCODING_UNSUPPORTED");
    expect(await useImportStore.getState().retry()).toBe(true);
    expect(callMock).toHaveBeenLastCalledWith("import.parse", {
      file_path: "/tmp/source.csv",
      kind: "gl_dump",
    });
    expect(useImportStore.getState().status).toBe("success");
  });

  it("ignores a late parse response after the user chooses another source", async () => {
    let resolveParse: (value: typeof PARSED) => void = () => undefined;
    callMock.mockReturnValue(
      new Promise<typeof PARSED>((resolve) => {
        resolveParse = resolve;
      }),
    );
    useImportStore.getState().selectFile("/tmp/old.xlsx");
    const pending = useImportStore.getState().parse();
    expect(useImportStore.getState().status).toBe("loading");

    useImportStore.getState().selectFile("/tmp/new.xlsx");
    resolveParse(PARSED);

    expect(await pending).toBe(false);
    const state = useImportStore.getState();
    expect(state.status).toBe("populated");
    expect(state.filePath).toBe("/tmp/new.xlsx");
    expect(state.parsed).toBeNull();

    let rejectParse: (reason: unknown) => void = () => undefined;
    callMock.mockReturnValue(
      new Promise((_, reject) => {
        rejectParse = reject;
      }),
    );
    const rejected = useImportStore.getState().parse();
    useImportStore.getState().selectFile("/tmp/newest.xlsx");
    rejectParse({ code: "IMPORT_FILE_UNREADABLE" });
    expect(await rejected).toBe(false);
    expect(useImportStore.getState()).toMatchObject({
      status: "populated",
      filePath: "/tmp/newest.xlsx",
      error: null,
    });
  });

  it("invalidates a parsed working set when kind or Company changes", async () => {
    callMock.mockResolvedValue(PARSED);
    useImportStore.getState().selectFile("/tmp/GL.xlsx");
    await useImportStore.getState().parse();

    useImportStore.getState().setKind("excel_csv");
    expect(useImportStore.getState()).toMatchObject({
      status: "populated",
      kind: "excel_csv",
      filePath: "/tmp/GL.xlsx",
      parsed: null,
    });

    useImportStore.getState().scopeToCompany("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(useImportStore.getState()).toMatchObject({
      status: "empty",
      companyId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      filePath: "",
      parsed: null,
    });
  });

  it("reports native picker failures as the canonical INTERNAL error and resets cleanly", () => {
    useImportStore.getState().selectFile("/tmp/GL.xlsx");
    useImportStore.getState().reportError({
      code: "PLUGIN_DIALOG_FAILURE",
      userMessage: "raw plugin text",
    });
    expect(useImportStore.getState()).toMatchObject({
      status: "error",
      parsed: null,
      error: {
        code: "INTERNAL",
        userMessage: "An unexpected error occurred. Please try again.",
      },
    });

    useImportStore.getState().reset();
    expect(useImportStore.getState()).toMatchObject({
      status: "empty",
      companyId: COMPANY_ID,
      kind: "gl_dump",
      filePath: "",
      parsed: null,
      error: null,
    });
  });
});
