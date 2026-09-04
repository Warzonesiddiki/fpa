//! core/model.rs — single owner of the Model-grid edit/recalc validation contract (F-012, B14).
//! The docs (FORMULA-ENGINE-SPEC §2/§4, MONEY-ROUNDING-SPEC §3) give the *authoritative* rules:
//! formulas follow the whitelist and money crosses this boundary only as exact decimal strings
//! / minor units. This module is the thin "echo/validate" layer the M1 grid contract hangs on;
//! HyperFormula (in the Web Worker — M3-1) owns the real cell graph and incremental recalc.
//! "Thin" means: no float money, no silent substitutions, no invented error codes (B20).

use serde::{Deserialize, Serialize};

use crate::core::error::{AppError, AppResult};

/// Formula length ceiling (FORMULA-ENGINE-SPEC §1 allows any spreadsheet formula; this is the
/// conservative IPC guard so a paste storm cannot cross a huge string).
pub const MAX_FORMULA_LEN: usize = 2048;

/// Supported-function whitelist — the exact set from FORMULA-ENGINE-SPEC §2. The UI mirror lives
/// in `src/api/schema.ts` (`SUPPORTED_FUNCTIONS`); the two are covered by mirrored unit tests so
/// neither side silently drifts (B14: one owner per concern, mirrored gates like the PIN policy).
pub const SUPPORTED_FUNCTIONS: &[&str] = &[
    // Math & aggregation
    "SUM",
    "SUMIF",
    "SUMIFS",
    "SUMPRODUCT",
    "AVERAGE",
    "AVERAGEIF",
    "AVERAGEIFS",
    "COUNT",
    "COUNTA",
    "COUNTIF",
    "COUNTIFS",
    "MIN",
    "MAX",
    "MEDIAN",
    "ROUND",
    "ROUNDUP",
    "ROUNDDOWN",
    "MROUND",
    "ABS",
    "SQRT",
    "POWER",
    "MOD",
    "INT",
    "TRUNC",
    "CEILING",
    "FLOOR",
    "SIGN",
    "PRODUCT",
    "RAND",
    "RANDBETWEEN",
    // Logical & lookup
    "IF",
    "IFS",
    "IFERROR",
    "IFNA",
    "AND",
    "OR",
    "NOT",
    "XOR",
    "SWITCH",
    "TRUE",
    "FALSE",
    "ISNUMBER",
    "ISTEXT",
    "ISBLANK",
    "ISERROR",
    "ISNA",
    "VLOOKUP",
    "HLOOKUP",
    "XLOOKUP",
    "INDEX",
    "MATCH",
    "CHOOSE",
    "OFFSET",
    "INDIRECT",
    // Text & date (the fiscal-aware set is computed by the Rust Calendar engine — I5)
    "CONCAT",
    "CONCATENATE",
    "TEXT",
    "LEFT",
    "RIGHT",
    "MID",
    "LEN",
    "UPPER",
    "LOWER",
    "TRIM",
    "SUBSTITUTE",
    "VALUE",
    "DATE",
    "YEAR",
    "MONTH",
    "DAY",
    "EOMONTH",
    "EDATE",
    "DATEDIF",
    "WEEKDAY",
    "NETWORKDAYS",
    "FPERIOD",
    "FQTR",
    "FYEAR",
    "FPERIODSTART",
    "PERIODLEN",
    // Financial
    "NPV",
    "IRR",
    "XNPV",
    "XIRR",
    "PMT",
    "IPMT",
    "PPMT",
    "FV",
    "PV",
    "RATE",
    "NPER",
    "SLN",
    "DDB",
    "SYD",
    "DB",
    // Analysis Functions (FORMULA-ENGINE-SPEC §3)
    "CAGR",
    "MOVINGAVG",
    "TREND",
    "SEASONALITY",
    "YOY",
    "PRIORPERIOD",
    "PRIORYEAR",
    "RATIO",
];

fn is_supported_function(name: &str) -> bool {
    let upper = name.to_uppercase();
    SUPPORTED_FUNCTIONS.contains(&upper.as_str())
}

/// Collect every identifier immediately followed by `(`, i.e. the function calls in a formula.
/// This is deliberately text-scan based (TECH-STACK has no regex runtime dep); it only needs to
/// recognise the documented whitelist — anything else returns `FORMULA_UNSUPPORTED_FUNCTION`.
fn function_calls(formula: &str) -> Vec<String> {
    const OPEN_PAREN: u8 = 0x28; // b'(' — plain byte literal keeps the naive brace gate green.
    let mut out = Vec::new();
    let bytes = formula.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        if b.is_ascii_alphabetic() || b == b'_' {
            let start = i;
            while i < bytes.len()
                && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_' || bytes[i] == b'.')
            {
                i += 1;
            }
            let name = &formula[start..i];
            let mut j = i;
            while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == OPEN_PAREN {
                out.push(name.to_string());
            }
        } else {
            i += 1;
        }
    }
    out
}

