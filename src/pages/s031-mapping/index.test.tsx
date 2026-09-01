import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { MappingWizardPage } from "./index";
import { useImportStore } from "@/stores/import";
import { useSessionStore } from "@/stores/session";
import { useSettingsStore } from "@/stores/settings";

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn() }));
vi.mock("@/api/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/bridge")>();
  return { ...actual, call: (...args: unknown[]) => callMock(...args) };
});

const COMPANY_ID = "11111111-2222-3333-4444-555555555555";
const MAPPING_ID = "3f9f2c9e-9f8b-4e2d-9a1c-500000000001";
const PARSED = {
  parse_id: "3f9f2c9e-9f8b-4e2d-9a1c-100000000001",
  sheets: [{ name: "GL", kind: "gl", row_count: 48_000 }],
  encodings: [{ scope: "GL", encoding: "utf-8", bom: false, auto_detected: false }],
  row_counts: { GL: 48_000 },
  source_name: "Tally_Aug26.csv",
  source_hash: "a".repeat(64),
  size_bytes: 4_821_136,
  headers: ["Date", "Ledger", "Dr", "Cr"],
};
const CANONICAL_PARSED = {
  ...PARSED,
  parse_id: "3f9f2c9e-9f8b-4e2d-9a1c-100000000002",
  source_name: "OneFPA_GL.csv",
  headers: ["period", "account_code", "debit", "credit"],
};
const PREVIEW_ROWS = [
  {
    line_no: 2,
    period_id: "fp-2026-p08",
    account_id: "3f9f2c9e-9f8b-4e2d-9a1c-200000000001",
    account_code: "4000",
    business_unit_id: null,
    amount_minor: -635_000_000,
    debit_minor: null,
    credit_minor: 635_000_000,
    currency: "USD",
    posting_ref: "INV-2001",
    doc_type: "INVOICE",
    is_ic: false,
  },
  {
    line_no: 4,
    period_id: "fp-2026-p08",
    account_id: "3f9f2c9e-9f8b-4e2d-9a1c-200000000003",
    account_code: "5100",
    business_unit_id: "3f9f2c9e-9f8b-4e2d-9a1c-220000000001",
    amount_minor: 452_500_000,
    debit_minor: 452_500_000,
    credit_minor: null,
    currency: "USD",
    posting_ref: "PO-8812",
    doc_type: "BILL",
    is_ic: false,
  },
];
const CLEAN_VALIDATION = {
  hard: [],
  warnings: [],
  preview: PREVIEW_ROWS,
  rows: 48_000,
  mapping_version: "canonical-v1",
};

function resetPageState({
  companyId = COMPANY_ID as string | null,
  parsed = PARSED as typeof PARSED | null,
  readOnly = false,
} = {}) {
  useSessionStore.setState({
    companyId,
    unlocked: companyId !== null,
    readOnly,
  });
  useImportStore.setState({
    status: parsed ? "success" : "empty",
    error: null,
    companyId,
    kind: "gl_dump",
    filePath: parsed ? `/tmp/${parsed.source_name}` : "",
    parsed,
    mappingStatus: parsed ? "populated" : "empty",
    mappingError: null,
    mappingId: null,
    mappingVersion: null,
    validationStatus: "empty",
    validationError: null,
    validationResult: null,
    requestId: 0,
    mappingRequestId: 0,
    validationRequestId: 0,
  });
  useSettingsStore.setState((state) => ({
    preferences: {
      ...state.preferences,
      locale: "en-US",
      negativeStyle: "paren",
      displayThousands: false,
      displayDecimals: "2",
    },
  }));
}

function renderPage() {
  return render(
    <MemoryRouter>
      <MappingWizardPage />
    </MemoryRouter>,
  );
}

async function nameTemplate(user: ReturnType<typeof userEvent.setup>, name = "Tally GL") {
  await user.type(screen.getByRole("textbox", { name: "Template name" }), name);
}

