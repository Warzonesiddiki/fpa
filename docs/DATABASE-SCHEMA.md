# DATABASE-SCHEMA.md

> OneFP&A · v1.0.0 · **SQLite (WAL, foreign_keys=ON, `journal_mode=WAL`, `synchronous=NORMAL`).**
> Money = `INTEGER` minor units (currency-scaled) or `TEXT` decimal — **never REAL** (I1).
> IDs = `TEXT` UUID v4. All tables have `created_at`, most `updated_at` (`TEXT ISO-8601 UTC`).
> Migrations: `src-tauri/migrations/001_initial.sql …` — versioned, forward-tested, rollback-tested.
> One example row per table (SQL INSERT). Indexes named `ix_*`. FKs named `fk_*`.

---

## 1. STRUCTURE & TENANCY

### `companies`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK (uuid) |
| name | TEXT | NOT NULL, UNIQUE per install |
| type | TEXT | NOT NULL CHECK (`'single'`,`'group'`) |
| default_currency_code | TEXT | NOT NULL (ISO 4217, e.g. `'USD'`) |
| base_locale | TEXT | NOT NULL DEFAULT `'en-IN'` |
| pack_schema_version | TEXT | NOT NULL |
| company_file_path | TEXT | NOT NULL, UNIQUE |
| created_at / updated_at | TEXT | NOT NULL |

```sql
INSERT INTO companies VALUES ('c-01','Holding Group','group','USD','en-IN','1.0.0','/home/priya/Holding Group.fpa','2026-08-30T00:00:00Z','2026-08-30T00:00:00Z');
```

### `business_units`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| company_id | TEXT | NOT NULL, FK→companies ON DELETE CASCADE |
| name | TEXT | NOT NULL, UNIQUE(company_id,name) |
| parent_bu_id | TEXT | NULL, FK→business_units (BU trees) |
| pack_id | TEXT | NOT NULL, FK→packs |
| calendar_id | TEXT | NOT NULL, FK→fiscal_calendars |
| reporting_currency_code | TEXT | NOT NULL |
| is_consolidated | INTEGER | NOT NULL DEFAULT 1 CHECK (0,1) |
| ownership_pct | NUMERIC(9,6) | NULL (NULL = 100%) — `bu_ownership` for changes |
| sort_order | INTEGER | NOT NULL DEFAULT 0 |

```sql
INSERT INTO business_units VALUES ('bu-retail','c-01','Retail Chain',NULL,'pack-retail','cal-454-2027','GBP',1,NULL,2);
```

### `bu_ownership`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| bu_id | TEXT | NOT NULL FK→business_units |
| effective_from / effective_to | TEXT | NOT NULL / NULL |
| ownership_pct | NUMERIC(9,6) | NOT NULL CHECK (0<pct<=100) |
| note | TEXT | NULL |

```sql
INSERT INTO bu_ownership VALUES ('bo-1','bu-retail','2026-01-01',NULL,80.0,'Bought 20% stake 2026');
```

## 2. PACKS & CATALOG

### `packs`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| key | TEXT | NOT NULL UNIQUE (`saas`,`manufacturing`…) |
| name | TEXT | NOT NULL |
| version | TEXT | NOT NULL (semver) |
| schema_version | TEXT | NOT NULL (`pack.schema.json` rev) |
| is_bundled | INTEGER | NOT NULL DEFAULT 1 |
| source_checksum | TEXT | NOT NULL (sha256 of pack archive) |
| installed_at | TEXT | NOT NULL |

```sql
INSERT INTO packs VALUES ('pack-saas','saas','SaaS / Tech','2.1.0','1.0.0',1,'ab12…ef','2026-08-30T00:00:00Z');
```

### `pack_components` (COA/KPI/Driver/Report seeds)
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| pack_id | TEXT | NOT NULL FK→packs ON DELETE CASCADE |
| kind | TEXT | NOT NULL CHECK (`'coa'`,`'kpi'`,`'driver_template'`,`'report_layout'`,`'calendar_preset'`,`'gl_template'`) |
| ref_key | TEXT | NOT NULL |
| payload | TEXT | NOT NULL (JSON; schema-validated at load) |

```sql
INSERT INTO pack_components VALUES ('pc-1','pack-saas','kpi','kpi.nrr','{"name":"NRR","formula":"…","unit":"%"}');
```