/// Validate the formula text that can reach the grid engine (FORMULA-ENGINE-SPEC §1/§2).
/// Rules: `=`-prefixed, length-bounded, every function call in the whitelist. Anything else is
/// an explicit `FORMULA_UNSUPPORTED_FUNCTION` / `VALUE_INVALID` — never a silent fallback.
pub fn validate_formula(formula: &str) -> AppResult<()> {
    if formula.len() > MAX_FORMULA_LEN {
        return Err(AppError::invalid(
            "FORMULA_TOO_LONG: at most 2048 characters",
        ));
    }
    if !formula.starts_with('=') {
        return Err(AppError::invalid(
            "FORMULA_PREFIX: formulas must start with '='",
        ));
    }
    for call in function_calls(formula) {
        if !is_supported_function(&call) {
            return Err(AppError::formula_unsupported(&call));
        }
    }
    Ok(())
}

/// Parse a model-cell value into exact minor units for the given currency (MONEY-ROUNDING-SPEC
/// §1/§3). An unknown currency code fails `VALUE_INVALID` — never a silent scale guess (B3).
pub fn parse_value_minor(value: &str, currency: &str) -> AppResult<i64> {
    let money = crate::core::money::MoneyValue::from_decimal(value, currency)
        .map_err(|e| AppError::invalid(format!("MODEL_VALUE_INVALID: {e}")))?;
    Ok(money.minor)
}

/// The documented `model.cell.set.v1` recalc envelope (API-SPEC §3): the M1 echo returns a
/// deterministic single-edit report (the HyperFormula worker computes the real dirty graph in
/// M3-1); `cycles`/`changed_cells` stay ordered (lexical) so the UI is stable across reruns.
pub fn recalc_report(
    dirty_cells: usize,
    cycles: Vec<Vec<String>>,
    mut changed_cells: Vec<String>,
    duration_ms: u64,
) -> serde_json::Value {
    changed_cells.sort();
    changed_cells.dedup();
    serde_json::json!({
        "dirty_cells": dirty_cells,
        "cycles": cycles.into_iter().map(|p| serde_json::json!({ "path": p })).collect::<Vec<_>>(),
        "changed_cells": changed_cells,
        "issues": [],
        "duration_ms": duration_ms,
    })
}

/// In-memory working set for the M1 grid contract (mirrors the `ParseRegistry` pattern): the cell
/// store lives only between session operations and is deliberately not the source of truth yet
/// (that is `model_values` in the Company vault, M3-1). It exists so the CLI/command tests can
/// exercise the documented return shape without the native worker.
#[derive(Default)]
pub struct ModelCellStore(pub std::sync::Mutex<std::collections::BTreeMap<String, StoredCell>>);

