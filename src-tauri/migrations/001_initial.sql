-- OneFP&A 001_initial.sql — generated from docs/DATABASE-SCHEMA.md (56 tables)
-- Money = INTEGER minor units (I1); NEVER REAL. IDs = TEXT UUIDv4. created_at/updated_at TEXT ISO-8601 UTC.
PRAGMA foreign_keys = ON;


CREATE TABLE companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK(type IN ('single','group')),
    default_currency_code TEXT NOT NULL,
    base_locale TEXT NOT NULL DEFAULT 'en-IN',
    pack_schema_version TEXT NOT NULL,
    company_file_path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE business_units (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    parent_bu_id TEXT REFERENCES business_units(id),
    pack_id TEXT NOT NULL REFERENCES packs(id),
    calendar_id TEXT NOT NULL REFERENCES fiscal_calendars(id),
    reporting_currency_code TEXT NOT NULL,
    is_consolidated INTEGER NOT NULL DEFAULT 1 CHECK(is_consolidated IN (0,1)),
    ownership_pct NUMERIC(9,6),
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE(company_id,name)
);

CREATE TABLE bu_ownership (
    id TEXT PRIMARY KEY,
    bu_id TEXT NOT NULL REFERENCES business_units(id),
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    ownership_pct NUMERIC(9,6) NOT NULL CHECK(ownership_pct > 0 AND ownership_pct <= 100),
    note TEXT
);

CREATE TABLE packs (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    is_bundled INTEGER NOT NULL DEFAULT 1,
    source_checksum TEXT NOT NULL,
    installed_at TEXT NOT NULL
);

CREATE TABLE pack_components (
    id TEXT PRIMARY KEY,
    pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('coa','kpi','driver_template','report_layout','calendar_preset','gl_template')),
    ref_key TEXT NOT NULL,
    payload TEXT NOT NULL
);

CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    bu_id TEXT REFERENCES business_units(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK(account_type IN ('revenue','cogs','opex','asset','liability','equity')),
    report_section TEXT NOT NULL,
    parent_id TEXT REFERENCES accounts(id),
    is_control INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(company_id,bu_id,code,version)
);

