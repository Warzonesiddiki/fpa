import { describe, expect, it } from "vitest";
import {
  ApiEnvelope,
  AppErrorShape,
  CalendarPreviewData,
  CommandArgs,
  CompanyCreateData,
  CoaListData,
  DecimalString,
  ImportCommitData,
  ImportParseData,
  ImportRollbackData,
  ImportTieoutData,
  ImportValidateData,
  FormulaText,
  ModelCellSetArgs,
  ModelCellSetData,
  ModelRecalcArgs,
  ModelRecalcData,
  MoneyMinor,
  RowIssue,
  SecurityPinSetupData,
  SessionStatusData,
  SessionUnlockData,
  SUPPORTED_FUNCTIONS,
  findUnsupportedFunction,
  pinPolicyChecks,
  validatePinPolicy,
} from "./schema";

describe("IPC schemas — the validation gate (ARCHITECTURE §1b)", () => {
  it("MoneyMinor rejects floats and decimals that are not integers", () => {
    expect(MoneyMinor.safeParse(12345).success).toBe(true);
    expect(MoneyMinor.safeParse(12.345).success).toBe(false);
    expect(MoneyMinor.safeParse(Number.NaN).success).toBe(false);
  });

  it("DecimalString rejects float notation and non-numeric", () => {
    expect(DecimalString.safeParse("1234.50").success).toBe(true);
    expect(DecimalString.safeParse("-0.01").success).toBe(true);
    expect(DecimalString.safeParse("1e3").success).toBe(false);
    expect(DecimalString.safeParse("abc").success).toBe(false);
  });

  it("validatePinPolicy enforces ≥8 chars, ≥2 classes, no sequential run ≥4 (AUTH-SPEC §2.1)", () => {
    expect(validatePinPolicy("Meridian#2026")).toBeNull();
    expect(validatePinPolicy("Meridian2026")).toBeNull();
    expect(validatePinPolicy("short")).toBe("too_short");
    expect(validatePinPolicy("abcdefgh")).toBe("one_class");
    expect(validatePinPolicy("12345678")).toBe("one_class");
    expect(validatePinPolicy("abcd1234")).toBe("sequence");
    expect(validatePinPolicy("ABcd1234")).toBe("sequence");
    expect(validatePinPolicy("a1!9876b")).toBe("sequence");
    expect(validatePinPolicy("a1!aaaa1")).toBe("sequence");
    expect(validatePinPolicy("x".repeat(65) + "Aa1!")).toBe("too_long");
  });

  it("pinPolicyChecks reports each rule independently for the live hints", () => {
    expect(pinPolicyChecks("")).toEqual({ length: false, classes: false, sequence: true });
    expect(pinPolicyChecks("meridi")).toEqual({
      length: false,
      classes: false,
      sequence: true,
    });
    expect(pinPolicyChecks("meridian")).toEqual({
      length: true,
      classes: false,
      sequence: true,
    });
    expect(pinPolicyChecks("abcdefgh")).toEqual({
      length: true,
      classes: false,
      sequence: false,
    });
    expect(pinPolicyChecks("Meridian2026")).toEqual({
      length: true,
      classes: true,
      sequence: true,
    });
    expect(pinPolicyChecks(`${"x".repeat(65)}Aa1!`)).toEqual({
      length: false,
      classes: true,
      sequence: false,
    });
  });

  it("session.unlock rejects a policy-weak PIN before IPC (min 8, was 4)", () => {
    expect(
      CommandArgs["session.unlock"].safeParse({
        pin: "1234",
        company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      }).success,
    ).toBe(false);
    expect(
      CommandArgs["session.unlock"].safeParse({
        pin: "Meridian#2026",
        company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      }).success,
    ).toBe(true);
  });

  it("security.pin_setup validates policy + confirm match and returns {ok:true}", () => {
    const args = { pin: "Meridian#2026", confirm: "Meridian#2026" };
    expect(CommandArgs["security.pin_setup"].safeParse(args).success).toBe(true);
    expect(
      CommandArgs["security.pin_setup"].safeParse({ pin: "Meridian#2026", confirm: "Different9!" })
        .success,
    ).toBe(false);
    expect(
      CommandArgs["security.pin_setup"].safeParse({ pin: "1234", confirm: "1234" }).success,
    ).toBe(false);
    expect(CommandArgs["security.pin_setup"].safeParse({ pin: "Meridian#2026" }).success).toBe(
      false,
    );
    expect(SecurityPinSetupData.safeParse({ ok: true }).success).toBe(true);
  });

  it("AppErrorShape validates the documented error object", () => {
    const ok = AppErrorShape.safeParse({
      code: "AUTH_PIN_INVALID",
      message: "pin mismatch",
      userMessage: "Incorrect PIN. Please try again.",
      httpStatus: 401,
      retryable: true,
      retryAfterMs: null,
    });
    expect(ok.success).toBe(true);
    expect(AppErrorShape.safeParse({ code: "X" }).success).toBe(false);
  });

  it("ApiEnvelope accepts data or error shapes, rejects both/neither", () => {
    expect(ApiEnvelope.safeParse({ data: { x: 1 } }).success).toBe(true);
    expect(
      ApiEnvelope.safeParse({
        error: {
          code: "E",
          message: "m",
          userMessage: "u",
          httpStatus: 500,
          retryable: false,
          retryAfterMs: null,
        },
      }).success,
    ).toBe(true);
    expect(ApiEnvelope.safeParse({}).success).toBe(false);
  });

  it("company.create validates the full strict shape (calendar nested)", () => {
    const parsed = CommandArgs["company.create"].safeParse({
      name: "Acme",
      path: "acme.fpa",
      pack_key: "saas",
      calendar: {
        preset: "454",
        fy_start_month: null,
        week_start_day: 0,
        anchor_rule: "sunday_near_feb_1",
        year_end_rule: "nrf_4_day",
      },
      plan_only: true,
      horizon: "3y",
    });
    expect(parsed.success).toBe(true);
    const data = CompanyCreateData.safeParse({
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    });
    expect(data.success).toBe(true);
  });

  it("calendar.preview dates are ISO and weeks are 52|53", () => {
    const parsed = CommandArgs["calendar.preview"].safeParse({
      preset: "454",
      fy_start_month: null,
      week_start_day: 0,
      anchor_rule: "sunday_near_feb_1",
      year_end_rule: "nrf_4_day",
      from: "2026-02-01",
      year_count: 2,
    });
    expect(parsed.success).toBe(true);
    const data = CalendarPreviewData.safeParse({
      fiscal_years: [
        {
          fy_label: "FY2026",
          start_date: "2026-02-01",
          end_date: "2027-01-30",
          week_count: 52,
          periods: [
            {
              period_no: 1,
              code: "P01",
              start_date: "2026-02-01",
              end_date: "2026-02-28",
              is_53rd_week: false,
            },
          ],
        },
      ],
    });
    expect(data.success).toBe(true);
  });

  it("company.delete requires a reason and returns {deleted: true}", () => {
    expect(
      CommandArgs["company.delete"].safeParse({
        company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
        reason: "superseded",
      }).success,
    ).toBe(true);
    expect(
      CommandArgs["company.delete"].safeParse({
        company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
        reason: " ",
      }).success,
    ).toBe(false);
    expect(
      CommandArgs["company.delete"].safeParse({ company_id: "not-a-uuid", reason: "x" }).success,
    ).toBe(false);
  });

  it("company.open takes a file path and returns a summary", () => {
    expect(CommandArgs["company.open"].safeParse({ path: "/tmp/Meridian.fpa" }).success).toBe(true);
    expect(CommandArgs["company.open"].safeParse({ path: "" }).success).toBe(false);
  });

  it("calendar.apply accepts one config + empty bu_map; rejects multiple configs", () => {
    const one = {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      config: [
        {
          preset: "454",
          fy_start_month: null,
          week_start_day: 0,
          anchor_rule: "sunday_near_feb_1",
          year_end_rule: "nrf_4_day",
        },
      ],
      bu_map: [],
    };
    expect(CommandArgs["calendar.apply"].safeParse(one).success).toBe(true);
    expect(
      CommandArgs["calendar.apply"].safeParse({
        ...one,
        config: [one.config[0], one.config[0]],
      }).success,
    ).toBe(false);
    expect(CommandArgs["calendar.apply"].safeParse({ ...one, config: [] }).success).toBe(false);
  });

  it("unlock/status payloads carry the §2.5 integrity report (audit-chain verdict)", () => {
    const verified = {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      session_token: "dev-mock-session-token-0000000000000",
      read_only: false,
      integrity: { audit_chain_ok: true, broken_at_seq: null },
    };
    expect(SessionUnlockData.safeParse(verified).success).toBe(true);
    // Degraded path: chain break → read-only + seq of the first unverifiable event (ADR-011).
    const broken = {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      session_token: "dev-mock-session-token-0000000000000",
      read_only: true,
      integrity: { audit_chain_ok: false, broken_at_seq: 41 },
    };
    expect(SessionUnlockData.safeParse(broken).success).toBe(true);
    // The seq key is always sent by the core/mock (nullable, not optional): dropping the key
    // entirely is malformed, an explicit null is tolerated (informational only).
    expect(
      SessionUnlockData.safeParse({
        ...broken,
        integrity: { audit_chain_ok: false, broken_at_seq: null },
      }).success,
    ).toBe(true);
    expect(
      SessionUnlockData.safeParse({ ...broken, integrity: { audit_chain_ok: false } }).success,
    ).toBe(false);
    expect(SessionUnlockData.safeParse({ ...verified, read_only: undefined }).success).toBe(false);
    expect(
      SessionStatusData.safeParse({
        unlocked: true,
        company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
        read_only: true,
        license: null,
      }).success,
    ).toBe(true);
  });

  it("coa.list accepts company scope and validates AccountNode data", () => {
    expect(
      CommandArgs["coa.list"].safeParse({
        company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      }).success,
    ).toBe(true);
    expect(
      CoaListData.safeParse([
        {
          id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000099",
          code: "4000",
          name: "Revenue",
          account_type: "revenue",
          report_section: "Income Statement",
          parent_id: null,
          bu_id: null,
          is_control: false,
          active: true,
          version: 1,
          usage_count: 0,
        },
      ]).success,
    ).toBe(true);
    expect(CoaListData.safeParse([{ id: "x" }]).success).toBe(false);
  });

  it("import.parse accepts the 5 file-borne kinds and rejects an empty path", () => {
    for (const kind of [
      "gl_dump",
      "excel_csv",
      "driver_data",
      "opening_balances",
      "dimension_master",
    ]) {
      expect(
        CommandArgs["import.parse"].safeParse({ file_path: "/tmp/GL.xlsx", kind }).success,
      ).toBe(true);
    }
    expect(CommandArgs["import.parse"].safeParse({ file_path: "", kind: "gl_dump" }).success).toBe(
      false,
    );
    expect(
      CommandArgs["import.parse"].safeParse({ file_path: "/tmp/GL.xlsx", kind: "connector_sync" })
        .success,
    ).toBe(false); // "connector batches are not parsed from a file"
    expect(CommandArgs["import.parse"].safeParse({ file_path: "/tmp/GL.xlsx" }).success).toBe(
      false,
    );
  });

  it("import.parse data carries sheets, encodings, row counts and the sha256 source hash", () => {
    const parsed = ImportParseData.safeParse({
      parse_id: "3f9f2c9e-9f8b-4e2d-9a1c-100000000001",
      sheets: [
        { name: "GL", kind: "gl", row_count: 47999 },
        { name: "COA", kind: "coa", row_count: 12 },
      ],
      encodings: [{ scope: "GL", encoding: "utf-8", bom: true, auto_detected: false }],
      row_counts: { GL: 47999, COA: 12 },
      source_name: "SAP_GL_Aug2026.xlsx",
      source_hash: "aa11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900",
      size_bytes: 4821136,
      headers: ["period", "account_code", "debit", "credit"],
    });
    expect(parsed.success).toBe(true);
    // Latin-1 is only ever offered as a detected encoding with a preview (GL-TEMPLATE-SPEC §1).
    const detected = ImportParseData.safeParse({
      parse_id: "3f9f2c9e-9f8b-4e2d-9a1c-100000000001",
      sheets: [],
      encodings: [{ scope: "file", encoding: "latin-1", bom: false, auto_detected: true }],
      row_counts: {},
      source_name: "gl.csv",
      source_hash: "aa11",
      size_bytes: 10,
      headers: [],
    });
    expect(detected.success).toBe(false); // "source_hash must be sha256 hex"
  });

  it("RowIssue carries a locked error code and either a row or batch scope", () => {
    const rowIssue = RowIssue.safeParse({
      code: "MAP_ACCOUNT_AMBIGUOUS",
      message: "ACCOUNT_AMBIGUOUS: '4000' resolves to several Accounts",
      line_no: 47129,
      details: { accountCode: "4000", list: ["a-1", "a-2"] },
    });
    expect(rowIssue.success).toBe(true);
    const batchIssue = RowIssue.safeParse({
      code: "UNIT_PERIOD_MISMATCH",
      message: "DRIVER_PERIOD_WEEKLY: driver data is weekly but the calendar is monthly",
      line_no: null,
      details: {},
    });
    expect(batchIssue.success).toBe(true);
    // line numbers are 1-based source rows (0 is not a source row)
    expect(RowIssue.safeParse({ code: "X", message: "m", line_no: 0, details: {} }).success).toBe(
      false,
    );
  });

  it("import.validate data keeps money in integer minor units", () => {
    const ok = ImportValidateData.safeParse({
      hard: [],
      warnings: [],
      preview: [
        {
          line_no: 2,
          period_id: "fp-2026-p08",
          account_id: "3f9f2c9e-9f8b-4e2d-9a1c-200000000001",
          account_code: "4000",
          business_unit_id: null,
          amount_minor: -635000000,
          debit_minor: null,
          credit_minor: 635000000,
          currency: "USD",
          posting_ref: "INV-2001",
          doc_type: "INVOICE",
          is_ic: false,
        },
      ],
      rows: 1,
      mapping_version: "canonical-v1",
    });
    expect(ok.success).toBe(true);
    const floatMoney = ImportValidateData.safeParse({
      hard: [],
      warnings: [],
      preview: [
        {
          line_no: 2,
          period_id: "fp-2026-p08",
          account_id: "3f9f2c9e-9f8b-4e2d-9a1c-200000000001",
          account_code: "4000",
          business_unit_id: null,
          amount_minor: -6350000.5,
          debit_minor: null,
          credit_minor: 635000000,
          currency: "USD",
          posting_ref: null,
          doc_type: null,
          is_ic: false,
        },
      ],
      rows: 1,
      mapping_version: "v3",
    });
    expect(floatMoney.success).toBe(false); // "B18-2: money crosses IPC as integer minor units"
  });

  it("import.tieout data names diff rows with their residual", () => {
    const ok = ImportTieoutData.safeParse({
      debits_minor: 635000005,
      credits_minor: 635000000,
      diff_rows: [
        {
          line_no: 4,
          posting_ref: "PO-8812",
          debit_minor: 452500005,
          credit_minor: null,
          amount_minor: 452500005,
          residual_minor: 5,
        },
      ],
      balanced: false,
      rows: 3,
      currency: "USD",
    });
    expect(ok.success).toBe(true);
    expect(
      ImportTieoutData.safeParse({
        debits_minor: 1,
        credits_minor: 1,
        diff_rows: [],
        balanced: true,
        rows: 0,
        currency: "USD",
      }).success,
    ).toBe(true);
  });

  it("import.commit args require a batch name and a reason on every exclusion", () => {
    const base = {
      parse_id: "3f9f2c9e-9f8b-4e2d-9a1c-100000000001",
      mapping_id: "canonical",
    };
    expect(
      CommandArgs["import.commit"].safeParse({ ...base, name: "2026-08-30_001" }).success,
    ).toBe(true);
    const withDefaults = CommandArgs["import.commit"].safeParse({ ...base, name: "batch-1" });
    expect(withDefaults.success).toBe(true);
    expect((withDefaults.data as { exclusions: unknown[] }).exclusions).toEqual([]);
    expect(CommandArgs["import.commit"].safeParse({ ...base, name: "  " }).success).toBe(false);
    expect(CommandArgs["import.commit"].safeParse({ ...base, name: "x".repeat(121) }).success).toBe(
      false,
    );
    expect(
      CommandArgs["import.commit"].safeParse({
        ...base,
        name: "batch-1",
        exclusions: [{ line_no: 47129, reason: "credit_line_rounding_conflict" }],
      }).success,
    ).toBe(true);
    expect(
      CommandArgs["import.commit"].safeParse({
        ...base,
        name: "batch-1",
        exclusions: [{ line_no: 47129, reason: " " }],
      }).success,
    ).toBe(false); // "an exclusion is logged, never a silent drop"
  });

  it("import.commit data matches the API-SPEC §4 success shape", () => {
    const ok = ImportCommitData.safeParse({
      batch_id: "3f9f2c9e-9f8b-4e2d-9a1c-300000000001",
      rows: 47999,
      debits_minor: 4128300000,
      credits_minor: 4128300000,
      tie_out_status: "excluded_rows_logged",
      audit_id: 99,
      excluded_rows: 1,
      source_hash: "aa11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900",
    });
    expect(ok.success).toBe(true);
    expect(
      ImportCommitData.safeParse({
        batch_id: "3f9f2c9e-9f8b-4e2d-9a1c-300000000001",
        rows: 1,
        debits_minor: 1,
        credits_minor: 1,
        tie_out_status: "unknown",
        audit_id: 1,
        excluded_rows: 0,
        source_hash: "aa11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900",
      }).success,
    ).toBe(false); // "tie_out_status is one of pass|fail|excluded_rows_logged (DATABASE-SCHEMA §7)"
  });

  it("import.rollback requires an audit reason and accepts a null fallback batch", () => {
    const args = { batch_id: "3f9f2c9e-9f8b-4e2d-9a1c-300000000001", reason: "duplicate import" };
    expect(CommandArgs["import.rollback"].safeParse(args).success).toBe(true);
    expect(
      CommandArgs["import.rollback"].safeParse({
        batch_id: "3f9f2c9e-9f8b-4e2d-9a1c-300000000001",
        reason: " ",
      }).success,
    ).toBe(false);
    expect(ImportRollbackData.safeParse({ rolled_back_to: null }).success).toBe(true);
    expect(
      ImportRollbackData.safeParse({
        rolled_back_to: "3f9f2c9e-9f8b-4e2d-9a1c-300000000000",
      }).success,
    ).toBe(true);
  });

  it("all five B19 ingestion commands are registered in the command table", () => {
    for (const command of [
      "import.parse",
      "import.validate",
      "import.tieout",
      "import.commit",
      "import.rollback",
    ] as const) {
      expect(CommandArgs[command]).toBeDefined();
      // No ingestion command accepts an empty payload.
      expect(CommandArgs[command].safeParse({}).success).toBe(false);
    }
  });
});

