//! `import.parse` / `import.validate` / `import.tieout` / `import.commit` / `import.rollback`
//! — the GL-Dump-first ingestion pipeline (B19 · PRD F-007/F-010 · GL-TEMPLATE-SPEC ·
//! DATABASE-SCHEMA §7).
//!
//! Rules this file must never break:
//!  * **No floats in money.** Every amount is read as text and converted exactly once, at the
//!    parse boundary, into `rust_decimal` → i64 minor units through `core::money` (B3/B18-2).
//!  * **A parse is a working set, not a stored object.** Rows live in memory under a `parse_id`
//!    until `import.commit` persists them; after the TTL the rows are gone and
//!    `IMPORT_PARSE_EXPIRED` (410, retryable) tells the UI to re-parse.
//!  * **Tie-Out is a gate, never a warning**: Σdebits = Σcredits over the rows that will be
//!    committed; exclude-with-log is allowed and logged, silent adjustment never
//!    (GL-TEMPLATE-SPEC §3).
//!  * **Every session-Company mutation** goes through `session::require_session_write`
//!    (AUTH-SPEC §2.5/§3) and appends an HMAC-chained audit event (B18-1).
//!  * **No network, no connector**: Manual Import works with zero connectors (B19).
//!  * **Attribution honesty**: a tie-out difference is only ever attributed to rows that carry
//!    a posting reference; without one the totals are reported and nothing is guessed.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use calamine::{open_workbook_auto, Data, Reader};
use chrono::NaiveDate;
use rusqlite::{Connection, OptionalExtension};
use rust_decimal::Decimal;
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::State;
use uuid::Uuid;

use crate::commands::company::{app_data_dir, audited_hash};
use crate::commands::session::{require_session_write, require_unlocked, SessionState};
use crate::core::audit::next_hash;
use crate::core::error::{AppError, AppResult};
use crate::core::money::{scale_for_currency, MoneyValue};
use crate::storage::db;
use crate::storage::keystore;

/// A parse is a working set: rows are held in memory until `import.commit` (or until this
/// window elapses → `IMPORT_PARSE_EXPIRED`, 410 retryable — ERROR-HANDLING §C).
pub const PARSE_TTL_MS: i64 = 30 * 60 * 1000;

/// Rows the preview table shows (SCREENS-SPEC S-031: "preview table (first 50 rows)").
const PREVIEW_ROWS: usize = 50;

/// OLE2 (Compound File) magic — an `.xlsx` that is really an OLE2 container is an ECMA-376
/// encrypted workbook; Excel writes exactly this for password-protected files.
const OLE2_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

/// Semantic targets of the Canonical GL Template (GL-TEMPLATE-SPEC §2, columns 1–15).
const CANONICAL_TARGETS: [&str; 15] = [
    "period",
    "account_code",
    "account_name",
    "debit",
    "credit",
    "amount",
    "cost_center",
    "project",
    "product",
    "customer",
    "business_unit",
    "intercompany_tag",
    "currency",
    "posting_ref",
    "doc_type",
];

/// The pre-installed "OneFP&A Canonical GL" mapping (GL-TEMPLATE-SPEC §7): a file that already
/// follows the template needs zero mapping steps — its headers ARE the semantic targets.
pub const CANONICAL_MAPPING_ID: &str = "canonical";

/* ── Parse sessions ──────────────────────────────────────────────── */

/// `import_batches.kind` (DATABASE-SCHEMA §7 CHECK) restricted to file-borne kinds;
/// `connector_sync` and `collection` arrive from their own flows (M2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportKind {
    GlDump,
    ExcelCsv,
    DriverData,
    OpeningBalances,
    DimensionMaster,
}

impl ImportKind {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "gl_dump" => Some(ImportKind::GlDump),
            "excel_csv" => Some(ImportKind::ExcelCsv),
            "driver_data" => Some(ImportKind::DriverData),
            "opening_balances" => Some(ImportKind::OpeningBalances),
            "dimension_master" => Some(ImportKind::DimensionMaster),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            ImportKind::GlDump => "gl_dump",
            ImportKind::ExcelCsv => "excel_csv",
            ImportKind::DriverData => "driver_data",
            ImportKind::OpeningBalances => "opening_balances",
            ImportKind::DimensionMaster => "dimension_master",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ParseSheet {
    pub name: String,
    pub kind: String,
    pub row_count: i64,
}

#[derive(Debug, Clone)]
pub struct ParseEncoding {
    pub scope: String,
    pub encoding: String,
    pub bom: bool,
    pub auto_detected: bool,
}

/// One normalised source row — the canonical GL columns as text (GL-TEMPLATE-SPEC §2). Money
/// stays text until validation converts it exactly once (no float anywhere, B3).
#[derive(Debug, Clone)]
pub struct SourceRow {
    /// Physical row number in the source file (header = row 1) so per-row errors can be opened
    /// in Excel (GL-TEMPLATE-SPEC §6 "HARD row error with exact source row").
    pub line_no: i64,
    pub period: String,
    pub account_code: String,
    pub account_name: String,
    pub debit: Option<String>,
    pub credit: Option<String>,
    pub amount: Option<String>,
    pub cost_center: Option<String>,
    pub project: Option<String>,
    pub product: Option<String>,
    pub customer: Option<String>,
    pub business_unit: Option<String>,
    pub intercompany_tag: Option<String>,
    pub currency: Option<String>,
    pub posting_ref: Option<String>,
    pub doc_type: Option<String>,
}

/// A parsed file held in memory between `import.parse` and `import.commit`.
#[derive(Debug)]
pub struct ParseSession {
    pub parse_id: String,
    /// The Company that was unlocked when the file was parsed — a parse never crosses Companies.
    pub company_id: String,
    pub kind: ImportKind,
    pub source_name: String,
    pub source_hash: String,
    pub size_bytes: i64,
    pub sheets: Vec<ParseSheet>,
    pub encodings: Vec<ParseEncoding>,
    pub headers: Vec<String>,
    /// The whole grid including the header row — re-mapped per `mapping_id`, so the user can
    /// change the mapping without re-reading the file (streaming persistence is M2-2).
    pub grid: Vec<Vec<String>>,
    pub created_ms: i64,
}

/// In-memory parse store (never persisted, never leaves the process).
#[derive(Default)]
pub struct ParseRegistry(Mutex<HashMap<String, Arc<ParseSession>>>);

impl ParseRegistry {
    /// Store a parse, dropping anything past the TTL, and return its id.
    fn put(&self, session: ParseSession) -> String {
        // A poisoned mutex holds no money and no key: recovering with the data intact is safer
        // than panicking the ingest mid-file (unhandled panic → INTERNAL, ERROR-HANDLING §1).
        let mut guard = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let now = now_ms();
        guard.retain(|_, s| now - s.created_ms < PARSE_TTL_MS);
        let parse_id = session.parse_id.clone();
        guard.insert(parse_id.clone(), Arc::new(session));
        parse_id
    }