## 3. ACCOUNTS & DIMENSIONS

### `accounts`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| company_id | TEXT | NOT NULL FK→companies |
| bu_id | TEXT | NULL FK→business_units (NULL = shared) |
| code | TEXT | NOT NULL (normalized, leading-zero kept) |
| name | TEXT | NOT NULL |
| account_type | TEXT | NOT NULL CHECK (`'revenue'`,`'cogs'`,`'opex'`,`'asset'`,`'liability'`,`'equity'`) |
| report_section | TEXT | NOT NULL (see GLOSSARY Report Section) |
| parent_id | TEXT | NULL FK→accounts |
| is_control | INTEGER | NOT NULL DEFAULT 0 |
| version | INTEGER | NOT NULL DEFAULT 1 |
| active | INTEGER | NOT NULL DEFAULT 1 |
| UNIQUE | | (company_id, bu_id, code, version) |

```sql
INSERT INTO accounts VALUES ('a-4100','c-01','bu-manu','410000','Raw Materials — Steel','cogs','COGS',NULL,0,1,1);
```

### `dimensions`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| company_id | TEXT | NOT NULL FK |
| key | TEXT | NOT NULL (`cost_center`,`project`,`product`,`customer`,`channel`,`fund`,`program`,`custom_*`) |
| name | TEXT | NOT NULL |
| is_tree | INTEGER | NOT NULL DEFAULT 0 |

```sql
INSERT INTO dimensions VALUES ('d-cc','c-01','cost_center','Cost Center',1);
```

### `dimension_values`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| dimension_id | TEXT | NOT NULL FK |
| parent_id | TEXT | NULL FK→dimension_values |
| code | TEXT | NOT NULL |
| name | TEXT | NOT NULL |
| active | INTEGER | NOT NULL DEFAULT 1 |
| UNIQUE | | (dimension_id, code) |

```sql
INSERT INTO dimension_values VALUES ('dv-north','d-cc',NULL,'N','Sales – North',1);
```

### `account_dimension_map` (which dimensions apply per account; also used for import defaults)
| Column | Type | Constraints |
|---|---|---|
| account_id | TEXT | NOT NULL FK |
| dimension_id | TEXT | NOT NULL FK |
| required | INTEGER | NOT NULL DEFAULT 0 |
| PK | | (account_id, dimension_id) |

```sql
INSERT INTO account_dimension_map VALUES ('a-4100','d-cc',1);
```

## 4. TIME (Fiscal Calendar — single owner)

### `fiscal_calendars`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| company_id | TEXT | NOT NULL FK |
| name | TEXT | NOT NULL |
| preset | TEXT | NOT NULL CHECK (`'12month'`,`'454'`,`'445'`,`'544'`,`'3334'`) |
| fy_start_month | INTEGER | NOT NULL (1–12; NULL for week-based: use anchor rule) |
| week_start_day | INTEGER | NOT NULL (0=Sun…6=Sat) |
| anchor_rule | TEXT | NULL CHECK (`'sunday_near_feb_1'`,`'nearest_weekday'`,`'first_day'`) for week-presets |
| year_end_rule | TEXT | NULL CHECK (`'nrf_4_day'`,`'full_week'`) |
| tz | TEXT | NOT NULL DEFAULT `'UTC'` |
| UNIQUE | | (company_id, name) |

```sql
INSERT INTO fiscal_calendars VALUES ('cal-454','c-01','Retail NRF','454',NULL,0,'sunday_near_feb_1','nrf_4_day','UTC');
```

### `fiscal_years`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| calendar_id | TEXT | NOT NULL FK |
| fy_label | TEXT | NOT NULL (`'FY2027'`) |
| start_date / end_date | TEXT | NOT NULL (ISO date) |
| week_count | INTEGER | NOT NULL CHECK (52,53) |
| is_leap_fiscal | INTEGER | NOT NULL DEFAULT 0 |
| UNIQUE | | (calendar_id, fy_label) |

```sql
INSERT INTO fiscal_years VALUES ('fy-2027','cal-454','FY2027','2026-02-01','2027-01-30',52,0);
```

### `fiscal_periods`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| fiscal_year_id | TEXT | NOT NULL FK |
| period_no | INTEGER | NOT NULL (1–13) |
| code | TEXT | NOT NULL (`'P01'`; `'W53'` for extra) |
| start_date / end_date | TEXT | NOT NULL |
| is_53rd_week | INTEGER | NOT NULL DEFAULT 0 |
| UNIQUE | | (fiscal_year_id, period_no) |