CREATE TABLE dimensions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    is_tree INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE dimension_values (
    id TEXT PRIMARY KEY,
    dimension_id TEXT NOT NULL REFERENCES dimensions(id),
    parent_id TEXT REFERENCES dimension_values(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(dimension_id,code)
);

CREATE TABLE account_dimension_map (
    account_id TEXT NOT NULL REFERENCES accounts(id),
    dimension_id TEXT NOT NULL REFERENCES dimensions(id),
    required INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(account_id,dimension_id)
);

CREATE TABLE fiscal_calendars (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    name TEXT NOT NULL,
    preset TEXT NOT NULL CHECK(preset IN ('12month','454','445','544','3334')),
    fy_start_month INTEGER CHECK(fy_start_month BETWEEN 1 AND 12),
    week_start_day INTEGER NOT NULL CHECK(week_start_day BETWEEN 0 AND 6),
    anchor_rule TEXT CHECK(anchor_rule IN ('sunday_near_feb_1','nearest_weekday','first_day')),
    year_end_rule TEXT CHECK(year_end_rule IN ('nrf_4_day','full_week')),
    tz TEXT NOT NULL DEFAULT 'UTC',
    UNIQUE(company_id,name)
);

CREATE TABLE fiscal_years (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL REFERENCES fiscal_calendars(id),
    fy_label TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    week_count INTEGER NOT NULL CHECK(week_count IN (52,53)),
    is_leap_fiscal INTEGER NOT NULL DEFAULT 0,
    UNIQUE(calendar_id,fy_label)
);

CREATE TABLE fiscal_periods (
    id TEXT PRIMARY KEY,
    fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
    period_no INTEGER NOT NULL CHECK(period_no BETWEEN 1 AND 13),
    code TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    is_53rd_week INTEGER NOT NULL DEFAULT 0,
    UNIQUE(fiscal_year_id,period_no)
);

CREATE TABLE bu_calendar_map (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    bu_id TEXT NOT NULL REFERENCES business_units(id),
    group_period_id TEXT NOT NULL REFERENCES fiscal_periods(id),
    bu_period_id TEXT NOT NULL REFERENCES fiscal_periods(id),
    mapping TEXT NOT NULL CHECK(mapping IN ('exact','partial')),
    share_pct NUMERIC(9,6)
);

CREATE TABLE models (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    name TEXT NOT NULL,
    horizon TEXT NOT NULL CHECK(horizon IN ('13w','1y','3y','5y')),
    status TEXT NOT NULL DEFAULT 'active',
    current_scenario_id TEXT REFERENCES scenarios(id),
    last_recalculated_at TEXT,
    pack_id TEXT NOT NULL REFERENCES packs(id)
);

CREATE TABLE model_sheets (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL REFERENCES models(id),
    name TEXT NOT NULL,
    sheet_type TEXT NOT NULL CHECK(sheet_type IN ('input','formula','driver','assumption','schedule','statement')),
    sort_order INTEGER NOT NULL,
    UNIQUE(model_id,name)
);

CREATE TABLE model_lines (
    id TEXT PRIMARY KEY,
    sheet_id TEXT NOT NULL REFERENCES model_sheets(id),
    account_id TEXT REFERENCES accounts(id),
    driver_id TEXT REFERENCES drivers(id),
    method TEXT NOT NULL CHECK(method IN ('manual','static','driver','growth','yoy','seasonal','spread')),
    format TEXT NOT NULL CHECK(format IN ('money','percent','number','date')),
    decimals INTEGER NOT NULL DEFAULT 2,
    is_parent INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL
);

CREATE TABLE model_values (
    id TEXT PRIMARY KEY,
    line_id TEXT NOT NULL REFERENCES model_lines(id),
    scenario_id TEXT NOT NULL REFERENCES scenarios(id),
    period_id TEXT NOT NULL REFERENCES fiscal_periods(id),
    amount_minor INTEGER,
    amount_text TEXT,
    formula TEXT,
    computed INTEGER NOT NULL DEFAULT 1 CHECK(computed IN (0,1)),
    source_version_id TEXT REFERENCES scenario_versions(id),
    UNIQUE(line_id,scenario_id,period_id)
);

CREATE TABLE scenarios (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL REFERENCES models(id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('actuals','budget','forecast','whatif','lrp')),
    state TEXT NOT NULL CHECK(state IN ('draft','review','approved','locked')),
    parent_scenario_id TEXT REFERENCES scenarios(id),
    baseline INTEGER NOT NULL DEFAULT 0,
    UNIQUE(model_id,name)
);

CREATE TABLE scenario_versions (
    id TEXT PRIMARY KEY,
    scenario_id TEXT NOT NULL REFERENCES scenarios(id),
    version_no INTEGER NOT NULL,
    label TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(scenario_id,version_no)
);

CREATE TABLE drivers (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL REFERENCES models(id),
    name TEXT NOT NULL,
    driver_type TEXT NOT NULL CHECK(driver_type IN ('volume_x_rate','headcount','growth','seasonal','spread','ratio','manual')),
    unit TEXT,
    source TEXT NOT NULL CHECK(source IN ('global','bu_override','collection','imported')),
    is_core INTEGER NOT NULL DEFAULT 0,
    bounds_low TEXT,
    bounds_high TEXT
);

CREATE TABLE driver_values (
    id TEXT PRIMARY KEY,
    driver_id TEXT NOT NULL REFERENCES drivers(id),
    scenario_id TEXT NOT NULL REFERENCES scenarios(id),
    period_id TEXT NOT NULL REFERENCES fiscal_periods(id),
    value_decimal TEXT NOT NULL,
    source_batch_id TEXT REFERENCES import_batches(id),
    UNIQUE(driver_id,scenario_id,period_id)
);

CREATE TABLE assumptions (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL REFERENCES models(id),
    name TEXT NOT NULL,
    unit TEXT,
    owner TEXT NOT NULL,
    source TEXT,
    bounds_low TEXT,
    bounds_high TEXT,
    effective_from TEXT,
    effective_to TEXT,
    UNIQUE(model_id,name)
);

CREATE TABLE assumption_values (
    id TEXT PRIMARY KEY,
    assumption_id TEXT NOT NULL REFERENCES assumptions(id),
    period_id TEXT NOT NULL REFERENCES fiscal_periods(id),
    value_decimal TEXT NOT NULL,
    UNIQUE(assumption_id,period_id)
);

CREATE TABLE import_batches (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    kind TEXT NOT NULL CHECK(kind IN ('gl_dump','excel_csv','driver_data','opening_balances','dimension_master','connector_sync','collection')),
    source_name TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    mapping_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('validated','committed','rolled_back','failed')),
    row_count INTEGER NOT NULL,
    debits_minor INTEGER,
    credits_minor INTEGER,
    tie_out_status TEXT NOT NULL CHECK(tie_out_status IN ('pass','fail','excluded_rows_logged')),
    rollback_to_batch_id TEXT REFERENCES import_batches(id),
    committed_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE mapping_templates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    checksum TEXT NOT NULL,
    UNIQUE(company_id,name)
);