describe("model grid contract (F-012 · FORMULA-ENGINE-SPEC §2/§4)", () => {
  const base = {
    // API-SPEC §2/§3: `model.cell.set.v1` args are {line_id, scenario_id, period_id, value?,
    // formula?, manual_override?} — no model_id (the cell is addressed by line+scenario+period).
    line_id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000002",
    scenario_id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000003",
    period_id: "fp-2027-p08",
  };

  it("accepts an exact money value and rejects scientific notation / float money", () => {
    expect(ModelCellSetArgs.safeParse({ ...base, value: "182500.00" }).success).toBe(true);
    expect(ModelCellSetArgs.safeParse({ ...base, value: "0.1" }).success).toBe(true);
    expect(ModelCellSetArgs.safeParse({ ...base, value: "1e3" }).success).toBe(false);
    expect(ModelCellSetArgs.safeParse({ ...base, value: "1.2.3" }).success).toBe(false);
    // A formula alone is also a valid cell write (M3-1 worker computes the value).
    expect(ModelCellSetArgs.safeParse({ ...base, formula: "=SUM(A1:A3)" }).success).toBe(true);
  });

  it("rejects an empty edit (either value or formula is required)", () => {
    expect(ModelCellSetArgs.safeParse(base).success).toBe(false);
    // `value: null` alone is not a cell write: a value OR a formula must be supplied
    // (MODEL_CELL_VALUE_REQUIRED, API-SPEC §3). A formula alone is a valid edit.
    expect(ModelCellSetArgs.safeParse({ ...base, value: null }).success).toBe(false);
    expect(ModelCellSetArgs.safeParse({ ...base, value: null, formula: "=0" }).success).toBe(true);
  });

  it("rejects formulas that do not start with '=' or exceed the whitelist", () => {
    expect(ModelCellSetArgs.safeParse({ ...base, formula: "SUM(A1:A3)" }).success).toBe(false);
    expect(ModelCellSetArgs.safeParse({ ...base, formula: "=LAMBDA(x, x)" }).success).toBe(false);
    expect(ModelCellSetArgs.safeParse({ ...base, formula: "=SUM(A1:A3) + RATE(A1)" }).success).toBe(
      true,
    );
  });

  it("formula text enforces the '=' prefix and the supported set", () => {
    expect(FormulaText.safeParse("=SUM(A1:A3)").success).toBe(true);
    expect(FormulaText.safeParse("SUM(A1:A3)").success).toBe(false);
    expect(findUnsupportedFunction("=SUM(A1:A3)")).toBeNull();
    expect(findUnsupportedFunction("=UNSUPPORTEDX(A1)")).toBe("UNSUPPORTEDX");
    expect(SUPPORTED_FUNCTIONS).toContain("CAGR");
    expect(SUPPORTED_FUNCTIONS).toContain("FPERIOD");
  });

  it("model.cell.set.v1 and model.recalc are registered and reject empty payloads", () => {
    expect(CommandArgs["model.cell.set.v1"]).toBeDefined();
    expect(CommandArgs["model.recalc"]).toBeDefined();
    expect(CommandArgs["model.cell.set.v1"].safeParse({}).success).toBe(false);
    expect(CommandArgs["model.recalc"].safeParse({}).success).toBe(false);
  });

  it("parses the documented recalc success shapes", () => {
    const recalc = {
      dirty_cells: 1,
      cycles: [{ path: ["Revenue!C10", "Revenue!C12"] }],
      changed_cells: ["ln-rev"],
      issues: [],
      duration_ms: 0,
    };
    expect(
      ModelRecalcArgs.safeParse({
        model_id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000001",
        scenario_id: base.scenario_id,
      }).success,
    ).toBe(true);
    // `model.recalc` returns the flat envelope {duration_ms, changed_cells, issues[]} (API-SPEC §2);
    // `model.cell.set.v1` returns the same facts wrapped in `recalc` (API-SPEC §3).
    expect(ModelRecalcData.safeParse({ ...recalc }).success).toBe(true);
    expect(
      ModelCellSetData.safeParse({
        recalc,
        cell: { value_minor: 1, amount_text: null, formula: null, manual_override: false },
        audit_id: 1,
      }).success,
    ).toBe(true);
    // duration_ms and dirty_cells are non-negative — never a negative recalc.
    expect(ModelRecalcData.safeParse({ ...recalc, duration_ms: -1 }).success).toBe(false);
  });
});