```sql
INSERT INTO fiscal_periods VALUES ('fp-2027-p08','fy-2027',8,'P08','2026-09-06','2026-10-03',0);
```

### `bu_calendar_map` (mixed calendars; Transit Period mapping)
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| company_id | TEXT | NOT NULL FK |
| bu_id | TEXT | NOT NULL FK |
| group_period_id | TEXT | NOT NULL FK→fiscal_periods |
| bu_period_id | TEXT | NOT NULL FK→fiscal_periods |
| mapping | TEXT | NOT NULL CHECK (`'exact'`,`'transit_start`?`–`transit_end'`) — stored as `'exact'` or `'partial'` |
| share_pct | NUMERIC(9,6) | NULL (for partial; e.g. 45.2) |

```sql
INSERT INTO bu_calendar_map VALUES ('bcm-1','c-01','bu-retail','fp-2027-p05','fp-retail-p06','partial',45.2);
```

## 5. MODELS & VALUES

### `models`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| company_id | TEXT | NOT NULL FK |
| name | TEXT | NOT NULL |
| horizon | TEXT | NOT NULL CHECK (`'13w'`,`'1y'`,`'3y'`,`'5y'`) |
| status | TEXT | NOT NULL DEFAULT `'active'` |
| current_scenario_id | TEXT | NULL FK→scenarios |
| last_recalculated_at | TEXT | NULL |
| pack_id | TEXT | NOT NULL FK→packs |

```sql
INSERT INTO models VALUES ('m-main','c-01','FY26 Model','1y','active','sc-base','2026-08-30T00:00:00Z','pack-manufacturing');
```

### `model_sheets`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| model_id | TEXT | NOT NULL FK |
| name | TEXT | NOT NULL (`'Revenue'`) |
| sheet_type | TEXT | NOT NULL CHECK (`'input'`,`'formula'`,`'driver'`,`'assumption'`,`'schedule'`,`'statement'`) |
| sort_order | INTEGER | NOT NULL |
| UNIQUE | | (model_id, name) |

```sql
INSERT INTO model_sheets VALUES ('sh-rev','m-main','Revenue','formula',1);
```

### `model_lines` (rows of a Sheet — the semantic grid)
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| sheet_id | TEXT | NOT NULL FK |
| account_id | TEXT | NULL FK (linked line) |
| driver_id | TEXT | NULL FK (linked driver) |
| method | TEXT | NOT NULL CHECK (`'manual'`,`'static'`,`'driver'`,`'growth'`,`'yoy'`,`'seasonal'`,`'spread'`) |
| format | TEXT | NOT NULL CHECK (`'money'`,`'percent'`,`'number'`,`'date'`) |
| decimals | INTEGER | NOT NULL DEFAULT 2 |
| is_parent | INTEGER | NOT NULL DEFAULT 0 (subtotal row) |
| sort_order | INTEGER | NOT NULL |

```sql
INSERT INTO model_lines VALUES ('ln-rev','sh-rev','a-4000',NULL,'driver','money',2,0,10);
```

### `model_values` (one value per line × scenario × period — engine writes; big table)
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| line_id | TEXT | NOT NULL FK→model_lines |
| scenario_id | TEXT | NOT NULL FK→scenarios |
| period_id | TEXT | NOT NULL FK→fiscal_periods |
| amount_minor | INTEGER | NULL (money lines; currency-scaled) |
| amount_text | TEXT | NULL (decimal string source; non-money values) |
| formula | TEXT | NULL (HyperFormula expression; authored only) |
| computed | INTEGER | NOT NULL DEFAULT 1 CHECK (0,1) (0 = manual override pins value) |
| source_version_id | TEXT | NULL FK→scenario_versions |
| UNIQUE | | (line_id, scenario_id, period_id) |

```sql
INSERT INTO model_values VALUES ('mv-1','ln-rev','sc-base','fp-2027-p08',182500000,NULL,NULL,1,NULL);
```

### `scenarios`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| model_id | TEXT | NOT NULL FK |
| name | TEXT | NOT NULL |
| kind | TEXT | NOT NULL CHECK (`'actuals'`,`'budget'`,`'forecast'`,`'whatif'`,`'lrp'`) |
| state | TEXT | NOT NULL CHECK (`'draft'`,`'review'`,`'approved'`,`'locked'`) |
| parent_scenario_id | TEXT | NULL FK |
| baseline | INTEGER | NOT NULL DEFAULT 0 |
| UNIQUE | | (model_id, name) |

```sql
INSERT INTO scenarios VALUES ('sc-base','m-main','Base','budget','locked',NULL,1);
```

### `scenario_versions`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| scenario_id | TEXT | NOT NULL FK |
| version_no | INTEGER | NOT NULL (monotonic per scenario) |
| label | TEXT | NOT NULL (`'v2'`) |
| reason | TEXT | NOT NULL (lock/export/import reason) |
| created_at | TEXT | NOT NULL |
| UNIQUE | | (scenario_id, version_no) |

```sql
INSERT INTO scenario_versions VALUES ('sv-2','sc-base',2,'v2','Approved for FY26 baseline','2026-08-30T00:00:00Z');
```

## 6. DRIVERS & ASSUMPTIONS

### `drivers`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| model_id | TEXT | NOT NULL FK |
| name | TEXT | NOT NULL (`'units'`) |
| driver_type | TEXT | NOT NULL CHECK (`'volume_x_rate'`,`'headcount'`,`'growth'`,`'seasonal'`,`'spread'`,`'ratio'`,`'manual'`) |
| unit | TEXT | NULL (`'units'`) |
| source | TEXT | NOT NULL CHECK (`'global'`,`'bu_override'`,`'collection'`,`'imported'`) |
| is_core | INTEGER | NOT NULL DEFAULT 0 |
| bounds_low / bounds_high | TEXT | NULL (decimal) |

```sql
INSERT INTO drivers VALUES ('dr-units','m-main','units','volume_x_rate','units','imported',1,'0','100000');
```

### `driver_values`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| driver_id | TEXT | NOT NULL FK |
| scenario_id | TEXT | NOT NULL FK |
| period_id | TEXT | NOT NULL FK |
| value_decimal | TEXT | NOT NULL |
| source_batch_id | TEXT | NULL FK→import_batches |
| UNIQUE | | (driver_id, scenario_id, period_id) |

```sql
INSERT INTO driver_values VALUES ('dv-1','dr-units','sc-base','fp-2027-p08','12000',NULL);
```

### `assumptions` / `assumption_values`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| model_id | TEXT | NOT NULL FK |
| name | TEXT | NOT NULL UNIQUE(model_id) (`'wage_inflation'`) |
| unit | TEXT | NULL (`'%'`) |
| owner | TEXT | NOT NULL |
| source | TEXT | NULL (`'HR'`) |
| bounds_low / bounds_high | TEXT | NULL |
| effective_from / effective_to | TEXT | NULL |
| values | (assumption_values: assumption_id, period_id, value_decimal) | UNIQUE(assumption_id, period_id) |

```sql
INSERT INTO assumptions VALUES ('as-wage','m-main','wage_inflation','%','HR','HR',NULL,NULL,NULL,NULL);
INSERT INTO assumption_values VALUES ('av-1','as-wage','fp-2027-p08','4.0');
```

## 7. INGESTION

### `import_batches`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| company_id | TEXT | NOT NULL FK |
| kind | TEXT | NOT NULL CHECK (`'gl_dump'`,`'excel_csv'`,`'driver_data'`,`'opening_balances'`,`'dimension_master'`,`'connector_sync'`,`'collection'`) |
| source_name | TEXT | NOT NULL (`'SAP_GL_Aug2026.xlsx'`) |
| source_hash | TEXT | NOT NULL (sha256) |
| mapping_version | TEXT | NOT NULL |
| status | TEXT | NOT NULL CHECK (`'validated'`,`'committed'`,`'rolled_back'`,`'failed'`) |
| row_count | INTEGER | NOT NULL |
| debits_minor / credits_minor | INTEGER | NULL (tie-out) |
| tie_out_status | TEXT | NOT NULL CHECK (`'pass'`,`'fail'`,`'excluded_rows_logged'`) |
| rollback_to_batch_id | TEXT | NULL FK |
| committed_at | TEXT | NULL |
| created_at | TEXT | NOT NULL |

```sql
INSERT INTO import_batches VALUES ('ib-1','c-01','gl_dump','SAP_GL_Aug2026.xlsx','aa11…ff','v3','committed',47999,4128300000,4128300005,'excluded_rows_logged',NULL,'2026-08-30T00:00:00Z','2026-08-30T00:00:00Z');
```

### `mapping_templates` / `mapping_columns`
| Column | Type | Constraints |
|---|---|---|
| templates.id | TEXT | PK |
| templates.name | TEXT | NOT NULL (`'SAP GL dump'`) UNIQUE(company_id,name) |
| templates.version | TEXT | NOT NULL (`'v3'`) |
| templates.checksum | TEXT | NOT NULL |
| columns | (mapping_columns: template_id, source_pattern, semantic_target) | UNIQUE(template_id, source_pattern) |

```sql
INSERT INTO mapping_templates VALUES ('mt-1','c-01','SAP GL dump','v3','cc22…');
INSERT INTO mapping_columns VALUES ('mc-1','mt-1','BKPF-KUNNR','account');
```

### `source_files` (Source File Vault)
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| batch_id | TEXT | NOT NULL FK→import_batches |
| original_name | TEXT | NOT NULL |
| stored_path | TEXT | NOT NULL (inside Company File) |
| size_bytes | INTEGER | NOT NULL |
| sha256 | TEXT | NOT NULL |
| retained_until | TEXT | NULL |

```sql
INSERT INTO source_files VALUES ('sf-1','ib-1','SAP_GL_Aug2026.xlsx','vault/ib-1.bin',4821136,'aa11…ff',NULL);
```

### `gl_lines` (Actuals — largest table; 2M target/Company)
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| company_id | TEXT | NOT NULL FK |
| batch_id | TEXT | NOT NULL FK→import_batches |
| bu_id | TEXT | NULL FK |
| period_id | TEXT | NOT NULL FK |
| account_id | TEXT | NOT NULL FK |
| dims_json | TEXT | NOT NULL (JSON: dimension_id→value_id; NULL-safe) |
| amount_minor | INTEGER | NOT NULL (signed; credit-negative convention) |
| currency_code | TEXT | NOT NULL |
| debit_minor / credit_minor | INTEGER | NULL (if source had both) |
| posting_ref | TEXT | NULL |
| doc_type | TEXT | NULL |
| is_ic | INTEGER | NOT NULL DEFAULT 0 |
| is_excluded | INTEGER | NOT NULL DEFAULT 0 (logged exclusions) |
| line_no | INTEGER | NOT NULL (source row) |
| UNIQUE | | (batch_id, line_no) |

```sql
INSERT INTO gl_lines VALUES ('gl-1','c-01','ib-1','bu-manu','fp-2027-p08','a-4100','{"d-cc":"dv-north"}',182500,NULL,'INV-2001','',0,0,1);
```

### `ic_lines`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| gl_line_id | TEXT | NOT NULL FK→gl_lines |
| source_bu_id | TEXT | NOT NULL FK |
| counterparty_bu_id | TEXT | NOT NULL FK |
| ic_amount_minor | INTEGER | NOT NULL |
| matched_line_id | TEXT | NULL (join to counterpart) |

```sql
INSERT INTO ic_lines VALUES ('ic-1','gl-1','bu-manu','bu-retail',-2500000,NULL);
```

### `connectors` / `connector_sync_runs` / `connector_credentials` (metadata only — secrets in OS keychain)
| Column | Type | Constraints |
|---|---|---|
| connectors.id/key | TEXT | PK / UNIQUE (`quickbooks_online`) |
| connectors.display_name | TEXT | NOT NULL |
| connectors.oauth_kind | TEXT | NOT NULL CHECK (`'oauth2'`,`'oauth1'`) |
| connectors.state | TEXT | NOT NULL CHECK (`'disconnected'`,`'connected'`,`'error'`) |
| credentials.id | TEXT | PK; connector_id FK; keychain_service, keychain_account TEXT; token_metadata_json TEXT (no secrets) |
| sync_runs.id/connector_id/started_at/finished_at/rows_pulled/batch_id/status | TEXT/INTEGER | status CHECK (`'running'`,`'success'`,`'failed'`,`'rate_limited'`,`'paused'`) |

```sql
INSERT INTO connectors VALUES ('conn-qbo','quickbooks_online','QuickBooks Online','oauth2','connected');
INSERT INTO connector_credentials VALUES ('cc-1','conn-qbo','com.onefpa.conn','quickbooks_online','{"client_id":"**","realm_id":"123"}');
INSERT INTO connector_sync_runs VALUES ('csr-1','conn-qbo','2026-08-30T00:00:00Z','2026-08-30T00:05:00Z',4821,'ib-1','success');
```

## 8. CONSOLIDATION & REPORTING

### `fx_rates`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| company_id | TEXT | NOT NULL FK |
| from_code / to_code | TEXT | NOT NULL |
| period_id | TEXT | NOT NULL FK |
| rate_type | TEXT | NOT NULL CHECK (`'average'`,`'closing'`,`'historical'`) |
| rate_decimal | TEXT | NOT NULL (exact) |
| UNIQUE | | (from_code, to_code, period_id, rate_type) |

```sql
INSERT INTO fx_rates VALUES ('fx-1','c-01','EUR','USD','fp-2027-p08','average','1.0842');
```

### `group_rollup_maps`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| company_id | TEXT | NOT NULL FK |
| bu_id | TEXT | NOT NULL FK |
| source_account_id | TEXT | NOT NULL FK |
| group_account_id | TEXT | NOT NULL FK |
| weight_pct | NUMERIC(9,6) | NOT NULL DEFAULT 100 |

```sql
INSERT INTO group_rollup_maps VALUES ('grm-1','c-01','bu-manu','a-4100','g-5000',100);
```

### `kpis` / `report_layouts` / `layout_columns` / `board_packs`
| Column | Type | Constraints |
|---|---|---|
| kpis.id/name/formula/unit/target_owner/definition_text | TEXT | formula validated against cells; UNIQUE(company_id,name) |
| report_layouts.id/name/kind/config_json | TEXT | config = rows/cols/filters (JSON schema-validated); UNIQUE(company_id,name) |
| layout_columns: layout_id, col_type (`period`,`ytd`,`fy`,`variance`,`threeway`,`custom`), period_ref, sort_order | TEXT/INT | UNIQUE(layout_id, sort_order) |
| board_packs.id/name/template_json/last_generated_at | TEXT | — |

```sql
INSERT INTO kpis VALUES ('kpi-gm','c-01','Gross Margin %','gm_pct','%',38.0,'User','GrossProfit/Revenue',NULL);
```

## 9. GOVERNANCE

### `audit_events`
| Column | Type | Constraints |
|---|---|---|
| seq | INTEGER | PK AUTOINCREMENT |
| company_id | TEXT | NOT NULL FK |
| actor | TEXT | NOT NULL (`'owner'`,`'system'`) |
| action | TEXT | NOT NULL (`'model.cell.set'`,`'import.commit'`,…) |
| object_type / object_id | TEXT | NOT NULL |
| before_json / after_json | TEXT | NULL (no secrets ever) |
| prev_hash | TEXT | NOT NULL |
| hash | TEXT | NOT NULL (HMAC-SHA256; key in Rust, never in DB) |
| created_at | TEXT | NOT NULL |

```sql
INSERT INTO audit_events (seq,company_id,actor,action,object_type,object_id,before_json,after_json,prev_hash,hash,created_at)
VALUES (1,'c-01','owner','model.cell.set','model_value','mv-1','{"amount":180000000}','{"amount":182500000}','genesis','f0e1…','2026-08-30T00:00:00Z');
```

### `health_checks` / `health_findings` / `waivers`
| Column | Type | Constraints |
|---|---|---|
| health_checks.id/model_id/run_at/status | TEXT | status CHECK (`'running'`,`'passed'`,`'failed'`) |
| findings: id/check_id/category (`tie_out`,`reference`,`rounding`,`driver_feed`,`anomaly`), severity (`hard`,`warn`), message, entity_ref | TEXT | — |
| waivers: id/finding_id/reason/created_at/actor | TEXT | reason NOT NULL (never empty) |

```sql
INSERT INTO health_checks VALUES ('hc-1','m-main','2026-08-30T00:00:00Z','failed');
INSERT INTO health_findings VALUES ('hf-1','hc-1','tie_out','hard','BS does not tie by ₹0.05','bs-cash');
```

### `alerts` / `alert_rules`
| Column | Type | Constraints |
|---|---|---|
| alert_rules.id/name/kpi_id|line_ref/threshold_operator/threshold_value/severity/active | TEXT/INT | — |
| alerts.id/rule_id/fired_at/trigger_chain_json/dismissed_at | TEXT | — |

```sql
INSERT INTO alert_rules VALUES ('ar-1','Cash floor','line_ref','lt',2500000000,'warning',1);
INSERT INTO alerts VALUES ('al-1','ar-1','2026-08-30T00:00:00Z','{"driver":"cash_draw","line":"Cash","value":2400000000}',NULL);
```

### `backups` / `snapshots`
| Column | Type | Constraints |
|---|---|---|
| backups.id/mode (`auto`,`manual`), path, size_bytes, encrypted (1), sha256, created_at, retained_until | TEXT/INT | — |
| snapshots.id/company_id/reason/pre_mutation, created_at, restore_of_backup_id NULL | TEXT | — |

```sql
INSERT INTO backups VALUES ('bk-1','auto','/backups/Holding Group.2026-08-30.fpa-bak',10485760,1,'bb99…','2026-08-30T00:00:00Z','2026-09-29T00:00:00Z');
```

### `licenses`
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| license_key_id | TEXT | NOT NULL UNIQUE |
| licensed_company_hash | TEXT | NOT NULL |
| plan | TEXT | NOT NULL CHECK (`'pro'`,`'enterprise'`) |
| expires_at | TEXT | NULL (NULL = perpetual) |
| machine_fingerprint | TEXT | NULL |
| status | TEXT | NOT NULL CHECK (`'active'`,`'grace'`,`'expired'`,`'invalid'`) |
| activated_at | TEXT | NOT NULL |

```sql
INSERT INTO licenses VALUES ('li-1','LK-2026-0001','ab12…','enterprise',NULL,NULL,'active','2026-08-30T00:00:00Z');
```

### `settings`
| Column | Type | Constraints |
|---|---|---|
| key | TEXT | PK |
| value_json | TEXT | NOT NULL |
| scope | TEXT | NOT NULL CHECK (`'app'`,`'company'`) |

```sql
INSERT INTO settings VALUES ('format.negative','{"style":"parentheses","locale":"en-IN"}','app');
```

### `pin_metadata` (never the PIN; only verification params)
| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| argon2_params_json | TEXT | NOT NULL (salt, m_cost, t_cost, p_cost, hash) |
| recovery_phrase_hash | TEXT | NOT NULL (argon2id of normalized phrase) |
| failed_attempts | INTEGER | NOT NULL DEFAULT 0 |
| locked_until | TEXT | NULL |

```sql
INSERT INTO pin_metadata VALUES ('pm-1','{"salt":"…","m":19456,"t":2,"p":1,"hash":"…"}','…',0,NULL);
```

---

## 10. INDEXES (exact)

```sql
CREATE INDEX ix_gl_period_account ON gl_lines(company_id, period_id, account_id);
CREATE INDEX ix_gl_batch ON gl_lines(batch_id);
CREATE INDEX ix_gl_dims ON gl_lines(company_id, dims_json);        -- JSON1 for dim queries
CREATE INDEX ix_mv_lookup ON model_values(line_id, scenario_id, period_id);
CREATE INDEX ix_dv_lookup ON driver_values(driver_id, scenario_id, period_id);
CREATE INDEX ix_audit_company ON audit_events(company_id, seq DESC);
CREATE INDEX ix_fp_year ON fiscal_periods(fiscal_year_id, period_no);
CREATE INDEX ix_import_company ON import_batches(company_id, created_at DESC);
CREATE INDEX ix_ic_bu ON ic_lines(source_bu_id, counterparty_bu_id);
CREATE INDEX ix_conn_runs ON connector_sync_runs(connector_id, started_at DESC);
```

## 11. INTEGRITY & MIGRATION RULES

1. `PRAGMA foreign_keys=ON` at every connection; `PRAGMA integrity_check` on open (fail → recovery flow, never silent).
2. Amount columns are INTEGER minor units; decimal strings only where a rate/percent (never money).
3. Migrations are additive; destructive changes require a migration-test + Snapshot policy.
4. No triggers for money math — engines own computation; DB stores facts (B14).
5. Full schema equality check in CI between code and migrations (`scripts/schema-equality-check.mjs`).

*Referenced by: API-SPEC.md, STATE-MANAGEMENT.md, FEATURE-TRACEABILITY-MATRIX.md.*