    fn get(&self, parse_id: &str) -> AppResult<Arc<ParseSession>> {
        let mut guard = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let found = guard.get(parse_id).cloned();
        match found {
            Some(s) if now_ms() - s.created_ms < PARSE_TTL_MS => Ok(s),
            Some(_) => {
                guard.remove(parse_id);
                Err(AppError::import_parse_expired(parse_id))
            }
            None => Err(AppError::import_parse_expired(parse_id)),
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/* ── Mapping ─────────────────────────────────────────────────────── */

#[derive(Debug, Clone)]
struct Mapping {
    id: String,
    version: String,
    /// Source header (trimmed, lower-cased) → semantic target.
    columns: HashMap<String, String>,
    /// Signed-amount sources that store credits positive. An explicit mapping toggle only —
    /// the parser never auto-detects a sign convention (GL-TEMPLATE-SPEC §3).
    credit_positive: bool,
}

fn canonical_mapping() -> Mapping {
    Mapping {
        id: CANONICAL_MAPPING_ID.to_string(),
        version: "canonical-v1".to_string(),
        columns: CANONICAL_TARGETS.iter().map(|t| (t.to_string(), t.to_string())).collect(),
        credit_positive: false,
    }
}

/// Resolve `mapping_id` for a Company: the bundled canonical template, or a saved
/// `mapping_templates` row with its `mapping_columns` (DATABASE-SCHEMA §7).
fn resolve_mapping(conn: &Connection, company_id: &str, mapping_id: &str) -> AppResult<Mapping> {
    let trimmed = mapping_id.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case(CANONICAL_MAPPING_ID) {
        return Ok(canonical_mapping());
    }
    let (id, version): (String, String) = conn
        .query_row(
            "SELECT id, version FROM mapping_templates WHERE id = ?1 AND company_id = ?2",
            rusqlite::params![trimmed, company_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::invalid(format!("MAPPING_TEMPLATE_NOT_FOUND: {trimmed}")))?;

    let mut columns = HashMap::new();
    let mut credit_positive = false;
    let mut stmt = conn
        .prepare("SELECT source_pattern, semantic_target FROM mapping_columns WHERE template_id = ?1")
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map([&id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(AppError::from)?;
    for row in rows {
        let (pattern, target) = row.map_err(AppError::from)?;
        // `sign_convention` is the mapping's explicit toggle, stored in the same table so no
        // schema change is needed: `credit_positive` | `debit_positive` (never auto-detected).
        if pattern.trim().eq_ignore_ascii_case("sign_convention") {
            credit_positive = target.trim().eq_ignore_ascii_case("credit_positive");
            continue;
        }
        columns.insert(pattern.trim().to_lowercase(), target.trim().to_lowercase());
    }
    Ok(Mapping { id, version, columns, credit_positive })
}

/// Column index per semantic target for one concrete file (first matching header wins, so
/// duplicate headers resolve deterministically).
fn column_index(headers: &[String], mapping: &Mapping) -> HashMap<String, usize> {
    let mut idx = HashMap::new();
    for (i, header) in headers.iter().enumerate() {
        let key = header.trim().to_lowercase();
        if let Some(target) = mapping.columns.get(&key) {
            idx.entry(target.clone()).or_insert(i);
        }
    }
    idx
}

fn cell_at(row: &[String], idx: &HashMap<String, usize>, target: &str) -> Option<String> {
    idx.get(target)
        .and_then(|i| row.get(*i))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/* ── Text / number normalisation (the only place a source value becomes data) ── */

/// Decode a text file. UTF-8 (with BOM) is exact; a non-UTF-8 byte stream without NUL bytes is
/// Latin-1 and is flagged `auto_detected` so the UI can offer the preview (GL-TEMPLATE-SPEC §1);
/// anything else (UTF-16, binary) is `ENCODING_UNSUPPORTED` — the only retryable import error.
fn decode_text(bytes: &[u8]) -> AppResult<(String, ParseEncoding)> {
    let scope = "file".to_string();
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let text = String::from_utf8(bytes[3..].to_vec())
            .map_err(|e| AppError::encoding_unsupported(format!("UTF8_BOM_INVALID: {e}")))?;
        return Ok((text, ParseEncoding { scope, encoding: "utf-8".into(), bom: true, auto_detected: false }));
    }
    if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
        return Err(AppError::encoding_unsupported(
            "UTF16_BOM: re-export the file as UTF-8 or Latin-1",
        ));
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => Ok((
            text.to_string(),
            ParseEncoding { scope, encoding: "utf-8".into(), bom: false, auto_detected: false },
        )),
        Err(_) => {
            if bytes.iter().any(|b| *b == 0) {
                return Err(AppError::encoding_unsupported(
                    "UTF16_OR_BINARY: NUL bytes outside UTF-8 — re-export as UTF-8 or Latin-1",
                ));
            }
            // Latin-1 maps every byte, so it can never fail — it is offered as a *detected*
            // encoding with a preview, never applied silently (GL-TEMPLATE-SPEC §1).
            let text: String = bytes.iter().map(|b| *b as char).collect();
            Ok((
                text,
                ParseEncoding {
                    scope,
                    encoding: "latin-1".into(),
                    bom: false,
                    auto_detected: true,
                },
            ))
        }
    }
}

/// Split a delimited text into rows/fields. Quoted fields may contain the delimiter, quotes are
/// doubled (`""`) and a quoted field may span lines (RFC 4180 shape).
fn split_delimited(text: &str, delim: char) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            '"' => in_quotes = !in_quotes,
            '\r' => {}
            '\n' if !in_quotes => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            c if c == delim && !in_quotes => row.push(std::mem::take(&mut field)),
            _ => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

/// `.tsv` is always TAB; `.csv` takes the separator with the most occurrences on the header row
/// (`,` US vs `;` EU — GL-TEMPLATE-SPEC §1).
fn detect_delimiter(ext: &str, header: &str) -> char {
    if ext == "tsv" {
        return '\t';
    }
    let comma = header.matches(',').count();
    let semi = header.matches(';').count();
    let tab = header.matches('\t').count();
    if semi > comma && semi > tab {
        ';'
    } else if tab > comma {
        '\t'
    } else {
        ','
    }
}

/// Normalise a source number to an exact decimal string — the single place a spreadsheet value
/// becomes money-adjacent text (MONEY-ROUNDING-SPEC §2: never a float).
///
/// Separator rule (deterministic, never guessed):
///  * both `.` and `,` present → the RIGHT-most is the decimal separator, the other is thousands;
///  * one separator, repeated → thousands separators;
///  * one separator, once → decimal, EXCEPT `1.234`/`1,234`-shaped tokens (3 trailing digits,
///    ≤3 leading digits) which are genuinely ambiguous and are rejected for the user to confirm
///    in the preview (GL-TEMPLATE-SPEC §1 "import preview confirms (never guessed)");
///  * `(123.45)` and a trailing `-` are negative; whitespace and a leading currency code are
///    stripped; anything else returns `None` → HARD row error.
pub fn normalise_decimal_text(raw: &str) -> Option<String> {
    const SPACES: [char; 4] = [' ', '\u{00A0}', '\u{202F}', '\u{2007}'];
    let mut t = raw.trim().to_string();
    t = t.replace("(", "-").replace(")", "");
    if t.is_empty() {
        return None;
    }
    let negative = t.starts_with('-') || t.ends_with('-');
    let t: String = t.chars().filter(|c| !SPACES.contains(c)).collect();
    let t = t.trim_matches('-').to_string();

    let has_dot = t.contains('.');
    let has_comma = t.contains(',');
    let cleaned = if has_dot && has_comma {
        let decimal = if t.rfind('.') > t.rfind(',') { '.' } else { ',' };
        let thousands = if decimal == '.' { ',' } else { '.' };
        t.replace(thousands, "").replace(decimal, ".")
    } else if has_dot || has_comma {
        let sep = if has_dot { '.' } else { ',' };
        let count = t.matches(sep).count();
        if count > 1 {
            // Repeated separators are only thousands separators when every group after the
            // first is exactly 3 digits; "12.34.56" is refused rather than reshaped.
            let parts: Vec<&str> = t.split(sep).collect();
            let grouped = !parts[0].is_empty()
                && parts[0].chars().all(|c| c.is_ascii_digit())
                && parts[1..]
                    .iter()
                    .all(|p| p.len() == 3 && p.chars().all(|c| c.is_ascii_digit()));
            if !grouped {
                return None;
            }
            t.replace(sep, "")
        } else {
            let (before, after) = t.split_once(sep)?;
            let ok_chars = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
            if !ok_chars(before) || !ok_chars(after) {
                return None;
            }
            // Ambiguous thousands-vs-decimal shape: refuse rather than guess.
            if after.len() == 3 && before.len() <= 3 {
                return None;
            }
            format!("{before}.{after}")
        }
    } else {
        t
    };

    if cleaned.is_empty() || !cleaned.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return None;
    }
    if cleaned.matches('.').count() > 1 {
        return None;
    }
    let result = if negative && !cleaned.starts_with('-') {
        format!("-{cleaned}")
    } else {
        cleaned
    };
    // Final exactness gate: rust_decimal must accept it (rejects "", ".", "1.", overflow).
    if rust_decimal::Decimal::from_str_exact(&result).is_err() {
        return None;
    }
    Some(result)
}

/// Text → exact minor units for a currency (MONEY-ROUNDING-SPEC §2/§3, HALF_UP at the scale).
fn amount_minor(raw: Option<&str>, currency: &str) -> Result<Option<i64>, String> {
    match raw {
        None => Ok(None),
        Some(s) if s.trim().is_empty() => Ok(None),
        Some(s) => {
            let normalised = normalise_decimal_text(s).ok_or_else(|| format!("MONEY_PARSE: '{s}'"))?;
            Ok(Some(MoneyValue::from_decimal(&normalised, currency)?.minor))
        }
    }
}

/* ── File readers ────────────────────────────────────────────────── */

struct ParsedFile {
    sheets: Vec<ParseSheet>,
    encodings: Vec<ParseEncoding>,
    /// Row 0 is the header row; the rest are data rows.
    grid: Vec<Vec<String>>,
}

/// A cell → exact text. Excel numbers are IEEE doubles on disk; they are rendered once here
/// (shortest round-trip form) and immediately become `rust_decimal` inside `amount_minor`, so
/// no float ever takes part in money arithmetic (B3 / MONEY-ROUNDING-SPEC §2).
fn cell_text(cell: &Data) -> String {
    match cell {
        Data::String(s) => s.trim().to_string(),
        Data::Int(i) => i.to_string(),
        Data::Float(v) => format!("{v}"),
        Data::Bool(b) => b.to_string(),
        _ => String::new(), // Empty / DateTime / Error: the canonical template carries dates as text
    }
}

fn sheet_kind(name: &str) -> String {
    let n = name.trim().to_lowercase();
    if n == "gl" {
        "gl".to_string()
    } else if n == "coa" || n.contains("chart of accounts") {
        "coa".to_string()
    } else if n.contains("dimension") {
        "dimensions".to_string()
    } else if n.contains("opening") {
        "opening_balances".to_string()
    } else if n.contains("mapping note") {
        "mapping_notes".to_string()
    } else {
        "other".to_string()
    }
}

/// Which sheet carries the rows for this kind (GL-TEMPLATE-SPEC §1/§5). A GL Dump is required
/// to have a `GL` sheet — the others fall back to the first sheet.
fn select_sheet(kind: ImportKind, names: &[String]) -> AppResult<String> {
    let wanted: &[&str] = match kind {
        ImportKind::GlDump => &["gl"],
        ImportKind::OpeningBalances => &["opening balances", "opening_balances", "gl"],
        ImportKind::DimensionMaster => &["dimensions", "gl"],
        ImportKind::ExcelCsv | ImportKind::DriverData => &[],
    };
    for want in wanted {
        if let Some(name) = names.iter().find(|n| n.trim().eq_ignore_ascii_case(want)) {
            return Ok(name.clone());
        }
    }
    if kind == ImportKind::GlDump {
        return Err(AppError::import_file_unreadable(
            "GL_SHEET_MISSING: a GL Dump workbook needs a sheet named 'GL' (GL-TEMPLATE-SPEC §1)",
        ));
    }
    Ok(names[0].clone())
}

fn read_workbook(path: &Path, bytes: &[u8], kind: ImportKind) -> AppResult<ParsedFile> {
    if bytes.len() >= 8 && bytes[..8] == OLE2_MAGIC {
        return Err(AppError::import_file_locked(
            "ENCRYPTED_WORKBOOK: the file is an OLE2 encrypted package",
        ));
    }
    // calamine is the locked Excel reader (TECH-STACK §2); a read failure is
    // IMPORT_FILE_UNREADABLE, and a password-protected stream that slips past the magic check
    // is surfaced as IMPORT_FILE_LOCKED so the UI can tell the user to remove protection.
    let mut workbook = open_workbook_auto(path).map_err(|e| {
        let msg = e.to_string();
        let lower = msg.to_lowercase();
        if lower.contains("password") || lower.contains("encrypt") || lower.contains("decrypt") {
            AppError::import_file_locked(msg)
        } else {
            AppError::import_file_unreadable(msg)
        }
    })?;
    let names = workbook.sheet_names().to_vec();
    if names.is_empty() {
        return Err(AppError::import_file_unreadable("WORKBOOK_EMPTY: no sheets found"));
    }
    let target = select_sheet(kind, &names)?;

    let mut sheets = Vec::with_capacity(names.len());
    let mut grid: Option<Vec<Vec<String>>> = None;
    for name in &names {
        let range = workbook.worksheet_range(name);
        let row_count = match &range {
            Some(Ok(r)) => {
                let count = r.height().saturating_sub(1) as i64; // header row excluded
                if *name == target {
                    let mut rows = Vec::with_capacity(r.height());
                    for cells in r.rows() {
                        rows.push(cells.iter().map(cell_text).collect::<Vec<String>>());
                    }
                    grid = Some(rows);
                }
                count
            }
            Some(Err(e)) => return Err(AppError::import_file_unreadable(e.to_string())),
            None => 0,
        };
        sheets.push(ParseSheet { name: name.clone(), kind: sheet_kind(name), row_count });
    }

    let grid = grid
        .ok_or_else(|| AppError::import_file_unreadable(format!("SHEET_UNREADABLE: {target}")))?;
    let encodings = vec![ParseEncoding {
        scope: target,
        encoding: "utf-8".to_string(), // xlsx/xlsx strings are Unicode by format
        bom: false,
        auto_detected: false,
    }];
    Ok(ParsedFile { sheets, encodings, grid })
}

fn read_delimited(bytes: &[u8], ext: &str) -> AppResult<ParsedFile> {
    let (text, encoding) = decode_text(bytes)?;
    let header = text.lines().next().unwrap_or("").to_string();
    let delimiter = detect_delimiter(ext, &header);
    let grid = split_delimited(&text, delimiter);
    let row_count = grid.len().saturating_sub(1) as i64;
    let encoding = ParseEncoding { scope: "GL".to_string(), ..encoding };
    Ok(ParsedFile {
        sheets: vec![ParseSheet { name: "GL".to_string(), kind: "gl".to_string(), row_count }],
        encodings: vec![encoding],
        grid,
    })
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/* ── Row mapping ─────────────────────────────────────────────────── */

/// Grid → canonical source rows, using the resolved mapping.
fn prepare_rows(session: &ParseSession, mapping: &Mapping) -> AppResult<Vec<SourceRow>> {
    if session.grid.is_empty() {
        return Err(AppError::import_file_unreadable("EMPTY_FILE: the sheet has no header row"));
    }
    let headers: Vec<String> = session.grid[0].iter().map(|h| h.trim().to_string()).collect();
    let idx = column_index(&headers, mapping);
    for required in ["period", "account_code"] {
        if !idx.contains_key(required) {
            return Err(AppError::invalid(format!(
                "COLUMN_MISSING: no source column mapped to '{required}' (GL-TEMPLATE-SPEC §2)"
            )));
        }
    }
    if !["debit", "credit", "amount"].iter().any(|t| idx.contains_key(*t)) {
        return Err(AppError::invalid(
            "COLUMN_MISSING: no source column mapped to 'debit'/'credit'/'amount' (GL-TEMPLATE-SPEC §2)",
        ));
    }

    let mut rows = Vec::with_capacity(session.grid.len().saturating_sub(1));
    for (i, cells) in session.grid.iter().enumerate().skip(1) {
        if cells.iter().all(|c| c.trim().is_empty()) {
            continue; // blank filler rows are not errors
        }
        rows.push(SourceRow {
            line_no: (i + 1) as i64, // physical row: the header is row 1
            period: cell_at(cells, &idx, "period").unwrap_or_default(),
            account_code: cell_at(cells, &idx, "account_code").unwrap_or_default(),
            account_name: cell_at(cells, &idx, "account_name").unwrap_or_default(),
            debit: cell_at(cells, &idx, "debit"),
            credit: cell_at(cells, &idx, "credit"),
            amount: cell_at(cells, &idx, "amount"),
            cost_center: cell_at(cells, &idx, "cost_center"),
            project: cell_at(cells, &idx, "project"),
            product: cell_at(cells, &idx, "product"),
            customer: cell_at(cells, &idx, "customer"),
            business_unit: cell_at(cells, &idx, "business_unit"),
            intercompany_tag: cell_at(cells, &idx, "intercompany_tag"),
            currency: cell_at(cells, &idx, "currency"),
            posting_ref: cell_at(cells, &idx, "posting_ref"),
            doc_type: cell_at(cells, &idx, "doc_type"),
        });
    }
    Ok(rows)
}

/* ── Validation ──────────────────────────────────────────────────── */

/// A mapped row ready to be persisted as a `gl_lines` row.
#[derive(Debug, Clone)]
struct MappedLine {
    line_no: i64,
    period_id: String,
    account_id: String,
    bu_id: Option<String>,
    dims_json: String,
    amount_minor: i64,
    debit_minor: Option<i64>,
    credit_minor: Option<i64>,
    currency_code: String,
    posting_ref: Option<String>,
    doc_type: Option<String>,
    is_ic: bool,
    ic: Option<(String, String)>,
}

/// A row-level (or batch-level, `line_no = null`) problem. Codes are always taken from the 97
/// locked codes in ERROR-HANDLING.md — the reason lives in `message`/`details` (B20).
#[derive(Debug, Clone)]
struct RowIssue {
    code: String,
    message: String,
    line_no: Option<i64>,
    details: serde_json::Value,
}

impl RowIssue {
    fn row(code: &str, message: impl Into<String>, line_no: i64, details: serde_json::Value) -> Self {
        RowIssue { code: code.to_string(), message: message.into(), line_no: Some(line_no), details }
    }

    fn batch(code: &str, message: impl Into<String>, details: serde_json::Value) -> Self {
        RowIssue { code: code.to_string(), message: message.into(), line_no: None, details }
    }

    fn to_json(&self) -> serde_json::Value {
        json!({
            "code": self.code,
            "message": self.message,
            "lineNo": self.line_no,
            "details": self.details,
        })
    }
}

/// Surface the first blocking problem as the command's own error (locked codes only).
fn issue_to_error(issue: &RowIssue) -> AppError {
    match issue.code.as_str() {
        "MAP_ACCOUNT_AMBIGUOUS" => {
            let code = issue.details.get("accountCode").and_then(|v| v.as_str()).unwrap_or("");
            let accounts = issue
                .details
                .get("list")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            AppError::map_account_ambiguous(code, accounts)
        }
        "PERIOD_NOT_FOUND" => AppError::period_not_found(issue.message.clone()),
        "UNIT_PERIOD_MISMATCH" => AppError::unit_period_mismatch(issue.message.clone()),
        "OPENING_ALREADY_SET" => AppError::opening_already_set(issue.message.clone()),
        _ => AppError::invalid(issue.message.clone()),
    }
}

struct BuildResult {
    lines: Vec<MappedLine>,
    hard: Vec<RowIssue>,
    warnings: Vec<RowIssue>,
    preview: Vec<serde_json::Value>,
}

/// `YYYY-MM` / `YYYYMM` → month · `YYYYMMDD` / ISO / `DD.MM.YYYY` → exact day ·
/// `FY26-P08` → fiscal-year + period code (week-based calendars; GL-TEMPLATE-SPEC §2 col 1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PeriodKey {
    Month(i32, u32),
    Day(String),
    FiscalYearPeriod(String, String),
}

pub fn parse_period_key(raw: &str) -> Option<PeriodKey> {
    let t = raw.trim();
    if t.len() > 2 && (t.starts_with("FY") || t.starts_with("fy")) {
        let mut parts = t[2..].split(['-', '/', ' ']);
        let year = parts.next().unwrap_or("").trim();
        let code = parts.next().unwrap_or("").trim();
        if year.is_empty() || code.is_empty() {
            return None;
        }
        return Some(PeriodKey::FiscalYearPeriod(format!("FY{year}"), code.to_string()));
    }
    if t.len() == 7 && t.as_bytes().get(4) == Some(&b'-') {
        let (year, month) = t.split_at(4);
        let year: i32 = year.parse().ok()?;
        let month: u32 = month[1..].parse().ok()?;
        return (1..=12).contains(&month).then_some(PeriodKey::Month(year, month));
    }
    if t.len() == 6 && t.chars().all(|c| c.is_ascii_digit()) {
        let year: i32 = t[..4].parse().ok()?;
        let month: u32 = t[4..].parse().ok()?;
        return (1..=12).contains(&month).then_some(PeriodKey::Month(year, month));
    }
    if t.len() == 8 && t.chars().all(|c| c.is_ascii_digit()) {
        // Validated by chrono so 20260231 never maps to a period silently.
        let day = NaiveDate::parse_from_str(t, "%Y%m%d").ok()?;
        return Some(PeriodKey::Day(day.format("%Y-%m-%d").to_string()));
    }
    if let Ok(day) = NaiveDate::parse_from_str(t, "%Y-%m-%d") {
        return Some(PeriodKey::Day(day.format("%Y-%m-%d").to_string()));
    }
    if let Ok(day) = NaiveDate::parse_from_str(t, "%d.%m.%Y") {
        return Some(PeriodKey::Day(day.format("%Y-%m-%d").to_string()));
    }
    None
}

/// Fiscal period containing a date, for this Company's calendars (calendar-aware: the period
/// that contains the first day of the stated month wins, deterministically).
fn period_containing(conn: &Connection, company_id: &str, iso_date: &str) -> AppResult<Option<String>> {
    conn.query_row(
        "SELECT p.id FROM fiscal_periods p
           JOIN fiscal_years y ON y.id = p.fiscal_year_id
           JOIN fiscal_calendars c ON c.id = y.calendar_id
          WHERE c.company_id = ?1 AND p.start_date <= ?2 AND p.end_date >= ?2
          ORDER BY p.start_date ASC LIMIT 1",
        rusqlite::params![company_id, iso_date],
        |r| r.get(0),
    )
    .optional()
    .map_err(AppError::from)
}

fn resolve_period(conn: &Connection, company_id: &str, key: &PeriodKey) -> AppResult<Option<String>> {
    match key {
        PeriodKey::Month(year, month) => {
            let first = format!("{year:04}-{month:02}-01");
            period_containing(conn, company_id, &first)
        }
        PeriodKey::Day(iso) => period_containing(conn, company_id, iso),
        PeriodKey::FiscalYearPeriod(fy_label, code) => {
            let period_no: Option<i64> = code.trim_start_matches('P').parse().ok();
            conn.query_row(
                "SELECT p.id FROM fiscal_periods p
                   JOIN fiscal_years y ON y.id = p.fiscal_year_id
                   JOIN fiscal_calendars c ON c.id = y.calendar_id
                  WHERE c.company_id = ?1 AND y.fy_label = ?2 AND (p.code = ?3 OR p.period_no = ?4)
                  ORDER BY p.period_no ASC LIMIT 1",
                rusqlite::params![company_id, fy_label, code, period_no],
                |r| r.get(0),
            )
            .optional()
            .map_err(AppError::from)
        }
    }
}

#[derive(Debug)]
enum AccountFault {
    Missing,
    Ambiguous(Vec<String>),
}

fn query_account_ids(
    conn: &Connection,
    company_id: &str,
    code: &str,
    bu_clause: &str,
    bu: Option<&str>,
) -> Result<Vec<String>, rusqlite::Error> {
    let sql = format!(
        "SELECT id FROM accounts WHERE company_id = ?1 AND active = 1 AND code = ?2 {bu_clause}
          ORDER BY version DESC, id ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    match bu {
        Some(bu) => {
            let rows = stmt.query_map(rusqlite::params![company_id, code, bu], |r| r.get::<_, String>(0))?;
            rows.collect()
        }
        None => {
            let rows = stmt.query_map(rusqlite::params![company_id, code], |r| r.get::<_, String>(0))?;
            rows.collect()
        }
    }
}

/// Resolve `account_code` → `accounts.id`.
///
/// Precedence: the row's own BU → the shared (`bu_id IS NULL`) account → nothing. Another BU's
/// account is never borrowed (that is a missing account, offered as "create from name
/// (confirmed)" — GL-TEMPLATE-SPEC §6). Two candidates in the winning scope are ambiguous and
/// are reported with the candidate list, never auto-picked.
fn resolve_account(
    conn: &Connection,
    company_id: &str,
    code: &str,
    bu_id: Option<&str>,
) -> Result<String, AccountFault> {
    let scoped = match bu_id {
        Some(bu) => query_account_ids(conn, company_id, code, "AND bu_id = ?3", Some(bu))
            .map_err(|_| AccountFault::Missing),
        None => Ok(Vec::new()),
    }?;
    let shared =
        query_account_ids(conn, company_id, code, "AND bu_id IS NULL", None).map_err(|_| AccountFault::Missing)?;
    match (scoped.len(), shared.len()) {
        (1, _) => Ok(scoped[0].clone()),
        (0, 1) => Ok(shared[0].clone()),
        (0, 0) => Err(AccountFault::Missing),
        _ => Err(AccountFault::Ambiguous(if scoped.is_empty() { shared } else { scoped })),
    }
}

fn resolve_bu(conn: &Connection, company_id: &str, raw: &str) -> AppResult<Option<String>> {
    conn.query_row(
        "SELECT id FROM business_units WHERE company_id = ?1 AND (id = ?2 OR lower(name) = lower(?2))
          ORDER BY name ASC LIMIT 1",
        rusqlite::params![company_id, raw],
        |r| r.get(0),
    )
    .optional()
    .map_err(AppError::from)
}

/// `src_bu→dst_bu` (GL-TEMPLATE-SPEC §2 col 12) — accepts `->` and the Unicode arrow.
pub fn parse_ic_tag(raw: &str) -> Option<(String, String)> {
    let (src, dst) = raw.split_once("->").or_else(|| raw.split_once('\u{2192}'))?;
    let src = src.trim().to_string();
    let dst = dst.trim().to_string();
    if src.is_empty() || dst.is_empty() {
        return None;
    }
    Some((src, dst))
}

fn is_iso_week(raw: &str) -> bool {
    let t = raw.trim();
    t.len() == 8 && t.as_bytes().get(4) == Some(&b'-') && (t.as_bytes()[5] == b'W' || t.as_bytes()[5] == b'w')
}

struct CompanyCtx {
    id: String,
    kind: String,
    default_currency: String,
    calendar_preset: String,
}

fn load_company(conn: &Connection, company_id: &str) -> AppResult<CompanyCtx> {
    let (kind, default_currency): (String, String) = conn
        .query_row(
            "SELECT type, default_currency_code FROM companies WHERE id = ?1",
            [company_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(AppError::from)?
        .ok_or_else(AppError::file_corrupt)?;
    let calendar_preset: String = conn
        .query_row(
            "SELECT preset FROM fiscal_calendars WHERE company_id = ?1 AND name = 'Default'
              ORDER BY id ASC LIMIT 1",
            [company_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?
        .unwrap_or_else(|| "12month".to_string());
    Ok(CompanyCtx { id: company_id.to_string(), kind, default_currency, calendar_preset })
}

/// Map + validate every row. One hard issue per row (the first blocking problem — the UI
/// re-runs validate after each fix), plus batch-level gates.
fn build_lines(
    conn: &Connection,
    company: &CompanyCtx,
    rows: &[SourceRow],
    kind: ImportKind,
    mapping: &Mapping,
    excluded: &HashSet<i64>,
) -> AppResult<BuildResult> {
    let mut lines: Vec<MappedLine> = Vec::new();
    let mut hard: Vec<RowIssue> = Vec::new();
    let mut warnings: Vec<RowIssue> = Vec::new();
    let mut preview: Vec<serde_json::Value> = Vec::new();
    let mut period_cache: HashMap<String, Option<String>> = HashMap::new();
    let mut account_cache: HashMap<String, Result<String, Vec<String>>> = HashMap::new();
    let mut bu_cache: HashMap<String, Option<String>> = HashMap::new();
    let mut currencies: BTreeSet<String> = BTreeSet::new();
    let mut refs: HashMap<String, i64> = HashMap::new();

    for row in rows {
        if excluded.contains(&row.line_no) {
            continue; // excluded rows are out of the batch entirely (never validated, never guessed)
        }

        let currency = row
            .currency
            .clone()
            .unwrap_or_else(|| company.default_currency.clone());
        if scale_for_currency(&currency).is_none() {
            hard.push(RowIssue::row(
                "VALUE_INVALID",
                format!("CURRENCY_UNKNOWN: {currency} (MONEY-ROUNDING-SPEC §1)"),
                row.line_no,
                json!({ "currency": currency.clone() }),
            ));
            continue;
        }
        if row.period.is_empty() {
            hard.push(RowIssue::row(
                "VALUE_INVALID",
                "PERIOD_BLANK: column 'period' is required (GL-TEMPLATE-SPEC §2 col 1)",
                row.line_no,
                json!({}),
            ));
            continue;
        }
        if row.account_code.is_empty() {
            hard.push(RowIssue::row(
                "VALUE_INVALID",
                "ACCOUNT_CODE_BLANK: column 'account_code' is required (GL-TEMPLATE-SPEC §2 col 2)",
                row.line_no,
                json!({}),
            ));
            continue;
        }

        let period_key = match parse_period_key(&row.period) {
            Some(k) => k,
            None => {
                hard.push(RowIssue::row(
                    "VALUE_INVALID",
                    format!("PERIOD_UNPARSEABLE: '{}'", row.period),
                    row.line_no,
                    json!({ "period": row.period.clone() }),
                ));
                continue;
            }
        };
        let cached_period = period_cache.get(&row.period).cloned();
        let period_id = match cached_period {
            Some(v) => v,
            None => {
                let v = resolve_period(conn, &company.id, &period_key)?;
                period_cache.insert(row.period.clone(), v.clone());
                v
            }
        };
        let period_id = match period_id {
            Some(p) => p,
            None => {
                hard.push(RowIssue::row(
                    "PERIOD_NOT_FOUND",
                    format!("PERIOD_OUT_OF_RANGE: '{}' is outside this Company calendar", row.period),
                    row.line_no,
                    json!({ "period": row.period.clone() }),
                ));
                continue;
            }
        };

        let debit = match amount_minor(row.debit.as_deref(), &currency) {
            Ok(v) => v,
            Err(e) => {
                hard.push(RowIssue::row("VALUE_INVALID", e, row.line_no, json!({ "debit": row.debit })));
                continue;
            }
        };
        let credit = match amount_minor(row.credit.as_deref(), &currency) {
            Ok(v) => v,
            Err(e) => {
                hard.push(RowIssue::row("VALUE_INVALID", e, row.line_no, json!({ "credit": row.credit })));
                continue;
            }
        };
        let signed = match amount_minor(row.amount.as_deref(), &currency) {
            Ok(v) => v,
            Err(e) => {
                hard.push(RowIssue::row("VALUE_INVALID", e, row.line_no, json!({ "amount": row.amount })));
                continue;
            }
        };
        let (amount_minor, debit_minor, credit_minor) = match (debit, credit, signed) {
            // Debit/Credit columns → signed amount = debit − credit (GL-TEMPLATE-SPEC §3).
            (Some(d), Some(c), _) => (d - c, Some(d), Some(c)),
            (Some(d), None, _) => (d, Some(d), None),
            (None, Some(c), _) => (-c, None, Some(c)),
            // Signed amount: the mapping's explicit sign toggle decides, never a guess.
            (None, None, Some(a)) => (if mapping.credit_positive { -a } else { a }, None, None),
            (None, None, None) => {
                hard.push(RowIssue::row(
                    "VALUE_INVALID",
                    "AMOUNT_MISSING: the row has no debit/credit pair and no signed amount (GL-TEMPLATE-SPEC §4)",
                    row.line_no,
                    json!({}),
                ));
                continue;
            }
        };

        let bu_id = match row.business_unit.as_deref().map(str::trim).filter(|b| !b.is_empty()) {
            Some(raw) => {
                let cached = bu_cache.get(raw).cloned();
                match cached {
                    Some(v) => v,
                    None => {
                        let v = resolve_bu(conn, &company.id, raw)?;
                        bu_cache.insert(raw.to_string(), v.clone());
                        v
                    }
                }
            }
            None => None,
        };
        if bu_id.is_none() && company.kind == "group" {
            hard.push(RowIssue::row(
                "VALUE_INVALID",
                "BU_REQUIRED_FOR_GROUP: column 'business_unit' is required for a Group Company (GL-TEMPLATE-SPEC §2 col 11)",
                row.line_no,
                json!({ "businessUnit": row.business_unit.clone() }),
            ));
            continue;
        }

        let cache_key = format!("{}|{}", bu_id.clone().unwrap_or_default(), row.account_code);
        let account_id = match account_cache.get(&cache_key).cloned() {
            Some(v) => v,
            None => {
                let v = match resolve_account(conn, &company.id, &row.account_code, bu_id.as_deref()) {
                    Ok(id) => Ok(id),
                    Err(AccountFault::Missing) => Err(Vec::new()),
                    Err(AccountFault::Ambiguous(list)) => Err(list),
                };
                account_cache.insert(cache_key, v.clone());
                v
            }
        };
        let account_id = match account_id {
            Ok(id) => id,
            Err(candidates) if candidates.is_empty() => {
                hard.push(RowIssue::row(
                    "MAP_ACCOUNT_AMBIGUOUS",
                    format!(
                        "ACCOUNT_MISSING: '{}' is not in the COA — create it from the name (confirmed) or map the row (GL-TEMPLATE-SPEC §6)",
                        row.account_code
                    ),
                    row.line_no,
                    json!({ "accountCode": row.account_code.clone(), "list": [] }),
                ));
                continue;
            }
            Err(candidates) => {
                hard.push(RowIssue::row(
                    "MAP_ACCOUNT_AMBIGUOUS",
                    format!("ACCOUNT_AMBIGUOUS: '{}' resolves to several Accounts", row.account_code),
                    row.line_no,
                    json!({ "accountCode": row.account_code.clone(), "list": candidates }),
                ));
                continue;
            }
        };

        let mut is_ic = false;
        let mut ic: Option<(String, String)> = None;
        if let Some(tag) = row.intercompany_tag.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
            match parse_ic_tag(tag) {
                None => {
                    hard.push(RowIssue::row(
                        "VALUE_INVALID",
                        format!("IC_TAG_INVALID: '{tag}' (expected src_bu→dst_bu)"),
                        row.line_no,
                        json!({ "intercompanyTag": tag }),
                    ));
                    continue;
                }
                Some((src, dst)) => {
                    let mut resolve = |raw: &str| -> AppResult<Option<String>> {
                        if let Some(v) = bu_cache.get(raw).cloned() {
                            return Ok(v);
                        }
                        let v = resolve_bu(conn, &company.id, raw)?;
                        bu_cache.insert(raw.to_string(), v.clone());
                        Ok(v)
                    };
                    match (resolve(&src)?, resolve(&dst)?) {
                        (Some(s), Some(d)) => {
                            is_ic = true;
                            ic = Some((s, d));
                        }
                        _ => {
                            hard.push(RowIssue::row(
                                "VALUE_INVALID",
                                format!("IC_BU_UNRESOLVED: '{tag}' is not a known business unit"),
                                row.line_no,
                                json!({ "intercompanyTag": tag }),
                            ));
                            continue;
                        }
                    }
                }
            }
        }

        if let Some(reference) = row.posting_ref.as_deref().map(str::trim).filter(|r| !r.is_empty()) {
            if let Some(first) = refs.insert(reference.to_string(), row.line_no) {
                warnings.push(RowIssue::row(
                    "VALUE_INVALID",
                    format!("POSTING_REF_DUPLICATE: '{reference}' first seen on row {first}"),
                    row.line_no,
                    json!({ "postingRef": reference, "firstLineNo": first }),
                ));
            }
        }

        let mut dims = serde_json::Map::new();
        for (key, value) in [
            ("cost_center", &row.cost_center),
            ("project", &row.project),
            ("product", &row.product),
            ("customer", &row.customer),
        ] {
            if let Some(v) = value.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
                dims.insert(key.to_string(), json!(v));
            }
        }
        // Dimension *value ids* are resolved by the dimension-master import (M2-5); the
        // canonical keys are stored verbatim so nothing is lost in the meantime.
        let dims_json = serde_json::Value::Object(dims).to_string();

        currencies.insert(currency.clone());
        let line = MappedLine {
            line_no: row.line_no,
            period_id,
            account_id: account_id.clone(),
            bu_id: bu_id.clone(),
            dims_json,
            amount_minor,
            debit_minor,
            credit_minor,
            currency_code: currency.clone(),
            posting_ref: row.posting_ref.clone(),
            doc_type: row.doc_type.clone(),
            is_ic,
            ic: ic.clone(),
        };
        if preview.len() < PREVIEW_ROWS {
            preview.push(json!({
                "lineNo": line.line_no,
                "periodId": line.period_id,
                "accountId": line.account_id,
                "accountCode": row.account_code.clone(),
                "businessUnitId": line.bu_id,
                "amountMinor": line.amount_minor,
                "debitMinor": line.debit_minor,
                "creditMinor": line.credit_minor,
                "currency": line.currency_code,
                "postingRef": line.posting_ref,
                "docType": line.doc_type,
                "isIc": line.is_ic,
            }));
        }
        lines.push(line);
    }

    // ── Batch-level gates (no row to blame) ─────────────────────────────
    if currencies.len() > 1 {
        let list: Vec<String> = currencies.iter().cloned().collect();
        hard.insert(
            0,
            RowIssue::batch(
                "VALUE_INVALID",
                "CURRENCY_MIXED: a batch is single-currency until the FX engine (M6) — split the file or import one currency at a time",
                json!({ "currencies": list }),
            ),
        );
    }
    if kind == ImportKind::DriverData
        && company.calendar_preset == "12month"
        && rows.iter().any(|r| is_iso_week(&r.period))
    {
        hard.push(RowIssue::batch(
            "UNIT_PERIOD_MISMATCH",
            "DRIVER_PERIOD_WEEKLY: driver data is weekly but the calendar is monthly",
            json!({ "calendarPreset": company.calendar_preset }),
        ));
    }
    if kind == ImportKind::OpeningBalances {
        let existing: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM import_batches WHERE company_id = ?1
                   AND kind = 'opening_balances' AND status IN ('committed','validated')",
                [&company.id],
                |r| r.get(0),
            )
            .map_err(AppError::from)?;
        if existing > 0 {
            hard.push(RowIssue::batch(
                "OPENING_ALREADY_SET",
                "OPENING_ALREADY_SET: opening balances already exist for this Company",
                json!({ "existingBatches": existing }),
            ));
        }
    }

    Ok(BuildResult { lines, hard, warnings, preview })
}

/// Trial-Balance Tie-Out (GL-TEMPLATE-SPEC §3): Σdebits = Σcredits over the rows that will be
/// committed. Signed-amount sources contribute positive amounts as debits and |negative| as
/// credits, so both source layouts reduce to the same gate.
///
/// Diff rows are attributed **only** through `posting_ref`: a journal entry balances to zero, so
/// an unbalanced reference names its own rows. Without a reference the difference is reported in
/// the totals alone — never spread onto arbitrary rows (M5 attribution honesty).
fn tie_out(lines: &[MappedLine]) -> (i64, i64, Vec<serde_json::Value>) {
    let mut debits: i64 = 0;
    let mut credits: i64 = 0;
    let mut groups: BTreeMap<String, (i64, Vec<usize>)> = BTreeMap::new();

    for (i, line) in lines.iter().enumerate() {
        let (d, c) = match (line.debit_minor, line.credit_minor) {
            (Some(d), Some(c)) => (d, c),
            (Some(d), None) => (d, 0),
            (None, Some(c)) => (0, c),
            (None, None) if line.amount_minor >= 0 => (line.amount_minor, 0),
            (None, None) => (0, -line.amount_minor),
        };
        debits += d;
        credits += c;
        if let Some(reference) = line.posting_ref.as_deref().map(str::trim).filter(|r| !r.is_empty()) {
            let entry = groups.entry(reference.to_string()).or_insert((0, Vec::new()));
            entry.0 += line.amount_minor;
            entry.1.push(i);
        }
    }

    let mut diff_rows = Vec::new();
    if debits != credits {
        for (reference, (residual, members)) in groups.iter() {
            if *residual == 0 {
                continue;
            }
            for idx in members {
                let line = &lines[*idx];
                diff_rows.push(json!({
                    "lineNo": line.line_no,
                    "postingRef": reference,
                    "debitMinor": line.debit_minor,
                    "creditMinor": line.credit_minor,
                    "amountMinor": line.amount_minor,
                    "residualMinor": residual,
                }));
            }
        }
    }
    (debits, credits, diff_rows)
}

fn batch_currency(lines: &[MappedLine], fallback: &str) -> String {
    lines
        .first()
        .map(|l| l.currency_code.clone())
        .unwrap_or_else(|| fallback.to_string())
}

/* ── Commands ────────────────────────────────────────────────────── */

/// `import.parse` — {file_path, kind} → {parse_id, sheets, encodings, row_counts}.
/// Session-scoped (API-SPEC §2): no file bytes are touched while the vault is locked.
#[tauri::command(name = "import.parse", rename_all = "snake_case")]
pub fn import_parse(
    file_path: String,
    kind: String,
    registry: State<'_, ParseRegistry>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_unlocked(&session)?;
    let kind = ImportKind::parse(&kind)
        .ok_or_else(|| AppError::invalid(format!("IMPORT_KIND_UNKNOWN: {kind}")))?;

    let path = Path::new(&file_path);
    if !path.is_file() {
        return Err(AppError::import_file_unreadable(format!("FILE_NOT_FOUND: {file_path}")));
    }
    let bytes = fs::read(path).map_err(|e| AppError::import_file_unreadable(format!("IO: {e}")))?;
    let size_bytes = bytes.len() as i64;
    let source_hash = sha256_hex(&bytes);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    let parsed = match ext.as_str() {
        "xlsx" | "xlsm" | "xlsb" | "xls" | "ods" => read_workbook(path, &bytes, kind)?,
        "csv" | "tsv" | "txt" => read_delimited(&bytes, &ext)?,
        // A .zip is only a transport wrapper; extracting it needs a dependency that is not in
        // TECH-STACK (B13), so it is refused with the documented "export it again" text.
        "zip" => {
            return Err(AppError::import_file_unreadable(
                "ZIP_UNSUPPORTED: unzip the workbook and select the .xlsx/.csv inside",
            ))
        }
        other => {
            return Err(AppError::import_file_unreadable(format!(
                "FILE_TYPE_UNSUPPORTED: .{other} (GL-TEMPLATE-SPEC §1: .xlsx/.csv/.tsv)"
            )))
        }
    };

    let source_name =
        path.file_name().and_then(|n| n.to_str()).unwrap_or(&file_path).to_string();
    let parse_id = Uuid::new_v4().to_string();
    let headers: Vec<String> =
        parsed.grid.first().map(|r| r.iter().map(|c| c.trim().to_string()).collect()).unwrap_or_default();
    let row_counts: BTreeMap<String, i64> =
        parsed.sheets.iter().map(|s| (s.name.clone(), s.row_count)).collect();
    let sheets: Vec<serde_json::Value> = parsed
        .sheets
        .iter()
        .map(|s| json!({ "name": s.name, "kind": s.kind, "row_count": s.row_count }))
        .collect();
    let encodings: Vec<serde_json::Value> = parsed
        .encodings
        .iter()
        .map(|e| {
            json!({
                "scope": e.scope,
                "encoding": e.encoding,
                "bom": e.bom,
                "auto_detected": e.auto_detected,
            })
        })
        .collect();

    let parse_id = registry.put(ParseSession {
        parse_id: parse_id.clone(),
        company_id,
        kind,
        source_name: source_name.clone(),
        source_hash: source_hash.clone(),
        size_bytes,
        sheets: parsed.sheets,
        encodings: parsed.encodings,
        headers: headers.clone(),
        grid: parsed.grid,
        created_ms: now_ms(),
    });

    // Additive detail for S-032 ("batch name/hash preview") — the locked shape keeps
    // {parse_id, sheets, encodings, row_counts} and gains the file facts the screen shows.
    Ok(json!({
        "data": {
            "parse_id": parse_id,
            "sheets": sheets,
            "encodings": encodings,
            "row_counts": row_counts,
            "source_name": source_name,
            "source_hash": source_hash,
            "size_bytes": size_bytes,
            "headers": headers,
        }
    }))
}

/// `import.validate` — {parse_id, mapping_id} → {hard[], warnings[], preview[]}.
#[tauri::command(name = "import.validate", rename_all = "snake_case")]
pub fn import_validate(
    app: tauri::AppHandle,
    parse_id: String,
    mapping_id: String,
    registry: State<'_, ParseRegistry>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_unlocked(&session)?;
    let parsed = registry.get(&parse_id)?;
    if parsed.company_id != company_id {
        return Err(AppError::invalid("PARSE_COMPANY_MISMATCH: re-parse the file in this Company"));
    }
    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir).map_err(AppError::from)?;
    let company = load_company(&conn, &company_id)?;
    let mapping = resolve_mapping(&conn, &company_id, &mapping_id)?;
    let rows = prepare_rows(&parsed, &mapping)?;
    let built = build_lines(&conn, &company, &rows, parsed.kind, &mapping, &HashSet::new())?;

    let hard: Vec<serde_json::Value> = built.hard.iter().map(|i| i.to_json()).collect();
    let warnings: Vec<serde_json::Value> = built.warnings.iter().map(|i| i.to_json()).collect();
    Ok(json!({
        "data": {
            "hard": hard,
            "warnings": warnings,
            "preview": built.preview,
            "rows": built.lines.len() as i64,
            "mapping_version": mapping.version,
        }
    }))
}

/// `import.tieout` — {parse_id, mapping_id} → {debits_minor, credits_minor, diff_rows[]}.
/// Reported, never enforced: enforcement happens in `import.commit` (the gate).
#[tauri::command(name = "import.tieout", rename_all = "snake_case")]
pub fn import_tieout(
    app: tauri::AppHandle,
    parse_id: String,
    mapping_id: String,
    registry: State<'_, ParseRegistry>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_unlocked(&session)?;
    let parsed = registry.get(&parse_id)?;
    if parsed.company_id != company_id {
        return Err(AppError::invalid("PARSE_COMPANY_MISMATCH: re-parse the file in this Company"));
    }
    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir).map_err(AppError::from)?;
    let company = load_company(&conn, &company_id)?;
    let mapping = resolve_mapping(&conn, &company_id, &mapping_id)?;
    let rows = prepare_rows(&parsed, &mapping)?;
    let built = build_lines(&conn, &company, &rows, parsed.kind, &mapping, &HashSet::new())?;
    let (debits_minor, credits_minor, diff_rows) = tie_out(&built.lines);

    Ok(json!({
        "data": {
            "debits_minor": debits_minor,
            "credits_minor": credits_minor,
            "diff_rows": diff_rows,
            "balanced": debits_minor == credits_minor,
            "rows": built.lines.len() as i64,
            "currency": batch_currency(&built.lines, &company.default_currency),
        }
    }))
}

/// `import.commit` — {parse_id, mapping_id, name, exclusions[]} → the committed batch summary
/// (API-SPEC §4). The Tie-Out gate and the duplicate-source hash gate live here.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct Exclusion {
    pub line_no: i64,
    pub reason: String,
}

#[tauri::command(name = "import.commit", rename_all = "snake_case")]
pub fn import_commit(
    app: tauri::AppHandle,
    parse_id: String,
    mapping_id: String,
    name: String,
    exclusions: Vec<Exclusion>,
    registry: State<'_, ParseRegistry>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    // AUTH-SPEC §2.5/§3: the ingestion write target is the unlocked Company, and a
    // read-only (audit-chain-broken) Company accepts no new batch.
    let company_id = require_session_write(&session)?;
    let parsed = registry.get(&parse_id)?;
    if parsed.company_id != company_id {
        return Err(AppError::invalid("PARSE_COMPANY_MISMATCH: re-parse the file in this Company"));
    }
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(AppError::invalid("BATCH_NAME_REQUIRED"));
    }
    if trimmed_name.chars().count() > 120 {
        return Err(AppError::invalid("BATCH_NAME_TOO_LONG: at most 120 characters"));
    }

    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir).map_err(AppError::from)?;
    let company = load_company(&conn, &company_id)?;
    let mapping = resolve_mapping(&conn, &company_id, &mapping_id)?;
    let rows = prepare_rows(&parsed, &mapping)?;

    // Exclusions are validated against the real source rows and applied BEFORE validation:
    // an excluded row is out of the batch, so its own problems can never block the commit
    // (GL-TEMPLATE-SPEC §6 "import blocked until excluded").
    let known: HashSet<i64> = rows.iter().map(|r| r.line_no).collect();
    let mut excluded: HashSet<i64> = HashSet::new();
    for exclusion in &exclusions {
        if exclusion.reason.trim().is_empty() {
            return Err(AppError::invalid("EXCLUSION_REASON_REQUIRED: every excluded row needs a reason"));
        }
        if !known.contains(&exclusion.line_no) {
            return Err(AppError::invalid(format!(
                "EXCLUSION_LINE_NOT_FOUND: row {} is not in this file",
                exclusion.line_no
            )));
        }
        excluded.insert(exclusion.line_no);
    }

    let built = build_lines(&conn, &company, &rows, parsed.kind, &mapping, &excluded)?;
    if let Some(first) = built.hard.first() {
        return Err(issue_to_error(first));
    }
    let (debits_minor, credits_minor, diff_rows) = tie_out(&built.lines);
    if debits_minor != credits_minor {
        let currency = batch_currency(&built.lines, &company.default_currency);
        return Err(AppError::import_tie_out_failed(
            debits_minor,
            credits_minor,
            &currency,
            json!(diff_rows),
        ));
    }
    // Duplicate-source guard (ERROR-HANDLING: 409, the user confirms a deliberate re-import).
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM import_batches WHERE company_id = ?1 AND source_hash = ?2 LIMIT 1",
            rusqlite::params![company_id, parsed.source_hash],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    if let Some(batch) = existing {
        return Err(AppError::import_batch_hash_exists(&batch));
    }

    let batch_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let row_count = built.lines.len() as i64;
    // Excluded rows are logged, never dropped in silence (GL-TEMPLATE-SPEC §3).
    let tie_out_status = if exclusions.is_empty() { "pass" } else { "excluded_rows_logged" };

    let tx = conn.transaction().map_err(AppError::from)?;
    tx.execute(
        "INSERT INTO import_batches (id, company_id, kind, source_name, source_hash,
                                     mapping_version, status, row_count, debits_minor,
                                     credits_minor, tie_out_status, rollback_to_batch_id,
                                     committed_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'committed', ?7, ?8, ?9, ?10, NULL, ?11, ?11)",
        rusqlite::params![
            batch_id,
            company_id,
            parsed.kind.as_str(),
            parsed.source_name,
            parsed.source_hash,
            mapping.version,
            row_count,
            debits_minor,
            credits_minor,
            tie_out_status,
            now,
        ],
    )
    .map_err(AppError::from)?;