CREATE TABLE mapping_columns (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL REFERENCES mapping_templates(id),
    source_pattern TEXT NOT NULL,
    semantic_target TEXT NOT NULL,
    UNIQUE(template_id,source_pattern)
);

CREATE TABLE source_files (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES import_batches(id),
    original_name TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    retained_until TEXT
);

CREATE TABLE gl_lines (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    batch_id TEXT NOT NULL REFERENCES import_batches(id),
    bu_id TEXT REFERENCES business_units(id),
    period_id TEXT NOT NULL REFERENCES fiscal_periods(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    dims_json TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    currency_code TEXT NOT NULL,
    debit_minor INTEGER,
    credit_minor INTEGER,
    posting_ref TEXT,
    doc_type TEXT,
    is_ic INTEGER NOT NULL DEFAULT 0,
    is_excluded INTEGER NOT NULL DEFAULT 0,
    line_no INTEGER NOT NULL,
    UNIQUE(batch_id,line_no)
);

CREATE TABLE ic_lines (
    id TEXT PRIMARY KEY,
    gl_line_id TEXT NOT NULL REFERENCES gl_lines(id),
    source_bu_id TEXT NOT NULL REFERENCES business_units(id),
    counterparty_bu_id TEXT NOT NULL REFERENCES business_units(id),
    ic_amount_minor INTEGER NOT NULL,
    matched_line_id TEXT REFERENCES ic_lines(id)
);

CREATE TABLE connectors (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    oauth_kind TEXT NOT NULL CHECK(oauth_kind IN ('oauth2','oauth1')),
    state TEXT NOT NULL CHECK(state IN ('disconnected','connected','error'))
);

CREATE TABLE connector_credentials (
    id TEXT PRIMARY KEY,
    connector_id TEXT NOT NULL REFERENCES connectors(id),
    keychain_service TEXT NOT NULL,
    keychain_account TEXT NOT NULL,
    token_metadata_json TEXT NOT NULL
);

CREATE TABLE connector_sync_runs (
    id TEXT PRIMARY KEY,
    connector_id TEXT NOT NULL REFERENCES connectors(id),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    rows_pulled INTEGER NOT NULL DEFAULT 0,
    batch_id TEXT REFERENCES import_batches(id),
    status TEXT NOT NULL CHECK(status IN ('running','success','failed','rate_limited','paused'))
);

CREATE TABLE fx_rates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    from_code TEXT NOT NULL,
    to_code TEXT NOT NULL,
    period_id TEXT NOT NULL REFERENCES fiscal_periods(id),
    rate_type TEXT NOT NULL CHECK(rate_type IN ('average','closing','historical')),
    rate_decimal TEXT NOT NULL,
    UNIQUE(from_code,to_code,period_id,rate_type)
);

