import { describe, expect, it } from "vitest";
import { isTauriRuntime, mockInvoke } from "./mock";

describe("dev mock — browser-preview simulation only (B18-3)", () => {
  it("isTauriRuntime is false in plain webview (jsdom)", () => {
    expect(isTauriRuntime()).toBe(false);
  });

  it("mirrors the documented error envelope for a wrong PIN", async () => {
    const out = (await mockInvoke("session.unlock", {
      pin: "WrongPin9!",
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    })) as { error: { code: string } };
    expect(out.error.code).toBe("AUTH_PIN_INVALID");
  });

  it("mirrors STORAGE_DECRYPT_FAILED for an unknown company", async () => {
    const out = (await mockInvoke("session.unlock", {
      pin: "Meridian2026",
      company_id: "00000000-0000-0000-0000-000000000000",
    })) as { error: { code: string; httpStatus: number; userMessage: string; retryable: boolean } };
    // The mock is the dev-only mirror of the Rust core: code, status and text must match
    // ERROR-HANDLING.md §B and AppError::DecryptFailed exactly.
    expect(out.error.code).toBe("STORAGE_DECRYPT_FAILED");
    expect(out.error.httpStatus).toBe(401);
    expect(out.error.userMessage).toBe("The Company file cannot be decrypted with this PIN.");
    expect(out.error.retryable).toBe(false);
  });

  it("security.pin_setup mirrors the documented {ok} success shape", async () => {
    const out = (await mockInvoke("security.pin_setup", {
      pin: "Meridian#2026",
      confirm: "Meridian#2026",
    })) as { data: { ok: boolean } };
    expect(out.data.ok).toBe(true);
  });

  it("returns the Meridian demo company and NRF oracle sample", async () => {
    const companies = (await mockInvoke("company.list", {})) as { data: { name: string }[] };
    expect(companies.data[0].name).toContain("Meridian");
    const cal = (await mockInvoke("calendar.preview", {
      preset: "454",
      fy_start_month: null,
      week_start_day: 0,
      anchor_rule: "sunday_near_feb_1",
      year_end_rule: "nrf_4_day",
      from: "2026-02-01",
      year_count: 1,
    })) as { data: { fiscal_years: { fy_label: string }[] } };
    expect(cal.data.fiscal_years[0].fy_label).toBe("FY2026");
  });

  it("company.open returns a summary and company.delete honours the retention window", async () => {
    const open = (await mockInvoke("company.open", {
      path: "/Users/demo/Meridian Holdings.fpa",
    })) as { data: { company_id: string; summary: { name: string } } };
    expect(open.data.summary.name).toContain("Meridian");

    // The demo company was used recently → deletion blocked by retention (COMPANY_IN_USE_RECENT)
    const blocked = (await mockInvoke("company.delete", {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      reason: "cleanup",
    })) as { error: { code: string; httpStatus: number } };
    expect(blocked.error.code).toBe("COMPANY_IN_USE_RECENT");
    expect(blocked.error.httpStatus).toBe(409);

    // The old sandbox company is outside the window → deletable
    const ok = (await mockInvoke("company.delete", {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000002",
      reason: "cleanup",
    })) as { data: { deleted: boolean } };
    expect(ok.data.deleted).toBe(true);
  });

  it("calendar.apply and coa.list mirror their documented success shapes", async () => {
    const applied = (await mockInvoke("calendar.apply", {
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
    })) as { data: { applied: boolean } };
    expect(applied.data.applied).toBe(true);

    const coa = (await mockInvoke("coa.list", {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    })) as { data: unknown[] };
    expect(coa.data).toEqual([]);
  });

  it("pack.list exposes all 12 bundled packs", async () => {
    const packs = (await mockInvoke("pack.list", {})) as { data: { key: string }[] };
    expect(packs.data).toHaveLength(12);
    expect(packs.data.map((p) => p.key)).toContain("real-estate");
  });

  it("a verified unlock reports an intact chain and a writable session (AUTH-SPEC §2.5)", async () => {
    const out = (await mockInvoke("session.unlock", {
      pin: "Meridian#2026",
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    })) as {
      data: {
        read_only: boolean;
        integrity: { audit_chain_ok: boolean; broken_at_seq: number | null };
      };
    };
    expect(out.data.read_only).toBe(false);
    expect(out.data.integrity).toEqual({ audit_chain_ok: true, broken_at_seq: null });
    await mockInvoke("session.lock", {});
  });

  it("mock chain-break PIN answers the degraded read-only session + restore offer shape", async () => {
    const out = (await mockInvoke("session.unlock", {
      pin: "AuditBrk9!",
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    })) as {
      data: {
        read_only: boolean;
        integrity: { audit_chain_ok: boolean; broken_at_seq: number | null };
      };
    };
    expect(out.data.read_only).toBe(true);
    expect(out.data.integrity).toEqual({ audit_chain_ok: false, broken_at_seq: 41 });
    const status = (await mockInvoke("session.status", {})) as { data: { read_only: boolean } };
    expect(status.data.read_only).toBe(true);
    // Locking clears the degraded flag — the next unlock re-derives it from the chain check.
    await mockInvoke("session.lock", {});
    const clean = (await mockInvoke("session.status", {})) as { data: { read_only: boolean } };
    expect(clean.data.read_only).toBe(false);
  });

  it("import.parse mirrors sheets, encodings and the sha256 source hash (S-030/S-031)", async () => {
    const out = (await mockInvoke("import.parse", {
      file_path: "/Users/demo/SAP_GL_Aug2026.xlsx",
      kind: "gl_dump",
    })) as {
      data: {
        parse_id: string;
        sheets: { name: string; kind: string; row_count: number }[];
        encodings: { encoding: string; bom: boolean; auto_detected: boolean }[];
        row_counts: Record<string, number>;
        source_hash: string;
        headers: string[];
      };
    };
    expect(out.data.parse_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.data.sheets[0]).toEqual({ name: "GL", kind: "gl", row_count: 3 });
    expect(out.data.encodings[0]).toEqual({
      scope: "GL",
      encoding: "utf-8",
      bom: true,
      auto_detected: false,
    });
    expect(out.data.row_counts.GL).toBe(3);
    expect(out.data.source_hash).toHaveLength(64);
    expect(out.data.headers[0]).toBe("period");
  });

  it("import.parse mirrors the two documented unreadable-file errors (ERROR-HANDLING §C)", async () => {
    const locked = (await mockInvoke("import.parse", {
      file_path: "/Users/demo/locked_GL.xlsx",
      kind: "gl_dump",
    })) as { error: { code: string; httpStatus: number; userMessage: string; retryable: boolean } };
    expect(locked.error.code).toBe("IMPORT_FILE_LOCKED");
    expect(locked.error.httpStatus).toBe(422);
    expect(locked.error.userMessage).toBe(
      "This file is password-protected. Remove protection and export again.",
    );
    const unreadable = (await mockInvoke("import.parse", {
      file_path: "/Users/demo/unreadable_GL.csv",
      kind: "gl_dump",
    })) as { error: { code: string; userMessage: string } };
    expect(unreadable.error.code).toBe("IMPORT_FILE_UNREADABLE");
    expect(unreadable.error.userMessage).toBe(
      "This file could not be read. Export it again as .xlsx or .csv without a password.",
    );
  });

  it("import.tieout reports a balanced fixture and names the diff row of an unbalanced one", async () => {
    const balanced = (await mockInvoke("import.parse", {
      file_path: "/Users/demo/GL.xlsx",
      kind: "gl_dump",
    })) as { data: { parse_id: string } };
    const tie = (await mockInvoke("import.tieout", {
      parse_id: balanced.data.parse_id,
      mapping_id: "canonical",
    })) as {
      data: {
        debits_minor: number;
        credits_minor: number;
        balanced: boolean;
        diff_rows: unknown[];
      };
    };
    expect(tie.data.debits_minor).toBe(tie.data.credits_minor);
    expect(tie.data.balanced).toBe(true);
    expect(tie.data.diff_rows).toEqual([]);

    const broken = (await mockInvoke("import.parse", {
      file_path: "/Users/demo/unbalanced_GL.xlsx",
      kind: "gl_dump",
    })) as { data: { parse_id: string } };
    const bad = (await mockInvoke("import.tieout", {
      parse_id: broken.data.parse_id,
      mapping_id: "canonical",
    })) as {
      data: {
        debits_minor: number;
        credits_minor: number;
        balanced: boolean;
        diff_rows: { line_no: number; posting_ref: string; residual_minor: number }[];
      };
    };
    expect(bad.data.balanced).toBe(false);
    expect(bad.data.debits_minor - bad.data.credits_minor).toBe(5);
    // Attribution honesty: the difference is named on the row that carries a posting ref.
    expect(bad.data.diff_rows).toHaveLength(1);
    expect(bad.data.diff_rows[0].posting_ref).toBe("PO-8812");
    expect(bad.data.diff_rows[0].residual_minor).toBe(5);
  });

  it("import.commit is blocked by the Tie-Out gate with the documented user text", async () => {
    const parsed = (await mockInvoke("import.parse", {
      file_path: "/Users/demo/unbalanced_GL.xlsx",
      kind: "gl_dump",
    })) as { data: { parse_id: string } };
    const blocked = (await mockInvoke("import.commit", {
      parse_id: parsed.data.parse_id,
      mapping_id: "canonical",
      name: "2026-08-30_001",
      exclusions: [],
    })) as {
      error: {
        code: string;
        httpStatus: number;
        retryable: boolean;
        userMessage: string;
        details: { diffRows: unknown[] };
      };
    };
    expect(blocked.error.code).toBe("IMPORT_TIE_OUT_FAILED");
    expect(blocked.error.httpStatus).toBe(422);
    expect(blocked.error.retryable).toBe(false);
    expect(blocked.error.userMessage).toBe(
      "Import blocked: debits 6350000.05 vs credits 6350000.00. Review flagged rows below.",
    );
    expect(blocked.error.details.diffRows).toHaveLength(1);

    // Excluding the offending row clears the gate and the exclusion is logged, not dropped.
    const committed = (await mockInvoke("import.commit", {
      parse_id: parsed.data.parse_id,
      mapping_id: "canonical",
      name: "2026-08-30_001",
      exclusions: [{ line_no: 4, reason: "credit_line_rounding_conflict" }],
    })) as { data: { tie_out_status: string; excluded_rows: number; audit_id: number } };
    expect(committed.data.tie_out_status).toBe("excluded_rows_logged");
    expect(committed.data.excluded_rows).toBe(1);
    expect(committed.data.audit_id).toBeGreaterThan(0);
  });

  it("import.commit on a balanced fixture returns the API-SPEC §4 batch shape", async () => {
    const parsed = (await mockInvoke("import.parse", {
      file_path: "/Users/demo/GL.xlsx",
      kind: "gl_dump",
    })) as { data: { parse_id: string } };
    const out = (await mockInvoke("import.commit", {
      parse_id: parsed.data.parse_id,
      mapping_id: "canonical",
      name: "2026-08-30_001",
      exclusions: [],
    })) as {
      data: {
        batch_id: string;
        rows: number;
        debits_minor: number;
        credits_minor: number;
        tie_out_status: string;
        audit_id: number;
        excluded_rows: number;
      };
    };
    expect(out.data.batch_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.data.rows).toBe(3);
    expect(out.data.debits_minor).toBe(out.data.credits_minor);
    expect(out.data.tie_out_status).toBe("pass");
    expect(out.data.excluded_rows).toBe(0);
  });

  it("import.validate mirrors IMPORT_PARSE_EXPIRED (410, retryable) for an unknown parse", async () => {
    const unknown = "3f9f2c9e-9f8b-4e2d-9a1c-100000000999";
    const validate = (await mockInvoke("import.validate", {
      parse_id: unknown,
      mapping_id: "canonical",
    })) as { error: { code: string; httpStatus: number; retryable: boolean; userMessage: string } };
    expect(validate.error.code).toBe("IMPORT_PARSE_EXPIRED");
    expect(validate.error.httpStatus).toBe(410);
    expect(validate.error.retryable).toBe(true); // "the only retryable ingestion code"
    expect(validate.error.userMessage).toBe("This parse session expired. Re-run the import.");
    const commit = (await mockInvoke("import.commit", {
      parse_id: unknown,
      mapping_id: "canonical",
      name: "batch",
      exclusions: [],
    })) as { error: { code: string } };
    expect(commit.error.code).toBe("IMPORT_PARSE_EXPIRED");
  });

  it("import.rollback requires a reason and mirrors BATCH_ALREADY_ROLLED_BACK", async () => {
    const batchId = "3f9f2c9e-9f8b-4e2d-9a1c-300000000777";
    const noReason = (await mockInvoke("import.rollback", {
      batch_id: batchId,
      reason: " ",
    })) as { error: { code: string } };
    expect(noReason.error.code).toBe("VALUE_INVALID");

    const first = (await mockInvoke("import.rollback", {
      batch_id: batchId,
      reason: "duplicate import",
    })) as { data: { rolled_back_to: string | null } };
    expect(first.data.rolled_back_to).toBeNull();

    const second = (await mockInvoke("import.rollback", {
      batch_id: batchId,
      reason: "duplicate import",
    })) as { error: { code: string; httpStatus: number; userMessage: string } };
    expect(second.error.code).toBe("BATCH_ALREADY_ROLLED_BACK");
    expect(second.error.httpStatus).toBe(409);
    expect(second.error.userMessage).toBe("This batch was already rolled back.");
  });

  it("model.cell.set.v1 mirrors the documented recalc envelope and exact minor units", async () => {
    const out = (await mockInvoke("model.cell.set.v1", {
      line_id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000002",
      scenario_id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000003",
      period_id: "fp-2027-p08",
      value: "182500.00",
      manual_override: false,
    })) as {
      data: {
        recalc: { dirty_cells: number; cycles: unknown[]; changed_cells: string[] };
        cell: { value_minor: number; amount_text: string | null };
        audit_id: number;
      };
    };
    expect(out.data.recalc.dirty_cells).toBe(1);
    expect(out.data.recalc.changed_cells).toContain("3f9f2c9e-9f8b-4e2d-9a1c-400000000002");
    expect(out.data.cell.value_minor).toBe(18_250_000);
    expect(out.data.cell.amount_text).toBe("182500.00");
    expect(out.data.audit_id).toBeGreaterThanOrEqual(101);
  });

  it("model.cell.set.v1 mirrors MODEL_CELL_LOCKED and FORMULA_UNSUPPORTED_FUNCTION", async () => {
    const locked = (await mockInvoke("model.cell.set.v1", {
      line_id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000002",
      scenario_id: "sc-locked-000",
      period_id: "fp-2027-p08",
      value: "1.00",
      manual_override: false,
    })) as { error: { code: string; userMessage: string } };
    expect(locked.error.code).toBe("MODEL_CELL_LOCKED");
    expect(locked.error.userMessage).toBe("This scenario is locked. Create a Version to edit it.");

    const unsupported = (await mockInvoke("model.cell.set.v1", {
      line_id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000002",
      scenario_id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000003",
      period_id: "fp-2027-p08",
      formula: "=LAMBDA(x, x)",
      manual_override: false,
    })) as { error: { code: string; details: { function: string } } };
    expect(unsupported.error.code).toBe("FORMULA_UNSUPPORTED_FUNCTION");
    expect(unsupported.error.details.function).toBe("LAMBDA");
  });

  it("model.recalc reports the working-set cells for a scenario", async () => {
    const first = (await mockInvoke("model.cell.set.v1", {
      line_id: "line-a",
      scenario_id: "sc-base",
      period_id: "fp-2027-p08",
      value: "10.00",
      manual_override: false,
    })) as { data: { recalc: { changed_cells: string[] } } };
    expect(first.data.recalc.changed_cells).toEqual(["line-a"]);
    const recalc = (await mockInvoke("model.recalc", {
      model_id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000001",
      scenario_id: "sc-base",
    })) as { data: { dirty_cells: number; changed_cells: string[] } };
    expect(recalc.data.dirty_cells).toBe(1);
    expect(recalc.data.changed_cells).toEqual(["line-a"]);
  });

  it("model.inspect reflects a cell written through model.cell.set.v1 (read-only, no mutation)", async () => {
    // Distinct line so the cross-scenario lookup doesn't collide with the earlier test's cell.
    const line = "3f9f2c9e-9f8b-4e2d-9a1c-400000000021";
    const period = "fp-2027-p08";
    await mockInvoke("model.cell.set.v1", {
      line_id: line,
      scenario_id: "sc-inspect",
      period_id: period,
      value: "42.50",
      manual_override: false,
    });
    const out = (await mockInvoke("model.inspect", { line_id: line, period_id: period })) as {
      data: {
        line_id: string;
        period_id: string;
        formula: string | null;
        computed_text: string | null;
        error_code: string | null;
        precedents: unknown[];
        dependents: unknown[];
        cycle: unknown[] | null;
        is_cycle: boolean;
      };
    };
    expect(out.data.line_id).toBe(line);
    expect(out.data.period_id).toBe(period);
    expect(out.data.computed_text).toBe("42.50");
    expect(out.data.formula).toBeNull();
    expect(out.data.error_code).toBeNull();
    // Read-only inspection never mutates the cell store.
    const again = (await mockInvoke("model.inspect", { line_id: line, period_id: period })) as {
      data: { computed_text: string | null };
    };
    expect(again.data.computed_text).toBe("42.50");
  });
});