    for line in &built.lines {
        let gl_id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO gl_lines (id, company_id, batch_id, bu_id, period_id, account_id,
                                   dims_json, amount_minor, currency_code, debit_minor,
                                   credit_minor, posting_ref, doc_type, is_ic, is_excluded, line_no)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 0, ?15)",
            rusqlite::params![
                gl_id,
                company_id,
                batch_id,
                line.bu_id,
                line.period_id,
                line.account_id,
                line.dims_json,
                line.amount_minor,
                line.currency_code,
                line.debit_minor,
                line.credit_minor,
                line.posting_ref,
                line.doc_type,
                if line.is_ic { 1 } else { 0 },
                line.line_no,
            ],
        )
        .map_err(AppError::from)?;

        if let Some((src, dst)) = &line.ic {
            tx.execute(
                "INSERT INTO ic_lines (id, gl_line_id, source_bu_id, counterparty_bu_id,
                                       ic_amount_minor, matched_line_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
                rusqlite::params![
                    Uuid::new_v4().to_string(),
                    gl_id,
                    src,
                    dst,
                    line.amount_minor,
                ],
            )
            .map_err(AppError::from)?;
        }
    }

    // Audit (HMAC chain; the key lives in the OS keychain, never in the DB — B18-1).
    let exclusion_json: Vec<serde_json::Value> = exclusions
        .iter()
        .map(|e| json!({ "lineNo": e.line_no, "reason": e.reason.trim() }))
        .collect();
    let after_json = json!({
        "batchId": batch_id,
        "name": trimmed_name,
        "kind": parsed.kind.as_str(),
        "rows": row_count,
        "debitsMinor": debits_minor,
        "creditsMinor": credits_minor,
        "tieOutStatus": tie_out_status,
        "sourceHash": parsed.source_hash,
        "sourceName": parsed.source_name,
        "mappingId": mapping.id,
        "mappingVersion": mapping.version,
        "exclusions": exclusion_json,
    })
    .to_string();
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, &company_id).map_err(AppError::from)?;
    let hash = next_hash(&key, &prev, after_json.as_bytes());
    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id,
                                   before_json, after_json, prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'import.commit', 'import_batch', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![company_id, batch_id, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;
    let audit_id = tx.last_insert_rowid();
    tx.commit().map_err(AppError::from)?;

    Ok(json!({
        "data": {
            "batch_id": batch_id,
            "rows": row_count,
            "debits_minor": debits_minor,
            "credits_minor": credits_minor,
            "tie_out_status": tie_out_status,
            "audit_id": audit_id,
            "excluded_rows": exclusions.len() as i64,
            "source_hash": parsed.source_hash,
        }
    }))
}