CREATE TABLE group_rollup_maps (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    bu_id TEXT NOT NULL REFERENCES business_units(id),
    source_account_id TEXT NOT NULL REFERENCES accounts(id),
    group_account_id TEXT NOT NULL REFERENCES accounts(id),
    weight_pct NUMERIC(9,6) NOT NULL DEFAULT 100
);

CREATE TABLE kpis (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    name TEXT NOT NULL,
    formula TEXT NOT NULL,
    unit TEXT NOT NULL,
    target_owner TEXT NOT NULL DEFAULT 'User',
    definition_text TEXT NOT NULL,
    UNIQUE(company_id,name)
);

CREATE TABLE report_layouts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    config_json TEXT NOT NULL,
    UNIQUE(company_id,name)
);

CREATE TABLE layout_columns (
    id TEXT PRIMARY KEY,
    layout_id TEXT NOT NULL REFERENCES report_layouts(id),
    col_type TEXT NOT NULL CHECK(col_type IN ('period','ytd','fy','variance','threeway','custom')),
    period_ref TEXT,
    sort_order INTEGER NOT NULL,
    UNIQUE(layout_id,sort_order)
);

CREATE TABLE board_packs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    template_json TEXT NOT NULL,
    last_generated_at TEXT
);

CREATE TABLE audit_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL REFERENCES companies(id),
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    object_type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE health_checks (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL REFERENCES models(id),
    run_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('running','passed','failed'))
);

CREATE TABLE health_findings (
    id TEXT PRIMARY KEY,
    check_id TEXT NOT NULL REFERENCES health_checks(id),
    category TEXT NOT NULL CHECK(category IN ('tie_out','reference','rounding','driver_feed','anomaly')),
    severity TEXT NOT NULL CHECK(severity IN ('hard','warn')),
    message TEXT NOT NULL,
    entity_ref TEXT
);

CREATE TABLE waivers (
    id TEXT PRIMARY KEY,
    finding_id TEXT NOT NULL REFERENCES health_findings(id),
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL,
    actor TEXT NOT NULL
);

CREATE TABLE alerts (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL REFERENCES alert_rules(id),
    fired_at TEXT NOT NULL,
    trigger_chain_json TEXT NOT NULL,
    dismissed_at TEXT
);

CREATE TABLE alert_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kpi_id TEXT REFERENCES kpis(id),
    line_ref TEXT,
    threshold_operator TEXT NOT NULL CHECK(threshold_operator IN ('lt','lte','gt','gte','eq')),
    threshold_value TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
    active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE backups (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL CHECK(mode IN ('auto','manual')),
    path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    encrypted INTEGER NOT NULL DEFAULT 1,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL,
    retained_until TEXT
);

CREATE TABLE snapshots (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    reason TEXT NOT NULL,
    pre_mutation INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    restore_of_backup_id TEXT REFERENCES backups(id)
);

CREATE TABLE licenses (
    id TEXT PRIMARY KEY,
    license_key_id TEXT NOT NULL UNIQUE,
    licensed_company_hash TEXT NOT NULL,
    plan TEXT NOT NULL CHECK(plan IN ('pro','enterprise')),
    expires_at TEXT,
    machine_fingerprint TEXT,
    status TEXT NOT NULL CHECK(status IN ('active','grace','expired','invalid')),
    activated_at TEXT NOT NULL
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('app','company'))
);

CREATE TABLE pin_metadata (
    id TEXT PRIMARY KEY,
    argon2_params_json TEXT NOT NULL,
    recovery_phrase_hash TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT
);

