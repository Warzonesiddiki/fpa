//! Money Core — the single money owner (B14 / I1 / ADR-003).
//! Representation: integer minor units + Currency Scale + ISO code. All arithmetic in rust_decimal.
//! ROUNDING: HALF_UP default, HALF_EVEN only inside Largest-Remainder tie-breaks, TRUNCATE non-money
//! (MONEY-ROUNDING-SPEC §2/§3/§4). No floats anywhere (B3).

use rust_decimal::prelude::*;
use rust_decimal::{Decimal, RoundingStrategy};
use serde::{Deserialize, Serialize};

/// Read-only currency scale registry (mirrors `currency_scales` seed; Rust stays authoritative).
pub fn scale_for_currency(iso: &str) -> Option<u8> {
    match iso {
        "USD" | "EUR" | "GBP" | "INR" | "AUD" | "CAD" | "SGD" | "CHF" | "AED" | "SAR" | "SEK"
        | "NOK" | "DKK" | "PLN" | "TRY" | "ZAR" | "BRL" | "MXN" | "NZD" | "HKD" => Some(2),
        "JPY" | "KRW" | "VND" => Some(0),
        "KWD" | "BHD" | "OMR" | "JOD" | "IQD" | "TND" => Some(3),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MoneyValue {
    pub minor: i64,
    pub scale: u8,
    pub currency: String,
}

impl MoneyValue {
    pub fn new(minor: i64, currency: &str) -> Result<Self, String> {
        let scale =
            scale_for_currency(currency).ok_or_else(|| format!("CURRENCY_UNKNOWN: {currency}"))?;
        Ok(MoneyValue {
            minor,
            scale,
            currency: currency.to_string(),
        })
    }

    /// Parse an exact decimal string ("182500.00") to minor units — never float (B18-2).
    pub fn from_decimal(s: &str, currency: &str) -> Result<Self, String> {
        let scale =
            scale_for_currency(currency).ok_or_else(|| format!("CURRENCY_UNKNOWN: {currency}"))?;
        let d = Decimal::from_str_exact(s).map_err(|e| format!("MONEY_PARSE: {e}"))?;
        let factor = pow10(scale)?;
        let minor = (d * factor).round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero);
        let minor = minor.to_i64().ok_or_else(|| "MONEY_OVERFLOW".to_string())?;
        Ok(MoneyValue {
            minor,
            scale,
            currency: currency.to_string(),
        })
    }

    pub fn to_decimal_string(&self) -> String {
        let factor = pow10(self.scale).expect("currency scale ≤ 4 is always in range");
        (Decimal::from(self.minor) / factor).to_string()
    }
}

/// 10^scale as an exact Decimal (scale is 0..=4 by registry, but the helper is total).
fn pow10(scale: u8) -> Result<Decimal, String> {
    let mut acc = Decimal::ONE;
    for _ in 0..scale {
        acc *= Decimal::from(10u32);
    }
    Ok(acc)
}

/// Round a decimal to `scale` digits with HALF_UP (MONEY-ROUNDING-SPEC §2).
pub fn round_half_up(d: Decimal, scale: u32) -> Decimal {
    d.round_dp_with_strategy(scale, RoundingStrategy::MidpointAwayFromZero)
}

/// Exact HALF_UP on minor-unit computation: `0.1 + 0.2 == 0.3` guaranteed (never float).
pub fn add_decimal_strings(a: &str, b: &str, currency: &str) -> Result<MoneyValue, String> {
    let a = Decimal::from_str_exact(a).map_err(|e| e.to_string())?;
    let b = Decimal::from_str_exact(b).map_err(|e| e.to_string())?;
    MoneyValue::from_decimal(&(a + b).to_string(), currency)
}

/// Largest-Remainder Allocation (MONEY-ROUNDING-SPEC §4).
/// Exact totals: `sum(displayed children) == displayed parent`, to the display unit.
/// `unit` is the display unit as a Decimal (e.g. 1 for units, 0.1 for tenths).
/// Residual units go to the LARGEST fractional remainders first (§4 step 4b); the tie-break is
/// deterministic (smallest index first) — no float, no loss. Mirrored in TS by
/// `src/workers/spreading.ts::largestRemainderAllocate` (same spec vectors).
pub fn largest_remainder_allocate(exact_values: &[Decimal], unit: Decimal) -> Vec<Decimal> {
    if exact_values.is_empty() {
        return vec![];
    }
    // 1. floor each value to the unit
    let floored: Vec<Decimal> = exact_values
        .iter()
        .map(|v| (v / unit).floor() * unit)
        .collect();
    let total: Decimal = exact_values.iter().sum();
    let floored_total: Decimal = floored.iter().sum();
    let mut residual: Decimal = total - floored_total;

    // 2. rank by fractional remainder — DESCENDING (largest remainder first, §4b); deterministic
    //    index tie-break. (KI-014: this was ascending until 2026-09-03, which handed the residual
    //    unit to the smallest remainder — totals still tied, but on the wrong line.)
    let mut order: Vec<usize> = (0..exact_values.len()).collect();
    order.sort_by(|&i, &j| {
        let ri = exact_values[i] - floored[i];
        let rj = exact_values[j] - floored[j];
        rj.cmp(&ri).then_with(|| i.cmp(&j))
    });

    // 3. distribute residual in whole units
    let mut result = floored;
    let mut units_left = (residual / unit).round();
    let mut idx = 0usize;
    while units_left > Decimal::ZERO && idx < order.len() {
        result[order[idx]] += unit;
        residual -= unit;
        units_left -= Decimal::ONE;
        idx += 1;
    }
    let _ = residual;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn half_up_exact_decimal_not_binary_float() {
        let d = Decimal::from_str_exact("2.675").unwrap();
        assert_eq!(round_half_up(d, 2).to_string(), "2.68");
        assert_eq!(
            round_half_up(Decimal::from_str_exact("-2.675").unwrap(), 2).to_string(),
            "-2.68"
        );
    }

    #[test]
    fn sum_zero_one_plus_zero_two_is_exact() {
        let sum = add_decimal_strings("0.1", "0.2", "USD").unwrap();
        assert_eq!(sum.to_decimal_string(), "0.30");
        assert_eq!(sum.minor, 30);
    }

    #[test]
    fn currency_scales_exact() {
        assert_eq!(scale_for_currency("USD"), Some(2));
        assert_eq!(scale_for_currency("JPY"), Some(0));
        assert_eq!(scale_for_currency("KWD"), Some(3));
        assert_eq!(scale_for_currency("XXX"), None);
    }

    #[test]
    fn from_decimal_to_minor_round_trip() {
        let m = MoneyValue::from_decimal("182500.005", "INR").unwrap();
        assert_eq!(m.minor, 18250001); // ₹182,500.005 → 18,250,000.5 paise → 18,250,001 (half-up)
        assert_eq!(m.to_decimal_string(), "182500.01");
    }

    #[test]
    fn largest_remainder_exact_totals() {
        // P&L in units: children 12.4 / 3.7 / 7.9 (exact) → displayed at unit 1
        let values = vec![
            Decimal::from_str_exact("12.4").unwrap(),
            Decimal::from_str_exact("3.7").unwrap(),
            Decimal::from_str_exact("7.9").unwrap(),
        ];
        let displayed = largest_remainder_allocate(&values, Decimal::ONE);
        let child_sum: Decimal = displayed.iter().sum();
        let total = values.iter().sum::<Decimal>();
        assert_eq!(child_sum, total); // 12 + 4 + 8 = 24 == 24
        // §4b: the residual units land on the LARGEST remainders (.9 then .7), never on .4.
        let expected: Vec<Decimal> = ["12", "4", "8"]
            .iter()
            .map(|s| Decimal::from_str_exact(s).unwrap())
            .collect();
        assert_eq!(displayed, expected);
    }

    #[test]
    fn displayed_unit_allocation_is_exact() {
        // Exact values displayed at 0.1 units: 3999.9 base + 0.1 residual → ties never lost.
        let values = vec![
            Decimal::from_str_exact("1234.44").unwrap(),
            Decimal::from_str_exact("2665.56").unwrap(),
            Decimal::from_str_exact("100.00").unwrap(),
        ];
        let unit = Decimal::from_str_exact("0.1").unwrap();
        let displayed = largest_remainder_allocate(&values, unit);
        let sum: Decimal = displayed.iter().sum();
        assert_eq!(sum, Decimal::from_str_exact("4000.0").unwrap());
        assert!(displayed[1] > Decimal::from_str_exact("2665.5").unwrap());
        let expected: Vec<Decimal> = ["1234.4", "2665.6", "100.0"]
            .iter()
            .map(|s| Decimal::from_str_exact(s).unwrap())
            .collect();
        assert_eq!(displayed, expected);
    }

    #[test]
    fn largest_remainder_tie_break_is_lowest_index_first() {
        // Three equal thirds at 0.01: one residual unit → deterministic, to index 0.
        let third = Decimal::ONE / Decimal::from(3u32);
        let unit = Decimal::from_str_exact("0.01").unwrap();
        let displayed = largest_remainder_allocate(&[third, third, third], unit);
        let expected: Vec<Decimal> = ["0.34", "0.33", "0.33"]
            .iter()
            .map(|s| Decimal::from_str_exact(s).unwrap())
            .collect();
        assert_eq!(displayed, expected);
    }

    proptest::proptest! {
        #[test]
        fn integer_addition_is_exact(a in -1_000_000_000i64..1_000_000_000, b in -1_000_000_000i64..1_000_000_000) {
            let da = Decimal::from(a);
            let db = Decimal::from(b);
            assert_eq!((da + db).to_string(), (a + b).to_string());
        }
    }
}