/// `import.rollback` — {batch_id, reason} → {rolled_back_to}. Excises the batch's rows so the
/// Company's Actuals fall back to the previous committed batch (DATABASE-SCHEMA §7).
#[tauri::command(name = "import.rollback", rename_all = "snake_case")]
pub fn import_rollback(
    app: tauri::AppHandle,
    batch_id: String,
    reason: String,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&session)?;
    if reason.trim().is_empty() {
        return Err(AppError::invalid(
            "ROLLBACK_REASON_REQUIRED: a reason is required for the audit trail",
        ));
    }
    if reason.trim().chars().count() > 500 {
        return Err(AppError::invalid("ROLLBACK_REASON_TOO_LONG: at most 500 characters"));
    }

    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir).map_err(AppError::from)?;
    let found: Option<String> = conn
        .query_row(
            "SELECT status FROM import_batches WHERE id = ?1 AND company_id = ?2",
            rusqlite::params![batch_id, company_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    let status = found.ok_or_else(|| AppError::invalid(format!("BATCH_NOT_FOUND: {batch_id}")))?;
    if status == "rolled_back" {
        return Err(AppError::batch_already_rolled_back());
    }

    let tx = conn.transaction().map_err(AppError::from)?;
    // The batch the Company's Actuals fall back to once this one is excised; NULL when this
    // was the only committed batch — i.e. the Company returns to "no Actuals".
    let previous: Option<String> = tx
        .query_row(
            "SELECT id FROM import_batches WHERE company_id = ?1 AND id != ?2 AND status = 'committed'
              ORDER BY COALESCE(committed_at, created_at) DESC LIMIT 1",
            rusqlite::params![company_id, batch_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    tx.execute(
        "DELETE FROM ic_lines WHERE gl_line_id IN (SELECT id FROM gl_lines WHERE batch_id = ?1)",
        [&batch_id],
    )
    .map_err(AppError::from)?;
    let deleted = tx
        .execute("DELETE FROM gl_lines WHERE batch_id = ?1", [&batch_id])
        .map_err(AppError::from)?;
    tx.execute(
        "UPDATE import_batches SET status = 'rolled_back', rollback_to_batch_id = ?1
          WHERE id = ?2",
        rusqlite::params![previous, batch_id],
    )
    .map_err(AppError::from)?;

    let now = chrono::Utc::now().to_rfc3339();
    let after_json = json!({
        "batchId": batch_id,
        "reason": reason.trim(),
        "rolledBackTo": previous.clone(),
        "deletedGlLines": deleted,
    })
    .to_string();
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, &company_id).map_err(AppError::from)?;
    let hash = next_hash(&key, &prev, after_json.as_bytes());
    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id,
                                   before_json, after_json, prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'import.rollback', 'import_batch', ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![company_id, batch_id, serde_json::json!({ "status": status }), after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;

    Ok(json!({ "data": { "rolled_back_to": previous } }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /* ── numbers ── */

    #[test]
    fn decimal_text_normalises_us_and_eu_and_thousands() {
        assert_eq!(normalise_decimal_text("6350000.00").unwrap(), "6350000.00");
        assert_eq!(normalise_decimal_text("1,825,000.50").unwrap(), "1825000.50");
        assert_eq!(normalise_decimal_text("1825000,50").unwrap(), "1825000.50"); // EU decimal comma
        assert_eq!(normalise_decimal_text("1.825.000,50").unwrap(), "1825000.50"); // EU thousands
        assert_eq!(normalise_decimal_text("(123.45)").unwrap(), "-123.45"); // accounting negative
        assert_eq!(normalise_decimal_text("123.45-").unwrap(), "-123.45");
        assert_eq!(normalise_decimal_text("-42").unwrap(), "-42");
        assert_eq!(normalise_decimal_text(" 6 350 000 ").unwrap(), "6350000");
    }

    #[test]
    fn decimal_text_refuses_ambiguous_or_dirty_values() {
        assert_eq!(normalise_decimal_text("1.234"), None, "1.234 is thousands-or-decimal: never guessed");
        assert_eq!(normalise_decimal_text("1,234"), None);
        assert_eq!(normalise_decimal_text(""), None);
        assert_eq!(normalise_decimal_text("abc"), None);
        assert_eq!(normalise_decimal_text("12.34.56"), None);
        assert_eq!(normalise_decimal_text("1.2.3"), None);
    }

    #[test]
    fn minor_units_are_exact_at_the_currency_scale() {
        assert_eq!(amount_minor(Some("6350000.00"), "USD").unwrap(), Some(635_000_000));
        assert_eq!(amount_minor(Some("1825000.505"), "USD").unwrap(), Some(182_500_051), "HALF_UP at scale 2");
        assert_eq!(amount_minor(Some("1000"), "JPY").unwrap(), Some(1000), "JPY scale 0");
        assert_eq!(amount_minor(Some("1.2345"), "KWD").unwrap(), Some(1235), "KWD scale 3, HALF_UP");
        assert_eq!(amount_minor(None, "USD").unwrap(), None);
        assert!(amount_minor(Some("1.2.3"), "USD").is_err());
        assert!(amount_minor(Some("10"), "XYZ").is_err(), "unknown currency is HARD");
    }

    /* ── periods ── */

    #[test]
    fn period_keys_parse_every_documented_shape() {
        assert_eq!(parse_period_key("2026-08").unwrap(), PeriodKey::Month(2026, 8));
        assert_eq!(parse_period_key("202608").unwrap(), PeriodKey::Month(2026, 8));
        assert_eq!(parse_period_key("20260831").unwrap(), PeriodKey::Day("2026-08-31".into()));
        assert_eq!(parse_period_key("2026-08-31").unwrap(), PeriodKey::Day("2026-08-31".into()));
        assert_eq!(parse_period_key("31.08.2026").unwrap(), PeriodKey::Day("2026-08-31".into()));
        assert_eq!(
            parse_period_key("FY26-P08").unwrap(),
            PeriodKey::FiscalYearPeriod("FY26".into(), "P08".into())
        );
        assert_eq!(parse_period_key("2026-13"), None, "month 13 does not exist");
        assert_eq!(parse_period_key("20260231"), None, "Feb 31 is not a date");
        assert_eq!(parse_period_key("Q3 2026"), None);
    }

    /* ── text parsing ── */

    #[test]
    fn delimited_text_handles_quotes_and_embedded_newlines() {
        let rows = split_delimited("a,b,c\n1,\"x,y\",3\n4,\"line\nbreak\",6\r\n", ',');
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0], vec!["a", "b", "c"]);
        assert_eq!(rows[1], vec!["1", "x,y", "3"]);
        assert_eq!(rows[2], vec!["4", "line\nbreak", "6"]);
    }

    #[test]
    fn delimiter_detection_prefers_the_header_separator() {
        assert_eq!(detect_delimiter("csv", "period;account_code;debit"), ';');
        assert_eq!(detect_delimiter("csv", "period,account_code,debit"), ',');
        assert_eq!(detect_delimiter("csv", "period\taccount_code"), '\t');
        assert_eq!(detect_delimiter("tsv", "period,account_code"), '\t', "tsv is always TAB");
    }

    #[test]
    fn encoding_detection_is_never_silent_about_latin1() {
        let (text, enc) = decode_text(b"\xEF\xBB\xBFperiod,amount\n2026-08,1.00\n").unwrap();
        assert_eq!(enc.encoding, "utf-8");
        assert!(enc.bom);
        assert!(!enc.auto_detected);
        assert!(text.starts_with("period"));

        let (text, enc) = decode_text(b"period,amount\n2026-08,1.00\n").unwrap();
        assert_eq!(enc.encoding, "utf-8");
        assert!(!enc.bom);

        // Latin-1 (0xE9 = é) is offered as a *detected* encoding with a preview.
        let (_text, enc) = decode_text(b"libell\xE9,amount\n").unwrap();
        assert_eq!(enc.encoding, "latin-1");
        assert!(enc.auto_detected);

        // UTF-16LE BOM → ENCODING_UNSUPPORTED (retryable: the only retryable import error).
        let err = decode_text(b"\xFF\xFEh\x00i\x00").unwrap_err();
        assert_eq!(err.body().code, "ENCODING_UNSUPPORTED");
        assert_eq!(err.body().http_status, 422);
        assert!(err.body().retryable);
    }

    /* ── tie-out ── */

    fn line(amount: i64, reference: Option<&str>) -> MappedLine {
        MappedLine {
            line_no: 1,
            period_id: "fp-1".into(),
            account_id: "a-1".into(),
            bu_id: None,
            dims_json: "{}".into(),
            amount_minor: amount,
            debit_minor: None,
            credit_minor: None,
            currency_code: "USD".into(),
            posting_ref: reference.map(str::to_string),
            doc_type: None,
            is_ic: false,
            ic: None,
        }
    }

    #[test]
    fn tie_out_balances_debit_credit_and_signed_layouts() {
        // Debit/Credit columns: 300 out, 300 in.
        let mut a = line(0, None);
        a.debit_minor = Some(300);
        a.credit_minor = Some(0);
        let mut b = line(0, None);
        b.debit_minor = Some(0);
        b.credit_minor = Some(300);
        assert_eq!(tie_out(&[a, b]), (300, 300, vec![]));

        // Signed amounts: +300 / −300 reduce to the same gate.
        assert_eq!(tie_out(&[line(300, None), line(-300, None)]), (300, 300, vec![]));
    }

    #[test]
    fn tie_out_attributes_a_difference_only_through_posting_ref() {
        let mut lines = vec![line(100, Some("JE-1")), line(-95, Some("JE-1")), line(500, None)];
        let (debits, credits, diff) = tie_out(&lines.clone());
        assert_eq!((debits, credits), (600, 95));
        assert_eq!(diff.len(), 2, "only the unbalanced journal entry's rows are named");
        assert_eq!(diff[0]["postingRef"], "JE-1");
        assert_eq!(diff[0]["residualMinor"], 5);

        // Without a posting reference nothing is attributed — the totals still disagree.
        lines = vec![line(100, None), line(-95, None)];
        let (debits, credits, diff) = tie_out(&lines);
        assert_eq!((debits, credits), (100, 95));
        assert!(diff.is_empty(), "a difference is never spread onto arbitrary rows");
    }

    /* ── misc ── */

    #[test]
    fn ic_tag_and_iso_week_parsing() {
        assert_eq!(parse_ic_tag("bu-manu->bu-retail").unwrap(), ("bu-manu".into(), "bu-retail".into()));
        assert_eq!(parse_ic_tag("bu-manu→bu-retail").unwrap(), ("bu-manu".into(), "bu-retail".into()));
        assert_eq!(parse_ic_tag("bu-manu"), None);
        assert_eq!(parse_ic_tag("->bu-retail"), None);
        assert!(is_iso_week("2026-W31"));
        assert!(!is_iso_week("2026-08"));
    }

    #[test]
    fn import_kind_round_trips() {
        for raw in ["gl_dump", "excel_csv", "driver_data", "opening_balances", "dimension_master"] {
            assert_eq!(ImportKind::parse(raw).unwrap().as_str(), raw);
        }
        assert_eq!(ImportKind::parse("connector_sync"), None, "connector batches are not parsed from a file");
    }

    #[test]
    fn canonical_mapping_maps_the_template_headers_one_to_one() {
        let mapping = canonical_mapping();
        assert!(!mapping.credit_positive, "the canonical template is debit-positive");
        let headers: Vec<String> = CANONICAL_TARGETS.iter().map(|t| t.to_string()).collect();
        let idx = column_index(&headers, &mapping);
        for (i, target) in CANONICAL_TARGETS.iter().enumerate() {
            assert_eq!(idx.get(*target), Some(&i), "column {target} maps to itself");
        }
    }

    #[test]
    fn sha256_is_hex_and_stable() {
        let a = sha256_hex(b"onefpa");
        assert_eq!(a.len(), 64);
        assert_eq!(a, sha256_hex(b"onefpa"));
        assert_ne!(a, sha256_hex(b"onefpb"));
    }
}
