import { beforeEach, describe, expect, it } from "vitest";
import { ImportHistoryData, ImportValidateData, SettingsDocumentKey } from "./schema";
import { isTauriRuntime, mockInvoke, resetMockScenarioState, resetMockSettingsState } from "./mock";

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

  it("mirrors ERROR-HANDLING §A retry semantics for AUTH_PIN_INVALID and SESSION_LOCKED", async () => {
    // Docs are the source of truth (CLAUDE.md); Rust core/error.rs pins the same tuples.
    const pin = (await mockInvoke("session.unlock", {
      pin: "WrongPin9!",
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    })) as { error: { code: string; httpStatus: number; retryable: boolean; retryAfterMs: null } };
    expect(pin.error.code).toBe("AUTH_PIN_INVALID");
    expect(pin.error.httpStatus).toBe(401);
    expect(pin.error.retryable).toBe(false);
    expect(pin.error.retryAfterMs).toBeNull();

    await mockInvoke("session.lock", {});
    const locked = (await mockInvoke("settings.get", { key: "onefpa.preferences.v1" })) as {
      error: { code: string; httpStatus: number; retryable: boolean };
    };
    expect(locked.error.code).toBe("SESSION_LOCKED");
    expect(locked.error.httpStatus).toBe(401);
    expect(locked.error.retryable).toBe(false);
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

  it("import preview currency follows the active Company's default", async () => {
    await mockInvoke("session.unlock", {
      pin: "Meridian2026",
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000002",
    });
    const parsed = (await mockInvoke("import.parse", {
      file_path: "/Users/demo/EUR_GL.xlsx",
      kind: "gl_dump",
    })) as { data: { parse_id: string } };
    const tieOut = (await mockInvoke("import.tieout", {
      parse_id: parsed.data.parse_id,
      mapping_id: "canonical",
    })) as { data: { currency: string } };
    expect(tieOut.data.currency).toBe("EUR");
  });

  it("company.open returns a summary and company.delete honours the retention window", async () => {
    const open = (await mockInvoke("company.open", {
      path: "/Users/demo/Meridian Holdings.fpa",
    })) as { data: { company_id: string; model_id: string; summary: { name: string } } };
    expect(open.data.summary.name).toContain("Meridian");
    expect(open.data.model_id).toBe("3f9f2c9e-9f8b-4e2d-9a1c-100000000001");

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

    // coa.list returns a small sample COA (so S-021 merge/import are exercisable),
    // not an empty list — each account is a valid AccountNode with a unique code.
    const coa = (await mockInvoke("coa.list", {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    })) as { data: { code: string; account_type: string }[] };
    expect(coa.data).toHaveLength(3);
    const codes = coa.data.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
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

  it("import.map.save_v1 scopes stable ids/versions to a writable Company", async () => {
    await mockInvoke("company.open", { path: "/Users/demo/Meridian Holdings.fpa" });
    const template = {
      name: "Tally GL",
      columns: [
        { source_pattern: "Posting Date", semantic_target: "period" as const },
        { source_pattern: "Ledger Code", semantic_target: "account_code" as const },
        { source_pattern: "Dr", semantic_target: "debit" as const },
        { source_pattern: "Cr", semantic_target: "credit" as const },
      ],
      sign_convention: "debit_positive" as const,
      normalization: {
        account_code: "trim_collapse_whitespace_remove_hyphens" as const,
        dimension_values: "trim_collapse_whitespace" as const,
        period: "month_name_mmm_yy" as const,
      },
    };
    const first = (await mockInvoke("import.map.save_v1", { template })) as {
      data: { mapping_id: string; version: string };
    };
    const second = (await mockInvoke("import.map.save_v1", { template })) as {
      data: { mapping_id: string; version: string };
    };

    expect(first.data.mapping_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.data.mapping_id).toBe(first.data.mapping_id);
    expect(first.data.version).toBe("v1");
    expect(second.data.version).toBe("v2");
    const parsed = (await mockInvoke("import.parse", {
      file_path: "/Users/demo/Tally.csv",
      kind: "gl_dump",
    })) as { data: { parse_id: string } };
    const validated = (await mockInvoke("import.validate", {
      parse_id: parsed.data.parse_id,
      mapping_id: second.data.mapping_id,
    })) as { data: { mapping_version: string } };
    expect(validated.data.mapping_version).toBe("v2");

    await mockInvoke("session.unlock", {
      pin: "AuditBrk9!",
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    });
    const blocked = (await mockInvoke("import.map.save_v1", { template })) as {
      error: { code: string; userMessage: string };
    };
    expect(blocked.error.code).toBe("AUDIT_CHAIN_BREAK");
    expect(blocked.error.userMessage).toBe(
      "Audit integrity check failed. Restore from the last verified Snapshot?",
    );

    await mockInvoke("company.create", {
      name: "Mapping Scope Company",
      path: "/Users/demo/Mapping Scope Company.fpa",
      pack_key: "manufacturing",
      calendar: {
        preset: "12month",
        fy_start_month: 4,
        week_start_day: 0,
        anchor_rule: null,
        year_end_rule: null,
      },
      plan_only: true,
      horizon: "1y",
    });
    const otherCompany = (await mockInvoke("import.map.save_v1", { template })) as {
      data: { mapping_id: string; version: string };
    };
    expect(otherCompany.data.mapping_id).not.toBe(first.data.mapping_id);
    expect(otherCompany.data.version).toBe("v1");
    const crossCompanyParse = (await mockInvoke("import.validate", {
      parse_id: parsed.data.parse_id,
      mapping_id: otherCompany.data.mapping_id,
    })) as { error: { code: string } };
    expect(crossCompanyParse.error.code).toBe("VALUE_INVALID");
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
        currency: string;
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
    // Attribution honesty: the difference is a separate five-cent source row, not a
    // mathematically unrelated full expense row.
    expect(bad.data.diff_rows).toHaveLength(1);
    expect(bad.data.diff_rows[0].line_no).toBe(5);
    expect(bad.data.diff_rows[0].posting_ref).toBe("ROUNDING-5");
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
      exclusions: [{ line_no: 5, reason: "source rounding adjustment" }],
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
    const arbitraryExclusion = (await mockInvoke("import.commit", {
      parse_id: parsed.data.parse_id,
      mapping_id: "canonical",
      name: "crafted request",
      exclusions: [{ line_no: 2, reason: "Remove a balanced row" }],
    })) as { error: { code: string; message: string } };
    expect(arbitraryExclusion.error.code).toBe("VALUE_INVALID");
    expect(arbitraryExclusion.error.message).toContain("EXCLUSION_LINE_NOT_ATTRIBUTABLE");

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

  it("import.validate exposes bounded snake_case HARD/WARNING and valid-row preview data", async () => {
    await mockInvoke("company.open", { path: "/Users/demo/Meridian Holdings.fpa" });
    const parsed = (await mockInvoke("import.parse", {
      file_path: "/Users/demo/validation-findings.csv",
      kind: "gl_dump",
    })) as { data: { parse_id: string } };
    const envelope = (await mockInvoke("import.validate", {
      parse_id: parsed.data.parse_id,
      mapping_id: "canonical",
    })) as { data: unknown };
    const validated = ImportValidateData.parse(envelope.data);

    expect(validated).toMatchObject({
      rows: 2,
      mapping_version: "canonical-v1",
      hard: [{ code: "MAP_ACCOUNT_AMBIGUOUS", line_no: 3 }],
      warnings: [{ code: "VALUE_INVALID", line_no: 4 }],
    });
    expect(validated.preview).toHaveLength(2);
    expect(validated.preview[0]).toHaveProperty("line_no", 2);
    expect(validated.preview[0]).not.toHaveProperty("lineNo");
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

  it("refuses to commit a driver or dimension source into the general ledger (M2-5 destination honesty)", async () => {
    await mockInvoke("company.open", { path: "/Users/demo/Meridian Holdings.fpa" });
    for (const kind of ["driver_data", "dimension_master"] as const) {
      const parsed = (await mockInvoke("import.parse", {
        file_path: `/Users/demo/${kind}.xlsx`,
        kind,
      })) as { data: { parse_id: string } };
      const commit = (await mockInvoke("import.commit", {
        parse_id: parsed.data.parse_id,
        mapping_id: "canonical",
        name: `${kind} batch`,
        exclusions: [],
      })) as { error: { code: string; message: string; httpStatus: number } };
      expect(commit.error.code).toBe("VALUE_INVALID");
      expect(commit.error.httpStatus).toBe(422);
      expect(commit.error.message).toContain("IMPORT_KIND_DESTINATION_UNAVAILABLE");
      expect(commit.error.message).toContain(kind);
    }
  });

  it("guards a second opening-balance batch per Company with a batch-scope OPENING_ALREADY_SET", async () => {
    const created = (await mockInvoke("company.create", {
      name: "Opening Guard Company",
      path: "/Users/demo/Opening Guard Company.fpa",
      pack_key: "manufacturing",
      calendar: {
        preset: "12month",
        fy_start_month: 4,
        week_start_day: 0,
        anchor_rule: null,
        year_end_rule: null,
      },
      plan_only: true,
      horizon: "1y",
    })) as { data: { company_id: string } };
    expect(created.data.company_id).toBeTruthy();

    const firstParse = (await mockInvoke("import.parse", {
      file_path: "/Users/demo/OpeningBalances.xlsx",
      kind: "opening_balances",
    })) as { data: { parse_id: string } };
    // Before any opening batch exists the same command validates cleanly and commits.
    const clean = (await mockInvoke("import.validate", {
      parse_id: firstParse.data.parse_id,
      mapping_id: "canonical",
    })) as { data: { hard: unknown[]; rows: number } };
    expect(clean.data.hard).toEqual([]);
    expect(clean.data.rows).toBeGreaterThan(0);
    const committed = (await mockInvoke("import.commit", {
      parse_id: firstParse.data.parse_id,
      mapping_id: "canonical",
      name: "Opening balances FY26",
      exclusions: [],
    })) as { data: { batch_id: string } };
    expect(committed.data.batch_id).toBeTruthy();

    const secondParse = (await mockInvoke("import.parse", {
      file_path: "/Users/demo/OpeningBalances-again.xlsx",
      kind: "opening_balances",
    })) as { data: { parse_id: string } };
    const guarded = (await mockInvoke("import.validate", {
      parse_id: secondParse.data.parse_id,
      mapping_id: "canonical",
    })) as { data: unknown };
    const parsedGuard = ImportValidateData.parse(guarded.data);
    expect(parsedGuard.hard).toHaveLength(1);
    expect(parsedGuard.hard[0].code).toBe("OPENING_ALREADY_SET");
    // Batch scope: an existing Company opening set blames no single source row.
    expect(parsedGuard.hard[0].line_no).toBeNull();
    expect(parsedGuard.rows).toBe(0);
    expect(parsedGuard.preview).toEqual([]);
  });

  it("import.history persists committed batches and rollback targets only an older committed batch", async () => {
    const created = (await mockInvoke("company.create", {
      name: "History Test Company",
      path: "/Users/demo/History Test Company.fpa",
      pack_key: "manufacturing",
      calendar: {
        preset: "12month",
        fy_start_month: 4,
        week_start_day: 0,
        anchor_rule: null,
        year_end_rule: null,
      },
      plan_only: true,
      horizon: "1y",
    })) as { data: { company_id: string } };
    const companyId = created.data.company_id;
    const firstParse = (await mockInvoke("import.parse", {
      file_path: "/Users/demo/unbalanced_GL.xlsx",
      kind: "gl_dump",
    })) as { data: { parse_id: string } };
    await mockInvoke("import.commit", {
      parse_id: firstParse.data.parse_id,
      mapping_id: "canonical",
      name: "First batch",
      exclusions: [{ line_no: 5, reason: "Source rounding adjustment" }],
    });
    const secondParse = (await mockInvoke("import.parse", {
      file_path: "/Users/demo/GL.xlsx",
      kind: "gl_dump",
    })) as { data: { parse_id: string } };
    await mockInvoke("import.commit", {
      parse_id: secondParse.data.parse_id,
      mapping_id: "canonical",
      name: "Second batch",
      exclusions: [],
    });
    const duplicate = (await mockInvoke("import.commit", {
      parse_id: secondParse.data.parse_id,
      mapping_id: "canonical",
      name: "Duplicate batch",
      exclusions: [],
    })) as { error: { code: string; retryable: boolean } };
    expect(duplicate.error.code).toBe("IMPORT_BATCH_HASH_EXISTS");
    expect(duplicate.error.retryable).toBe(false);

    const history = (await mockInvoke("import.history", {
      company_id: companyId,
      page: 1,
    })) as {
      data: {
        rows: { batch_id: string; status: string; source_hash: string }[];
        meta: { page_size: number; total: number };
      };
    };
    expect(() => ImportHistoryData.parse(history.data)).not.toThrow();
    expect(history.data.meta.page_size).toBe(25);
    expect(history.data.meta.total).toBeGreaterThanOrEqual(2);
    const batchId = history.data.rows[0].batch_id;
    const priorBatchId = history.data.rows[1].batch_id;

    const noReason = (await mockInvoke("import.rollback", {
      batch_id: batchId,
      reason: " ",
    })) as { error: { code: string } };
    expect(noReason.error.code).toBe("VALUE_INVALID");

    const first = (await mockInvoke("import.rollback", {
      batch_id: batchId,
      reason: "duplicate import",
    })) as { data: { rolled_back_to: string | null } };
    expect(first.data.rolled_back_to).toBe(priorBatchId);

    const second = (await mockInvoke("import.rollback", {
      batch_id: batchId,
      reason: "duplicate import",
    })) as { error: { code: string; httpStatus: number; userMessage: string } };
    expect(second.error.code).toBe("BATCH_ALREADY_ROLLED_BACK");
    expect(second.error.httpStatus).toBe(409);
    expect(second.error.userMessage).toBe("This batch was already rolled back.");

    const refreshed = (await mockInvoke("import.history", {
      company_id: companyId,
      page: 1,
    })) as { data: { rows: { batch_id: string; status: string }[] } };
    expect(refreshed.data.rows.find((batch) => batch.batch_id === batchId)?.status).toBe(
      "rolled_back",
    );
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

  /** The Model the mock session currently owns — what the stores send via `activeModelId()`. */
  async function activeMockModelId(): Promise<string> {
    const status = (await mockInvoke("session.status", {})) as {
      data: { model_id: string | null };
    };
    // Outside a session the ownership gate is off; any shape-valid id is accepted then.
    return status.data.model_id ?? "3f9f2c9e-9f8b-4e2d-9a1c-400000000001";
  }

  it("driver.upsert creates and updates a driver (exact decimal bounds)", async () => {
    const created = (await mockInvoke("driver.upsert", {
      model_id: await activeMockModelId(),
      driver: {
        name: "units_upsert",
        driver_type: "volume_x_rate",
        unit: "units",
        source: "global",
        is_core: true,
        bounds_low: "0",
        bounds_high: "100000",
      },
    })) as { data: { driver_id: string; created: boolean } };
    expect(created.data.driver_id).toBe("dr-units_upsert");
    expect(created.data.created).toBe(true);

    const updated = (await mockInvoke("driver.upsert", {
      model_id: await activeMockModelId(),
      driver: {
        id: "dr-units_upsert",
        name: "units_upsert",
        driver_type: "ratio",
        unit: null,
        source: "bu_override",
        is_core: false,
        bounds_low: "10",
      },
    })) as { data: { driver_id: string; created: boolean } };
    expect(updated.data.driver_id).toBe("dr-units_upsert");
    expect(updated.data.created).toBe(false);
  });

  it("driver.upsert refuses a collection driver with no feed source (DRIVER_FEED_MISSING)", async () => {
    const out = (await mockInvoke("driver.upsert", {
      model_id: await activeMockModelId(),
      driver: {
        name: "nofeed",
        driver_type: "manual",
        unit: null,
        source: "collection",
        is_core: false,
      },
    })) as { error: { code: string; userMessage: string } };
    expect(out.error.code).toBe("DRIVER_FEED_MISSING");
    expect(out.error.userMessage).toMatch(/no data and no feed source/);
  });

  it("driver.set_value stores the exact decimal and enforces bounds (DRIVER_OUT_OF_BOUNDS)", async () => {
    const set = (await mockInvoke("driver.upsert", {
      model_id: await activeMockModelId(),
      driver: {
        name: "units_bound",
        driver_type: "volume_x_rate",
        unit: "units",
        source: "global",
        is_core: false,
        bounds_low: "0",
        bounds_high: "100",
      },
    })) as { data: { driver_id: string } };
    const id = set.data.driver_id;
    // Out of bounds → no `ok` field; the envelope carries a `DRIVER_OUT_OF_BOUNDS` error.
    const bad = (await mockInvoke("driver.set_value", {
      driver_id: id,
      scenario_id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000003",
      period_id: "fp-2027-p08",
      value_decimal: "200000",
    })) as { error: { code: string } };
    expect(bad.error.code).toBe("DRIVER_OUT_OF_BOUNDS");

    const good = (await mockInvoke("driver.set_value", {
      driver_id: id,
      scenario_id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000003",
      period_id: "fp-2027-p08",
      value_decimal: "50",
    })) as { data: { ok: boolean; value_decimal: string } };
    expect(good.data.ok).toBe(true);
    expect(good.data.value_decimal).toBe("50");

    const unknown = (await mockInvoke("driver.set_value", {
      driver_id: "dr-nope",
      scenario_id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000003",
      period_id: "fp-2027-p08",
      value_decimal: "1",
    })) as { error: { code: string } };
    expect(unknown.error.code).toBe("REFERENCE_BROKEN");
  });

  it("mirrors the native model_belongs_to_company gate once a Company is unlocked (403, not silent)", async () => {
    // Regression (2026-09-03): the preview accepted any model_id, masking a guaranteed native
    // failure for stores that still sent the API-SPEC example id.
    const unlocked = (await mockInvoke("session.unlock", {
      pin: "Meridian#2026",
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    })) as { data: { model_id: string } };
    const activeModel = unlocked.data.model_id;
    expect(activeModel).toBeTruthy();
    const exampleModel = "3f9f2c9e-9f8b-4e2d-9a1c-400000000001";
    expect(activeModel).not.toBe(exampleModel);

    const driverBody = {
      name: "scope_units",
      driver_type: "volume_x_rate",
      unit: "units",
      source: "global",
      is_core: false,
    } as const;
    const refused = (await mockInvoke("driver.upsert", {
      model_id: exampleModel,
      driver: driverBody,
    })) as { error: { code: string; httpStatus: number; userMessage: string; retryable: boolean } };
    // Same envelope as `AppError::Scope` (core/error.rs): VALUE_INVALID · 403 · not retryable.
    expect(refused.error.code).toBe("VALUE_INVALID");
    expect(refused.error.httpStatus).toBe(403);
    expect(refused.error.retryable).toBe(false);
    expect(refused.error.userMessage).toBe("This operation is not permitted.");

    const accepted = (await mockInvoke("driver.upsert", {
      model_id: activeModel,
      driver: driverBody,
    })) as { data: { driver_id: string; created: boolean } };
    expect(accepted.data.created).toBe(true);

    const listRefused = (await mockInvoke("assumption.list", { model_id: exampleModel })) as {
      error: { code: string; httpStatus: number };
    };
    expect(listRefused.error).toEqual(
      expect.objectContaining({ code: "VALUE_INVALID", httpStatus: 403 }),
    );
    const listOk = (await mockInvoke("assumption.list", { model_id: activeModel })) as {
      data: unknown[];
    };
    expect(Array.isArray(listOk.data)).toBe(true);
    // Lock again so the model-scoped tests below (no session → not gated) keep their meaning.
    await mockInvoke("session.lock", {});
  });

  it("assumption.upsert/list preserve exact values and scope list results by model", async () => {
    const model = "3f9f2c9e-9f8b-4e2d-400000000001";
    const otherModel = "3f9f2c9e-9f8b-4e2d-400000000002";
    const first = (await mockInvoke("assumption.upsert", {
      model_id: model,
      assumption: {
        name: "wage_inflation",
        unit: "%",
        owner: "HR",
        source: "HR plan",
        bounds_low: "0",
        bounds_high: "10",
        effective_from: "fp-2026-p01",
        effective_to: null,
        values: { "fp-2026-p01": "4.0" },
      },
    })) as { data: { assumption_id: string; created: boolean } };
    expect(first.data.created).toBe(true);
    const list = (await mockInvoke("assumption.list", { model_id: model })) as {
      data: { name: string; values: Record<string, string> }[];
    };
    expect(list.data).toEqual([
      expect.objectContaining({ name: "wage_inflation", values: { "fp-2026-p01": "4.0" } }),
    ]);
    const other = (await mockInvoke("assumption.upsert", {
      model_id: otherModel,
      assumption: {
        name: "wage_inflation",
        unit: "%",
        owner: "HR",
        source: null,
        bounds_low: null,
        bounds_high: null,
        effective_from: null,
        effective_to: null,
        values: {},
      },
    })) as { data: { assumption_id: string } };
    const scoped = (await mockInvoke("assumption.list", { model_id: otherModel })) as {
      data: { id?: string }[];
    };
    expect(scoped.data.map((assumption) => assumption.id)).toEqual([other.data.assumption_id]);
  });

  it("assumption.upsert exposes the locked-baseline error contract", async () => {
    const out = (await mockInvoke("assumption.upsert", {
      model_id: "3f9f2c9e-9f8b-4e2d-400000000001",
      assumption: {
        id: "as-locked-baseline",
        name: "locked_rate",
        unit: "%",
        owner: "Finance",
        source: "Board plan",
        bounds_low: null,
        bounds_high: null,
        effective_from: null,
        effective_to: null,
        values: {},
      },
    })) as { error: { code: string; userMessage: string; httpStatus: number } };
    expect(out.error.code).toBe("ASSUMPTION_IN_USE_LOCKED");
    expect(out.error.httpStatus).toBe(422);
    expect(out.error.userMessage).toBe(
      "Assumption is used by a Locked Baseline. Create a new Version to change.",
    );
  });

  it("driver.import passes the IMPORT_* errors through and returns a batch id", async () => {
    const locked = (await mockInvoke("driver.import", {
      file_path: "/tmp/locked.xlsx",
      mapping_id: "canonical",
    })) as { error: { code: string } };
    expect(locked.error.code).toBe("IMPORT_FILE_LOCKED");
    const ok = (await mockInvoke("driver.import", {
      file_path: "/tmp/drivers.xlsx",
      mapping_id: "canonical",
    })) as { data: { batch_id: string } };
    expect(ok.data.batch_id).toMatch(/^3f9f2c9e-[0-9a-f-]+$/);
  });

  it("coa.list returns the sample COA and coa.import honours the source XOR", async () => {
    const list = (await mockInvoke("coa.list", {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    })) as { data: { code: string }[] };
    expect(list.data.length).toBeGreaterThan(0);

    const pack = (await mockInvoke("coa.import", {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      pack_key: "saas",
    })) as { data: { created: number; updated: number } };
    expect(pack.data.created).toBeGreaterThan(0);

    const neither = (await mockInvoke("coa.import", {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    })) as { error: { code: string } };
    expect(neither.error.code).toBe("VALUE_INVALID");
  });

  it("coa.merge_accounts remaps lines and rejects merging an account into itself", async () => {
    const ok = (await mockInvoke("coa.merge_accounts", {
      from_id: "00000000-0000-4000-8000-000000000001",
      to_id: "00000000-0000-4000-8000-000000000003",
    })) as { data: { remapped: number } };
    expect(ok.data.remapped).toBeGreaterThanOrEqual(0);

    const same = (await mockInvoke("coa.merge_accounts", {
      from_id: "00000000-0000-4000-8000-000000000001",
      to_id: "00000000-0000-4000-8000-000000000001",
    })) as { error: { code: string } };
    expect(same.error.code).toBe("VALUE_INVALID");
  });

  it("company.clone_sandbox copies a company into a new sandbox with a derived path", async () => {
    const out = (await mockInvoke("company.clone_sandbox", {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      name: "Meridian (Q3 What-if)",
    })) as { data: { company_id: string } };
    expect(out.data.company_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const list = (await mockInvoke("company.list", {})) as {
      data: { name: string; company_file_path: string }[];
    };
    const created = list.data.find((c) => c.name === "Meridian (Q3 What-if)");
    expect(created).toBeDefined();
    // derived from the source file's directory + the sandbox name
    expect(created?.company_file_path).toBe("/Users/demo/Meridian (Q3 What-if).fpa");

    // a too-short (trimmed) sandbox name is bad input
    const bad = (await mockInvoke("company.clone_sandbox", {
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      name: " ",
    })) as { error: { code: string } };
    expect(bad.error.code).toBe("VALUE_INVALID");
  });

  it("settings.get/set mirror the app-scope settings row with session + save-failure gates", async () => {
    resetMockSettingsState();
    await mockInvoke("session.lock", {});

    const locked = (await mockInvoke("settings.get", {
      key: SettingsDocumentKey,
    })) as { error: { code: string } };
    expect(locked.error.code).toBe("SESSION_LOCKED");

    await mockInvoke("session.unlock", {
      pin: "Meridian2026",
      company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    });

    const empty = (await mockInvoke("settings.get", {
      key: SettingsDocumentKey,
    })) as { data: { value: string | null } };
    expect(empty.data.value).toBeNull();

    const saved = (await mockInvoke("settings.set", {
      key: SettingsDocumentKey,
      value_json: JSON.stringify({ theme: "dark", density: "compact" }),
    })) as { data: { ok: boolean } };
    expect(saved.data.ok).toBe(true);

    const restored = (await mockInvoke("settings.get", {
      key: SettingsDocumentKey,
    })) as { data: { value: string } };
    expect(JSON.parse(restored.data.value)).toEqual({ theme: "dark", density: "compact" });

    const bad = (await mockInvoke("settings.set", {
      key: SettingsDocumentKey,
      value_json: "{not-json",
    })) as { error: { code: string; userMessage: string; retryable: boolean } };
    expect(bad.error.code).toBe("SETTINGS_SAVE_FAILED");
    expect(bad.error.userMessage).toBe("Settings could not be saved. Retry.");
    expect(bad.error.retryable).toBe(true);
  });
});

describe("dev mock — scenario lifecycle (F-022 · SCENARIO-VERSION-SPEC §1–§3)", () => {
  const MO = "3f9f2c9e-9f8b-4e2d-9a1c-400000000001";
  const BASE = "3f9f2c9e-9f8b-4e2d-9a1c-400000000003";
  const LINE = "3f9f2c9e-9f8b-4e2d-9a1c-400000000010";

  /** Locking mutates module state — each test seeds a fresh scenario set. */
  beforeEach(async () => {
    await mockInvoke("session.lock", {});
    resetMockScenarioState();
  });

  type ScenarioListRow = {
    id: string;
    name: string;
    kind: string;
    state: string;
    baseline: boolean;
    versions: { version_no: number; label: string }[];
  };
  async function listScenarios(): Promise<ScenarioListRow[]> {
    const out = (await mockInvoke("model.list", { company_id: MO })) as {
      data: { id: string; scenarios: ScenarioListRow[] }[];
    };
    expect(out.data).toHaveLength(1);
    return out.data[0].scenarios;
  }

  it("seeds one Base budget draft per model and lists it through model.list", async () => {
    const scenarios = await listScenarios();
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]).toMatchObject({
      id: BASE,
      name: "Base",
      kind: "budget",
      state: "draft",
      baseline: false,
      versions: [],
    });
  });

  it("runs Draft→Review→Approved→Locked and lock auto-writes Version v1", async () => {
    const created = (await mockInvoke("scenario.create", {
      model_id: MO,
      name: "FY27 Plan",
    })) as { data: { scenario_id: string; version_id: null } };
    const sc = created.data.scenario_id;
    expect(created.data.version_id).toBeNull();

    for (const [cmd, from] of [
      ["scenario.submit", "review"],
      ["scenario.approve", "approved"],
    ] as const) {
      await mockInvoke(cmd, { scenario_id: sc });
      const row = (await listScenarios()).find((s) => s.id === sc);
      expect(row?.state).toBe(from);
    }

    const locked = (await mockInvoke("scenario.lock", { scenario_id: sc })) as {
      data: { scenario_id: string; version_id: string | null };
    };
    expect(locked.data.version_id).not.toBeNull();
    const row = (await listScenarios()).find((s) => s.id === sc);
    expect(row?.state).toBe("locked");
    expect(row?.versions).toHaveLength(1);
    expect(row?.versions[0]).toMatchObject({ version_no: 1, label: "v1" });
  });

  it("rejects illegal transitions with SCENARIO_LOCK_CONFLICT 409 and the documented copy", async () => {
    const sc = (
      (await mockInvoke("scenario.create", { model_id: MO, name: "Guard" })) as {
        data: { scenario_id: string };
      }
    ).data.scenario_id;

    // approve from draft (must submit first)
    const early = (await mockInvoke("scenario.approve", { scenario_id: sc })) as {
      error: { code: number | string; httpStatus: number; userMessage: string };
    };
    expect(early.error.code).toBe("SCENARIO_LOCK_CONFLICT");
    expect(early.error.httpStatus).toBe(409);
    expect(early.error.userMessage).toBe("This Scenario is already in draft — cannot transition.");

    await mockInvoke("scenario.submit", { scenario_id: sc });
    const resubmit = (await mockInvoke("scenario.submit", { scenario_id: sc })) as {
      error: { code: string; userMessage: string };
    };
    expect(resubmit.error.code).toBe("SCENARIO_LOCK_CONFLICT");
    expect(resubmit.error.userMessage).toBe(
      "This Scenario is already in review — cannot transition.",
    );
  });

  it("answers SCENARIO_NAME_DUP 409 with the documented copy on UNIQUE(model_id, name)", async () => {
    await mockInvoke("scenario.create", { model_id: MO, name: "Twin" });
    const dup = (await mockInvoke("scenario.create", { model_id: MO, name: "Twin" })) as {
      error: { code: string; httpStatus: number; userMessage: string };
    };
    expect(dup.error.code).toBe("SCENARIO_NAME_DUP");
    expect(dup.error.httpStatus).toBe(409);
    expect(dup.error.userMessage).toBe("A Scenario with this name already exists.");

    // derived duplicate names never collide
    const c1 = (await mockInvoke("scenario.duplicate", { model_id: MO, base_id: BASE })) as {
      data: { scenario_id: string };
    };
    const c2 = (await mockInvoke("scenario.duplicate", { model_id: MO, base_id: BASE })) as {
      data: { scenario_id: string };
    };
    expect(c1.data.scenario_id).not.toBe(c2.data.scenario_id);
  });

  it("gates edits on the table state: locked Scenario ⇒ MODEL_CELL_LOCKED on cell and driver writes", async () => {
    const sc = (
      (await mockInvoke("scenario.create", { model_id: MO, name: "Frozen" })) as {
        data: { scenario_id: string };
      }
    ).data.scenario_id;
    for (const cmd of ["scenario.submit", "scenario.approve", "scenario.lock"] as const) {
      await mockInvoke(cmd, { scenario_id: sc });
    }

    const cell = (await mockInvoke("model.cell.set.v1", {
      line_id: LINE,
      scenario_id: sc,
      period_id: "fp-2027-p08",
      value: "1.00",
      manual_override: false,
    })) as { error: { code: string; userMessage: string } };
    expect(cell.error.code).toBe("MODEL_CELL_LOCKED");
    expect(cell.error.userMessage).toBe("This scenario is locked. Create a Version to edit it.");

    const up = (await mockInvoke("driver.upsert", {
      model_id: MO,
      driver: {
        name: "hc-gate",
        driver_type: "volume_x_rate",
        unit: "units",
        source: "global",
        is_core: false,
        bounds_low: "0",
        bounds_high: "100",
      },
    })) as { data: { driver_id: string } };
    const driverGate = (await mockInvoke("driver.set_value", {
      driver_id: up.data.driver_id,
      scenario_id: sc,
      period_id: "fp-2027-p08",
      value_decimal: "10",
    })) as { error: { code: string } };
    expect(driverGate.error.code).toBe("MODEL_CELL_LOCKED");

    // the working Base (draft) still accepts writes; the synthetic "locked" dev trigger still gates
    const okCell = (await mockInvoke("model.cell.set.v1", {
      line_id: LINE,
      scenario_id: BASE,
      period_id: "fp-2027-p08",
      value: "2.00",
      manual_override: false,
    })) as { data: { audit_id: number } };
    expect(okCell.data.audit_id).toBeGreaterThan(0);
    const legacy = (await mockInvoke("model.cell.set.v1", {
      line_id: LINE,
      scenario_id: "sc-locked-000",
      period_id: "fp-2027-p08",
      value: "1.00",
      manual_override: false,
    })) as { error: { code: string } };
    expect(legacy.error.code).toBe("MODEL_CELL_LOCKED");
  });

  it("reopen requires a written reason and Locked→Draft is blocked for the Baseline", async () => {
    const sc = (
      (await mockInvoke("scenario.create", { model_id: MO, name: "ReopenMe" })) as {
        data: { scenario_id: string };
      }
    ).data.scenario_id;
    for (const cmd of ["scenario.submit", "scenario.approve", "scenario.lock"] as const) {
      await mockInvoke(cmd, { scenario_id: sc });
    }

    const noReason = (await mockInvoke("scenario.reopen", { scenario_id: sc })) as {
      error: { code: string; httpStatus: number };
    };
    expect(noReason.error.code).toBe("VALUE_INVALID");
    expect(noReason.error.httpStatus).toBe(422);

    // the Baseline must be Locked — and a Locked Baseline cannot reopen
    const bl = (await mockInvoke("baseline.set", { scenario_id: sc })) as {
      data: { baseline_version_id: string };
    };
    expect(bl.data.baseline_version_id).not.toBeNull();
    const blocked = (await mockInvoke("scenario.reopen", {
      scenario_id: sc,
      reason: "want to edit",
    })) as { error: { code: string; userMessage: string } };
    expect(blocked.error.code).toBe("SCENARIO_LOCK_CONFLICT");
    expect(blocked.error.userMessage).toBe(
      "This Scenario is already in locked — cannot transition.",
    );

    // a non-baseline Locked scenario reopens with a reason
    const other = (
      (await mockInvoke("scenario.create", { model_id: MO, name: "ReopenOther" })) as {
        data: { scenario_id: string };
      }
    ).data.scenario_id;
    for (const cmd of ["scenario.submit", "scenario.approve", "scenario.lock"] as const) {
      await mockInvoke(cmd, { scenario_id: other });
    }
    await mockInvoke("scenario.reopen", { scenario_id: other, reason: "restatement" });
    expect((await listScenarios()).find((s) => s.id === other)?.state).toBe("draft");
  });

  it("baseline.set replaces only with a reason (BASELINE_REPLACE_REASON_REQUIRED 422)", async () => {
    const lockIt = async (name: string) => {
      const id = (
        (await mockInvoke("scenario.create", { model_id: MO, name })) as {
          data: { scenario_id: string };
        }
      ).data.scenario_id;
      for (const cmd of ["scenario.submit", "scenario.approve", "scenario.lock"] as const) {
        await mockInvoke(cmd, { scenario_id: id });
      }
      return id;
    };

    const first = await lockIt("Budget A");
    const firstVersion = (
      (await mockInvoke("baseline.set", { scenario_id: first })) as {
        data: { baseline_version_id: string };
      }
    ).data.baseline_version_id;
    expect(firstVersion).not.toBeNull();

    // replacing the baseline needs a written reason
    const second = await lockIt("Budget B");
    const noReason = (await mockInvoke("baseline.set", { scenario_id: second })) as {
      error: { code: string; httpStatus: number; userMessage: string };
    };
    expect(noReason.error.code).toBe("BASELINE_REPLACE_REASON_REQUIRED");
    expect(noReason.error.httpStatus).toBe(422);
    expect(noReason.error.userMessage).toBe("Replacing the baseline requires a written reason.");

    const withReason = (await mockInvoke("baseline.set", {
      scenario_id: second,
      reason: "FY27 re-approve",
    })) as { data: { baseline_version_id: string } };
    expect(withReason.data.baseline_version_id).not.toBeNull();
    const rows = await listScenarios();
    expect(rows.find((s) => s.id === first)?.baseline).toBe(false);
    expect(rows.find((s) => s.id === second)?.baseline).toBe(true);
  });

  it("deletes Draft-only scenarios without versions and refuses anything else", async () => {
    const draft = (
      (await mockInvoke("scenario.create", { model_id: MO, name: "Throwaway" })) as {
        data: { scenario_id: string };
      }
    ).data.scenario_id;
    const gone = (await mockInvoke("scenario.delete", { scenario_id: draft })) as {
      data: { scenario_id: string; version_id: null };
    };
    expect(gone.data.scenario_id).toBe(draft);
    expect((await listScenarios()).find((s) => s.id === draft)).toBeUndefined();

    // with a Version: undeletable (reopen to draft does not lift the Version reference)
    const versioned = (
      (await mockInvoke("scenario.create", { model_id: MO, name: "Keeper" })) as {
        data: { scenario_id: string };
      }
    ).data.scenario_id;
    for (const cmd of ["scenario.submit", "scenario.approve", "scenario.lock"] as const) {
      await mockInvoke(cmd, { scenario_id: versioned });
    }
    await mockInvoke("scenario.reopen", { scenario_id: versioned, reason: "back to draft" });
    const refused = (await mockInvoke("scenario.delete", { scenario_id: versioned })) as {
      error: { code: string };
    };
    expect(refused.error.code).toBe("SCENARIO_LOCK_CONFLICT");

    const unknown = (await mockInvoke("scenario.submit", {
      scenario_id: "5c4f1a2b-9d3e-4c7a-8b2f-999999999999",
    })) as { error: { code: string } };
    expect(unknown.error.code).toBe("VALUE_INVALID");
  });
});