CREATE TABLE planning_cycles (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    model_id TEXT NOT NULL REFERENCES models(id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('budget','forecast','rolling')),
    state TEXT NOT NULL CHECK(state IN ('draft','active','review','approved','closed')),
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    baseline_scenario_id TEXT REFERENCES scenarios(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(company_id,name)
);

CREATE TABLE cycle_tasks (
    id TEXT PRIMARY KEY,
    cycle_id TEXT NOT NULL REFERENCES planning_cycles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    owner TEXT NOT NULL,
    depends_on_id TEXT REFERENCES cycle_tasks(id),
    due_date TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending','done','blocked')),
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE collection_uploads (
    id TEXT PRIMARY KEY,
    cycle_id TEXT NOT NULL REFERENCES planning_cycles(id),
    contributor TEXT NOT NULL,
    exported_at TEXT NOT NULL,
    template_checksum TEXT NOT NULL,
    file_hash TEXT,
    imported_batch_id TEXT REFERENCES import_batches(id),
    status TEXT NOT NULL CHECK(status IN ('expected','filled','conflict','merged','rejected')),
    conflicts_json TEXT
);

CREATE TABLE reason_codes (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    code TEXT NOT NULL,
    label TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('volume','price','mix','fx','efficiency','one_time','seasonality','other')),
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(company_id,code)
);

CREATE TABLE annotations (
    id TEXT PRIMARY KEY,
    line_id TEXT NOT NULL REFERENCES model_lines(id),
    period_id TEXT NOT NULL REFERENCES fiscal_periods(id),
    scenario_id TEXT NOT NULL REFERENCES scenarios(id),
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE currency_scales (
    code TEXT PRIMARY KEY,
    scale INTEGER NOT NULL CHECK(scale BETWEEN 0 AND 4),
    symbol TEXT NOT NULL,
    thousand_sep TEXT NOT NULL,
    decimal_sep TEXT NOT NULL,
    is_fiat INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE license_requests (
    id TEXT PRIMARY KEY,
    company_hash TEXT NOT NULL,
    machine_fingerprint TEXT,
    plan_requested TEXT NOT NULL CHECK(plan_requested IN ('pro','enterprise')),
    status TEXT NOT NULL CHECK(status IN ('pending','applied','expired','rejected')),
    response_file_path TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX ix_gl_period_account ON gl_lines(company_id, period_id, account_id);
CREATE INDEX ix_gl_batch ON gl_lines(batch_id);
CREATE INDEX ix_gl_dims ON gl_lines(company_id, dims_json);
CREATE INDEX ix_mv_lookup ON model_values(line_id, scenario_id, period_id);
CREATE INDEX ix_dv_lookup ON driver_values(driver_id, scenario_id, period_id);
CREATE INDEX ix_audit_company ON audit_events(company_id, seq DESC);
CREATE INDEX ix_fp_year ON fiscal_periods(fiscal_year_id, period_no);
CREATE INDEX ix_import_company ON import_batches(company_id, created_at DESC);
CREATE INDEX ix_ic_bu ON ic_lines(source_bu_id, counterparty_bu_id);
CREATE INDEX ix_conn_runs ON connector_sync_runs(connector_id, started_at DESC);


-- currency_scales seed (read-only, part of Core install)
INSERT INTO currency_scales (code, scale, symbol, thousand_sep, decimal_sep, is_fiat) VALUES
 ('USD',2,'$',',','.',1),('EUR',2,'€',',','.',1),('GBP',2,'£',',','.',1),('INR',2,'₹',',','.',1),
 ('JPY',0,'¥',',','.',1),('KRW',0,'₩',',','.',1),('KWD',3,'د.ك',',','.',1),('BHD',3,'.د.ب',',','.',1),
 ('CHF',2,'CHF','’','.',1),('AED',2,'د.إ',',','.',1);