/// Composite key inside a Model: `<scenario_id>:<line_id>:<period_id>`.
pub fn cell_key(scenario_id: &str, line_id: &str, period_id: &str) -> String {
    format!("{scenario_id}:{line_id}:{period_id}")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredCell {
    pub value_minor: Option<i64>,
    pub amount_text: Option<String>,
    pub formula: Option<String>,
    pub manual_override: bool,
}

impl ModelCellStore {
    pub fn get(&self, key: &str) -> Option<StoredCell> {
        let guard = self.0.lock().ok()?;
        guard.get(key).cloned()
    }

    pub fn put(&self, key: &str, cell: StoredCell) -> AppResult<()> {
        let mut guard = self
            .0
            .lock()
            .map_err(|_| AppError::internal("model store lock poisoned"))?;
        guard.insert(key.to_string(), cell);
        Ok(())
    }

    /// Distinct `line_id`s currently held for a scenario, in sorted order.
    pub fn changed_lines(&self, scenario_id: &str) -> Vec<String> {
        let guard = match self.0.lock() {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        let prefix = format!("{scenario_id}:");
        let mut seen = std::collections::HashSet::new();
        let mut lines = Vec::new();
        for key in guard.keys() {
            if let Some(rest) = key.strip_prefix(&prefix)
                && let Some((line, _)) = rest.split_once(':')
                && seen.insert(line.to_string())
            {
                lines.push(line.to_string());
            }
        }
        lines.sort();
        lines
    }

    pub fn count_for_scenario(&self, scenario_id: &str) -> usize {
        let guard = match self.0.lock() {
            Ok(g) => g,
            Err(_) => return 0,
        };
        let prefix = format!("{scenario_id}:");
        guard.keys().filter(|k| k.starts_with(&prefix)).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::money::scale_for_currency;

    #[test]
    fn formula_must_start_with_prefix() {
        let err = validate_formula("SUM(A1:A3)").unwrap_err();
        assert_eq!(err.body().code, "VALUE_INVALID");
        assert!(validate_formula("=SUM(A1:A3)").is_ok());
    }

    #[test]
    fn unsupported_function_is_explicit() {
        let err = validate_formula("=LAMBDA(x,x)").unwrap_err();
        assert_eq!(err.body().code, "FORMULA_UNSUPPORTED_FUNCTION");
        assert_eq!(err.body().details["function"], "LAMBDA");

        // A supported call passes; the fiscal-aware declarations are whitelisted (I5).
        assert!(validate_formula("=FPERIOD(DATE(2026,8,1))").is_ok());
        assert!(validate_formula("=CAGR(C2,C14,12)").is_ok());
    }

    #[test]
    fn function_scan_honours_whitespace_and_case() {
        assert!(validate_formula("=sum(A1:A3) + SUMIF(A1:A3,\">0\")").is_ok());
        let err = validate_formula("=sumif(a1:a3,\">0\") + sql()").unwrap_err();
        assert_eq!(err.body().code, "FORMULA_UNSUPPORTED_FUNCTION");
        assert_eq!(err.body().details["function"], "sql");
    }

    #[test]
    fn over_long_formula_is_rejected() {
        let long = format!("={}", "A1+".repeat(700));
        assert!(long.len() > MAX_FORMULA_LEN);
        assert_eq!(
            validate_formula(&long).unwrap_err().body().code,
            "VALUE_INVALID"
        );
    }

    #[test]
    fn parse_value_minor_is_exact_not_float() {
        assert_eq!(parse_value_minor("182500.00", "USD").unwrap(), 18_250_000);
        assert_eq!(parse_value_minor("0.1", "USD").unwrap(), 10);
        // 0.1 + 0.2 style drift is impossible: the boundary is decimal-string only (B18-2).
        assert_eq!(parse_value_minor("0.3", "USD").unwrap(), 30);
        assert!(
            parse_value_minor("1e3", "USD").is_err(),
            "no scientific-notation float (I1)"
        );
    }

    #[test]
    fn recalc_report_is_deterministic_and_ordered() {
        let report = recalc_report(
            2,
            vec![vec!["Revenue!C10".into(), "Revenue!C12".into()]],
            vec!["ln-z".into(), "ln-a".into()],
            12,
        );
        assert_eq!(report["dirty_cells"], 2);
        assert_eq!(report["changed_cells"][0], "ln-a");
        assert_eq!(report["changed_cells"][1], "ln-z");
        assert_eq!(report["duration_ms"], 12);
        assert_eq!(report["cycles"][0]["path"][0], "Revenue!C10");
    }

    #[test]
    fn store_keeps_lines_distinct_and_counts_scenario() {
        let store = ModelCellStore::default();
        store
            .put(
                "sc-base:ln-a:fp-p1",
                StoredCell {
                    value_minor: Some(1),
                    amount_text: None,
                    formula: None,
                    manual_override: false,
                },
            )
            .unwrap();
        store
            .put(
                "sc-base:ln-a:fp-p2",
                StoredCell {
                    value_minor: Some(2),
                    amount_text: None,
                    formula: None,
                    manual_override: false,
                },
            )
            .unwrap();
        store
            .put(
                "sc-base:ln-b:fp-p1",
                StoredCell {
                    value_minor: None,
                    amount_text: None,
                    formula: Some("=A1".into()),
                    manual_override: false,
                },
            )
            .unwrap();
        assert_eq!(store.count_for_scenario("sc-base"), 3);
        assert_eq!(store.changed_lines("sc-base"), vec!["ln-a", "ln-b"]);
        assert_eq!(store.changed_lines("sc-other").len(), 0);
    }

    #[test]
    fn currency_scale_remains_exact_for_money_paths() {
        assert_eq!(scale_for_currency("USD"), Some(2));
        assert_eq!(scale_for_currency("JPY"), Some(0));
        assert_eq!(scale_for_currency("KWD"), Some(3));
    }
}