function readyForValidation({ readOnly = false } = {}) {
  resetPageState({ parsed: CANONICAL_PARSED, readOnly });
  useImportStore.setState({
    mappingStatus: "success",
    mappingId: "canonical",
    mappingVersion: "canonical-v1",
  });
}

describe("S-031 Mapping and Validation Wizard (M2-3)", () => {
  beforeEach(() => {
    callMock.mockReset();
    resetPageState();
  });

  it("requires the real Company-scoped parse hand-off", () => {
    resetPageState({ parsed: null });
    const first = renderPage();

    expect(first.container.querySelector('[data-screen-state="empty"]')).not.toBeNull();
    expect(
      screen.getByText("No parsed source is available. Parse a file in Import Hub first."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to Import Hub" })).toHaveAttribute(
      "href",
      "/app/import",
    );

    first.unmount();
    resetPageState({ companyId: null, parsed: null });
    renderPage();
    expect(
      screen.getByText("Open a Company and parse a source before mapping."),
    ).toBeInTheDocument();
  });

  it("renders the populated mapping, pipeline, source facts, explicit rules, and preview gate", () => {
    const { container } = renderPage();

    expect(container.querySelector('[data-screen-state="populated"]')).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Mapping Wizard" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Import pipeline" })).toBeInTheDocument();
    expect(screen.getByText("Map").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Tally_Aug26.csv")).toBeInTheDocument();
    expect(screen.getByText("48,000")).toBeInTheDocument();
    expect(
      ["Date", "Ledger", "Dr", "Cr"].map(
        (header) =>
          (screen.getByRole("combobox", { name: `Map ${header}` }) as HTMLSelectElement).value,
      ),
    ).toEqual(["period", "account_code", "debit", "credit"]);
    expect(screen.getByText(/source columns mapped/)).toHaveTextContent("4 of 4");
    expect(screen.getByText("100% auto-mapped")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Map Date" })).toHaveValue("period");
    expect(screen.getByRole("combobox", { name: "Map Ledger" })).toHaveValue("account_code");
    expect(
      screen.getByText(
        "Mapped row preview begins after a mapping is selected and validation runs.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not expose raw source rows/)).toBeInTheDocument();
    expect(screen.getByText(/no mapping-list command/)).toBeInTheDocument();
  });

  it("saves the exact typed template, exposes loading, and renders the versioned success hand-off", async () => {
    const user = userEvent.setup();
    let resolveSave: (value: { mapping_id: string; version: string }) => void = () => undefined;
    callMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const { container } = renderPage();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Account code" }),
      "trim_collapse_whitespace_remove_hyphens",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Period pattern" }),
      "month_name_mmm_yy",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Signed amount convention" }),
      "credit_positive",
    );
    await nameTemplate(user);
    await user.click(screen.getByRole("button", { name: "Save versioned mapping" }));

    expect(container.querySelector('[data-screen-state="loading"]')).not.toBeNull();
    expect(
      screen.getByRole("status", { name: "Loading: Saving the mapping and audit event…" }),
    ).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledWith("import.map.save_v1", {
      template: {
        name: "Tally GL",
        columns: [
          { source_pattern: "Date", semantic_target: "period" },
          { source_pattern: "Ledger", semantic_target: "account_code" },
          { source_pattern: "Dr", semantic_target: "debit" },
          { source_pattern: "Cr", semantic_target: "credit" },
        ],
        sign_convention: "credit_positive",
        normalization: {
          account_code: "trim_collapse_whitespace_remove_hyphens",
          dimension_values: "trim",
          period: "month_name_mmm_yy",
        },
      },
    });

    act(() => resolveSave({ mapping_id: MAPPING_ID, version: "v1" }));
    expect(await screen.findByText("Mapping template saved")).toBeInTheDocument();
    expect(container.querySelector('[data-screen-state="success"]')).not.toBeNull();
    expect(screen.getByText(MAPPING_ID)).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(
      screen.getByText(/does not create an Import Batch or commit source rows/),
    ).toBeInTheDocument();
    expect(screen.getByText("Validate").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: "Continue to Validation" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Edit mapping" }));
    expect(screen.getByRole("textbox", { name: "Template name" })).toHaveValue("Tally GL");
  });

  it("surfaces MAP_TARGET_INVALID verbatim without a false retry and permits correction", async () => {
    const user = userEvent.setup();
    callMock.mockRejectedValue({
      code: "MAP_TARGET_INVALID",
      userMessage: "This column cannot map to that field. Choose a supported target.",
      httpStatus: 422,
      retryable: false,
      retryAfterMs: null,
      details: {},
    });
    const { container } = renderPage();
    await nameTemplate(user, "Invalid map");
    await user.click(screen.getByRole("button", { name: "Save versioned mapping" }));

    expect(
      await screen.findByText("This column cannot map to that field. Choose a supported target."),
    ).toBeInTheDocument();
    expect(container.querySelector('[data-screen-state="error"]')).not.toBeNull();
    expect(screen.getByText("MAP_TARGET_INVALID")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Map Cr" }), "amount");
    expect(screen.queryByText("MAP_TARGET_INVALID")).not.toBeInTheDocument();
  });

  it("retries only retryable errors with the retained draft", async () => {
    const user = userEvent.setup();
    callMock
      .mockRejectedValueOnce({
        code: "INTERNAL",
        userMessage: "An unexpected error occurred. Please try again.",
        httpStatus: 500,
        retryable: true,
        retryAfterMs: null,
        details: {},
      })
      .mockResolvedValueOnce({ mapping_id: MAPPING_ID, version: "v2" });
    renderPage();
    await nameTemplate(user, "Tally retry");
    await user.click(screen.getByRole("button", { name: "Save versioned mapping" }));
    await user.click(await screen.findByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Mapping template saved")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledTimes(2);
  });

  it("uses the bundled canonical mapping without fabricating a persistence write", async () => {
    resetPageState({ parsed: CANONICAL_PARSED });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Use OneFP&A Canonical GL" }));

    expect(callMock).not.toHaveBeenCalled();
    expect(screen.getByText("OneFP&A Canonical GL selected")).toBeInTheDocument();
    expect(screen.getByText("canonical-v1")).toBeInTheDocument();
  });

  it("runs import.validate, exposes loading, and renders a clean minor-unit preview", async () => {
    readyForValidation();
    const user = userEvent.setup();
    let resolveValidation: (value: typeof CLEAN_VALIDATION) => void = () => undefined;
    callMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveValidation = resolve;
      }),
    );
    const { container } = renderPage();

    expect(screen.getByRole("button", { name: "Continue to Validation" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Continue to Validation" }));
    expect(callMock).toHaveBeenCalledWith("import.validate", {
      parse_id: CANONICAL_PARSED.parse_id,
      mapping_id: "canonical",
    });
    expect(container.querySelector('[data-screen-state="loading"]')).not.toBeNull();
    expect(
      screen.getByRole("status", { name: "Loading: Validating mapped rows…" }),
    ).toBeInTheDocument();

    act(() => resolveValidation(CLEAN_VALIDATION));
    expect(await screen.findByText("Validation completed")).toBeInTheDocument();
    expect(container.querySelector('[data-screen-state="success"]')).not.toBeNull();
    expect(screen.getByText("Preview").closest("li")).toHaveAttribute("aria-current", "step");
    const summary = screen.getByLabelText("Validation summary");
    expect(within(summary).getByText("48,000")).toBeInTheDocument();
    expect(within(summary).getAllByText("0")).toHaveLength(2);
    expect(
      screen.getByRole("table", { name: "First valid mapped rows returned by import.validate" }),
    ).toBeInTheDocument();
    expect(screen.getByText("4000")).toBeInTheDocument();
    expect(screen.getByText("(USD 6,350,000.00)")).toBeInTheDocument();
    expect(screen.getByText("USD 6,350,000.00")).toBeInTheDocument();
    expect(screen.queryByTestId("hard-findings")).not.toBeInTheDocument();
    expect(screen.queryByTestId("warning-findings")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to Tie-Out" })).toBeEnabled();
    expect(screen.getByText(/Continue to the authoritative Tie-Out/)).toBeInTheDocument();
  });

  it("shows batch and row HARD/WARNING evidence, bounds rendering, and offers only real remediation", async () => {
    readyForValidation();
    const user = userEvent.setup();
    const hard = [
      {
        code: "VALUE_INVALID",
        message: "CURRENCY_MIXED: split the file or import one currency at a time",
        line_no: null,
        details: { currencies: ["EUR", "USD"] },
      },
      ...Array.from({ length: 51 }, (_, index) => ({
        code: "MAP_ACCOUNT_AMBIGUOUS",
        message: `ACCOUNT_MISSING: code '${String(9000 + index)}' does not exist for this Company`,
        line_no: index + 3,
        details: { accountCode: String(9000 + index), list: [] },
      })),
    ];
    callMock.mockResolvedValueOnce({
      hard,
      warnings: [
        {
          code: "VALUE_INVALID",
          message: "POSTING_REF_DUPLICATE: 'INV-2001' first seen on row 2",
          line_no: 4,
          details: { postingRef: "INV-2001", firstLineNo: 2 },
        },
      ],
      preview: [PREVIEW_ROWS[0]],
      rows: 1,
      mapping_version: "canonical-v1",
    });
    const { container } = renderPage();

    await user.click(screen.getByRole("button", { name: "Continue to Validation" }));
    expect(await screen.findByText("Validation found blocking issues")).toBeInTheDocument();
    expect(container.querySelector('[data-screen-state="populated"]')).not.toBeNull();
    expect(screen.getByText("Validate").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("HARD findings (52)")).toBeInTheDocument();
    expect(screen.getByText("WARNING findings (1)")).toBeInTheDocument();
    expect(screen.getByText("Batch scope")).toBeInTheDocument();
    expect(screen.getByText("Source row 3")).toBeInTheDocument();
    expect(screen.getByText(/2 more findings are not rendered here/)).toBeInTheDocument();
    expect(screen.getByText(/POSTING_REF_DUPLICATE/)).toBeInTheDocument();
    expect(screen.getByText(/does not create accounts, remap individual rows/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /run validation again|acknowledge|exclude|create account|remap/i,
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit mapping" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Return to Import Hub" })).toHaveAttribute(
      "href",
      "/app/import",
    );
    expect(screen.getByRole("button", { name: "Continue to Tie-Out" })).toBeDisabled();
    expect(screen.getByText(/Tie-Out is blocked while HARD findings remain/)).toBeInTheDocument();

    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });

  it("renders an honest zero-valid-row edge state without a fabricated source preview", async () => {
    readyForValidation();
    const user = userEvent.setup();
    callMock.mockResolvedValueOnce({
      hard: [],
      warnings: [],
      preview: [],
      rows: 0,
      mapping_version: "canonical-v1",
    });
    const { container } = renderPage();

    await user.click(screen.getByRole("button", { name: "Continue to Validation" }));
    expect(await screen.findByText("No valid mapped rows")).toBeInTheDocument();
    expect(container.querySelector('[data-screen-state="empty"]')).not.toBeNull();
    expect(screen.getByText("No mapped rows to preview")).toBeInTheDocument();
    expect(screen.getByText(/Raw source rows are not fabricated/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to Tie-Out" })).toBeDisabled();
    expect(
      screen.getByText(/Tie-Out is blocked because there are no valid mapped rows/),
    ).toBeInTheDocument();
  });

  it("routes an expired parse to re-parse and never retries the same parse id", async () => {
    readyForValidation();
    const user = userEvent.setup();
    callMock.mockRejectedValueOnce({
      code: "IMPORT_PARSE_EXPIRED",
      userMessage: "This parse session expired. Re-run the import.",
      httpStatus: 410,
      retryable: true,
      retryAfterMs: null,
      details: { parseId: CANONICAL_PARSED.parse_id },
    });
    const { container } = renderPage();

    await user.click(screen.getByRole("button", { name: "Continue to Validation" }));
    expect(
      await screen.findByText("This parse session expired. Re-run the import."),
    ).toBeInTheDocument();
    expect(container.querySelector('[data-screen-state="error"]')).not.toBeNull();
    expect(screen.getByText("IMPORT_PARSE_EXPIRED")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit mapping" })).not.toBeInTheDocument();
    const reparseLinks = screen.getAllByRole("link", { name: "Return to Import Hub" });
    expect(reparseLinks.every((link) => link.getAttribute("href") === "/app/import")).toBe(true);
    await user.click(reparseLinks[0]);
    expect(useImportStore.getState()).toMatchObject({
      status: "populated",
      parsed: null,
      mappingStatus: "empty",
      validationStatus: "empty",
      validationResult: null,
    });
    expect(callMock).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable transport failure without losing the selected mapping", async () => {
    readyForValidation();
    const user = userEvent.setup();
    callMock
      .mockRejectedValueOnce({
        code: "INTERNAL",
        userMessage: "An unexpected error occurred. Please try again.",
        httpStatus: 500,
        retryable: true,
        retryAfterMs: null,
        details: {},
      })
      .mockResolvedValueOnce(CLEAN_VALIDATION);
    renderPage();

    await user.click(screen.getByRole("button", { name: "Continue to Validation" }));
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Validation completed")).toBeInTheDocument();
    expect(screen.getByText("canonical-v1")).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledTimes(2);
  });

  it("keeps read-only validation available because it performs no audited write", () => {
    readyForValidation({ readOnly: true });
    renderPage();

    expect(screen.getByText(/Validation remains available in read-only mode/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to Validation" })).toBeEnabled();
  });

  it("gates duplicate/reserved headers and audited writes in read-only mode", async () => {
    const user = userEvent.setup();
    resetPageState({
      parsed: {
        ...PARSED,
        parse_id: "3f9f2c9e-9f8b-4e2d-9a1c-100000000003",
        headers: ["Date", "date", "Ledger", "Dr", "Cr"],
      },
      readOnly: true,
    });
    const duplicate = renderPage();
    await nameTemplate(user, "Duplicate source");

    expect(screen.getByText(/Duplicate source headers must be corrected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save versioned mapping" })).toBeDisabled();
    expect(screen.getByText(/audit chain is not writable/)).toBeInTheDocument();
    expect(callMock).not.toHaveBeenCalled();

    duplicate.unmount();
    resetPageState({
      parsed: {
        ...PARSED,
        parse_id: "3f9f2c9e-9f8b-4e2d-9a1c-100000000005",
        headers: ["Date", "Ledger", "Dr", "__onefpa_account_code"],
      },
    });
    renderPage();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Map __onefpa_account_code" }),
      "credit",
    );
    await nameTemplate(user, "Reserved source");
    expect(screen.getByText(/reserved source patterns cannot be mapped/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save versioned mapping" })).toBeDisabled();
    expect(callMock).not.toHaveBeenCalled();
  });

  it("renders the zero-header edge state and is axe-clean when populated", async () => {
    resetPageState({
      parsed: {
        ...PARSED,
        parse_id: "3f9f2c9e-9f8b-4e2d-9a1c-100000000004",
        headers: [],
      },
    });
    const edge = renderPage();
    expect(screen.getByText(/parser returned no source headers/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save versioned mapping" })).toBeDisabled();
    edge.unmount();

    resetPageState();
    renderPage();
    await waitFor(() => expect(screen.getByText("Column mapping")).toBeInTheDocument());
    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });
});
