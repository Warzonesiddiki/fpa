//! Fiscal Calendar Engine — the sole calendar owner (B14 / I5 / ADR-004).
//! Presets: 12month (any start month) · 454 · 445 · 544 · 3334 (13 periods).
//! NRF anchor: Sunday nearest Feb 1 (tie → after; Feb 1 Sunday → Feb 1).
//! 53-week rule (NRF 4-day): a year has 53 weeks iff the NEXT fiscal year starts 371 days later;
//! on 4-5-4 the 53rd week lands in Q4 → Q4 pattern becomes 4-5-5 (P12 carries `is_53rd_week`).
//! Full-week variant: an explicit 1-week `W53` period is appended (always flagged in reports).
//! 3-3-3-4 is a 13-period calendar: P13 absorbs an extra week in a 53-week year (flagged `W53`-style).
//! Oracle: 2024 52w · 2025 52w · 2026 52w · 2027 52w · 2028 53w (TEST-FIXTURES-SPEC §2).

use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CalendarPreset {
    #[serde(rename = "12month")]
    TwelveMonth,
    #[serde(rename = "454")]
    Nrf454,
    #[serde(rename = "445")]
    Nrf445,
    #[serde(rename = "544")]
    Nrf544,
    #[serde(rename = "3334")]
    ThreeThreeThreeFour,
}

/// 53-week handling (SCREENS-SPEC S-003 selector; CAL_53WEEK_CONFLICT rule).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WeekRule {
    /// NRF: extra week lands in Q4 (4-5-4 → 4-5-5); no standalone W53 period.
    #[serde(rename = "nrf4day")]
    NrfFourDay,
    /// Full-week: an explicit 1-week `W53` period is appended; reports flag it.
    #[serde(rename = "fullweek")]
    FullWeek,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FiscalPeriod {
    pub period_no: u8,
    pub code: String,
    pub start_date: String,
    pub end_date: String,
    pub is_53rd_week: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FiscalYear {
    pub fy_label: String,
    pub start_date: String,
    pub end_date: String,
    pub week_count: u16,
    pub periods: Vec<FiscalPeriod>,
}

pub fn sunday_nearest(date: NaiveDate) -> NaiveDate {
    let dow = date.weekday().num_days_from_sunday(); // 0=Sun..6=Sat
    match dow {
        0 => date,
        1..=3 => date - Duration::days(dow as i64),       // Mon–Wed: previous Sunday
        4..=6 => date + Duration::days((7 - dow) as i64),  // Thu–Sat: following Sunday
        _ => unreachable!(),
    }
}

/// Build a fiscal year range for the NRF family starting at `start` (already anchored).
fn nrf_year(start: NaiveDate) -> (NaiveDate, NaiveDate, u16) {
    let next_start = sunday_nearest(NaiveDate::new(start.year() + 1, 2, 1));
    let days = (next_start - start).num_days();
    let week_count = if days >= 371 { 53 } else { 52 };
    let end = next_start - Duration::days(1);
    (start, end, week_count as u16)
}

/// Month week-counts plus `is_53rd_week` flags for a week-based preset.
fn month_schedule(preset: CalendarPreset, week_count: u16, week_rule: WeekRule) -> (Vec<u8>, Vec<bool>, bool) {
    match preset {
        // 4-5-4: 12 months; 53-week NRF rule → Q4 4-5-5 (P12 flagged); full-week → 12 std months + W53.
        CalendarPreset::Nrf454 => {
            let q4: [u8; 3] = if week_count == 53 && week_rule == WeekRule::NrfFourDay {
                [4, 5, 5]
            } else {
                [4, 5, 4]
            };
            let mut flags = vec![false; 12];
            if week_count == 53 && week_rule == WeekRule::NrfFourDay {
                *flags.last_mut().unwrap() = true;
            }
            let weeks = [vec![4, 5, 4], vec![4, 5, 4], vec![4, 5, 4], q4.to_vec()].concat();
            let needs_w53 = week_count == 53 && week_rule == WeekRule::FullWeek;
            (weeks, flags, needs_w53)
        }
        // 4-4-5 / 5-4-4: 12 months; 53-week years always append the explicit W53 (NRF rule is
        // exclusive to 4-5-4 — CAL_53WEEK_CONFLICT; engine degrades deterministically to full-week).
        CalendarPreset::Nrf445 | CalendarPreset::Nrf544 => {
            let p: [u8; 3] = if preset == CalendarPreset::Nrf445 { [4, 4, 5] } else { [5, 4, 4] };
            let weeks = [p, p, p, p].concat();
            let flags = vec![false; 12];
            let needs_w53 = week_count == 53;
            (weeks, flags, needs_w53)
        }
        // 3-3-3-4: a 13-period calendar (DATABASE-SCHEMA: period_no 1..=13).
        // P01–P13 are 4 weeks each (52w). A 53-week year is absorbed by P13 (5w) and flagged.
        CalendarPreset::ThreeThreeThreeFour => {
            let mut weeks = vec![4u8; 13];
            let mut flags = vec![false; 13];
            if week_count == 53 {
                if let Some(last) = weeks.last_mut() {
                    *last += 1;
                }
                *flags.last_mut().unwrap() = true;
            }
            (weeks, flags, false)
        }
        CalendarPreset::TwelveMonth => unreachable!("12month has its own builder"),
    }
}

fn label_of(calendar_year: i32) -> String {
    // Fiscal year label = calendar year in which the fiscal year STARTS (e.g. FY2026 = Feb 2026).
    format!("FY{calendar_year}")
}

pub fn build_12month(fy_start_year: i32, fy_start_month: u32, year_count: u32) -> Vec<FiscalYear> {
    let start_month = fy_start_month.clamp(1, 12);
    (0..year_count)
        .map(|i| {
            let y = fy_start_year + i as i32;
            let start = NaiveDate::from_ymd_opt(y, start_month, 1).unwrap();
            let end = NaiveDate::from_ymd_opt(y + 1, start_month, 1).unwrap() - Duration::days(1);
            let periods = (0..12)
                .map(|p| {
                    let ym = ((start_month + p - 1) % 12) + 1;
                    let ys = y + if start_month + p > 12 { 1 } else { 0 };
                    let ps = NaiveDate::from_ymd_opt(ys, ym, 1).unwrap();
                    let pe = NaiveDate::from_ymd_opt(if ym == 12 { ys + 1 } else { ys }, ym % 12 + 1, 1).unwrap()
                        - Duration::days(1);
                    FiscalPeriod {
                        period_no: (p + 1) as u8,
                        code: format!("P{:02}", p + 1),
                        start_date: ps.to_string(),
                        end_date: pe.to_string(),
                        is_53rd_week: false,
                    }
                })
                .collect();
            FiscalYear {
                fy_label: label_of(start.year()),
                start_date: start.to_string(),
                end_date: end.to_string(),
                week_count: 52,
                periods,
            }
        })
        .collect()
}

pub fn build_week_based(
    preset: CalendarPreset,
    first_start: NaiveDate,
    year_count: u32,
    week_rule: WeekRule,
) -> Vec<FiscalYear> {
    let mut cursor = first_start;
    (0..year_count)
        .map(|_| {
            let (start, end, week_count) = nrf_year(cursor);
            let (mut weeks, mut flags, needs_w53) = month_schedule(preset, week_count, week_rule);
            if needs_w53 {
                weeks.push(1);
                flags.push(true);
            }
            let mut day = start;
            let mut periods = Vec::with_capacity(weeks.len());
            for (i, w) in weeks.iter().enumerate() {
                let s = day;
                let e = s + Duration::days((*w as i64) * 7 - 1);
                day = e + Duration::days(1);
                let code = if flags[i] && needs_w53 && i == weeks.len() - 1 {
                    "W53".to_string()
                } else {
                    format!("P{:02}", i + 1)
                };
                periods.push(FiscalPeriod {
                    period_no: (i + 1) as u8,
                    code,
                    start_date: s.to_string(),
                    end_date: e.to_string(),
                    is_53rd_week: flags[i],
                });
            }
            cursor = day; // after the last period, day == next fiscal year start
            FiscalYear {
                fy_label: label_of(start.year()),
                start_date: start.to_string(),
                end_date: end.to_string(),
                week_count,
                periods,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn nrf_oracle_2024_2028() {
        // TEST-FIXTURES-SPEC §2 — the published/derived NRF schedule.
        let years = build_week_based(
            CalendarPreset::Nrf454,
            sunday_nearest(d("2024-02-01")),
            5,
            WeekRule::NrfFourDay,
        );
        assert_eq!(years[0].start_date, "2024-02-04");
        assert_eq!(years[0].week_count, 52);
        assert_eq!(years[1].start_date, "2025-02-02");
        assert_eq!(years[1].week_count, 52);
        assert_eq!(years[2].start_date, "2026-02-01");
        assert_eq!(years[2].week_count, 52);
        assert_eq!(years[3].start_date, "2027-01-31");
        assert_eq!(years[3].week_count, 52);
        assert_eq!(years[4].start_date, "2028-01-30");
        assert_eq!(years[4].week_count, 53);
        assert_eq!(years[4].end_date, "2029-02-03");
        let y28 = &years[4];
        assert_eq!(y28.periods.len(), 12, "NRF 4-day absorbs 53rd week into Q4 4-5-5");
        assert!(y28.periods[11].is_53rd_week, "P12 carries the 53rd-week flag");
        assert!(!y28.periods.iter().any(|p| p.code == "W53"));
    }

    #[test]
    fn full_week_variant_emits_w53() {
        let y = build_week_based(
            CalendarPreset::Nrf454,
            sunday_nearest(d("2028-02-01")),
            1,
            WeekRule::FullWeek,
        );
        assert_eq!(y[0].week_count, 53);
        assert_eq!(y[0].periods.len(), 13);
        let w53 = &y[0].periods[12];
        assert_eq!(w53.code, "W53");
        assert!(w53.is_53rd_week);
        assert_eq!(w53.start_date, "2029-01-28");
        assert_eq!(w53.end_date, "2029-02-03");
    }

    #[test]
    fn nrf_periods_sum_to_year() {
        let years = build_week_based(
            CalendarPreset::Nrf454,
            sunday_nearest(d("2024-02-01")),
            5,
            WeekRule::FullWeek,
        );
        for y in &years {
            let days: i64 = y
                .periods
                .iter()
                .map(|p| (d(&p.end_date) - d(&p.start_date)).num_days() + 1)
                .sum();
            let expected = (y.week_count as i64) * 7;
            assert_eq!(days, expected, "{} periods span the year", y.fy_label);
        }
    }

    #[test]
    fn twelve_month_april_2026() {
        let years = build_12month(2026, 4, 1);
        assert_eq!(years[0].fy_label, "FY2026");
        assert_eq!(years[0].start_date, "2026-04-01");
        assert_eq!(years[0].end_date, "2027-03-31");
        assert_eq!(years[0].periods.len(), 12);
        assert_eq!(years[0].periods[0].code, "P01");
        assert_eq!(years[0].periods[11].end_date, "2027-03-31");
    }

    #[test]
    fn sunday_nearest_feb_1_cases() {
        assert_eq!(sunday_nearest(d("2024-02-01")), d("2024-02-04")); // Thu → after
        assert_eq!(sunday_nearest(d("2025-02-01")), d("2025-02-02")); // Sat → after
        assert_eq!(sunday_nearest(d("2026-02-01")), d("2026-02-01")); // Sun → itself
        assert_eq!(sunday_nearest(d("2027-02-01")), d("2027-01-31")); // Mon → before
    }

    #[test]
    fn retail_period_map_2026() {
        // 454 P01 = Feb1–Feb28 (4w) · P02 = Mar1–Apr4 (5w) · P03 = Apr5–May2 (4w)
        // P04 = May3–May30 · P05 = May31–Jul4 (5w) · P06 = Jul5–Aug1 (4w)
        let years = build_week_based(
            CalendarPreset::Nrf454,
            sunday_nearest(d("2026-02-01")),
            1,
            WeekRule::NrfFourDay,
        );
        let p06 = &years[0].periods[5];
        assert_eq!(p06.start_date, "2026-07-05");
        assert_eq!(p06.end_date, "2026-08-01");
    }

    #[test]
    fn thirteen_period_preset_has_13_periods_and_absorbs_53rd() {
        let years = build_week_based(
            CalendarPreset::ThreeThreeThreeFour,
            sunday_nearest(d("2028-02-01")),
            1,
            WeekRule::FullWeek,
        );
        let y = &years[0];
        assert_eq!(y.periods.len(), 13, "3-3-3-4 is a 13-period calendar");
        assert!(y.periods[12].is_53rd_week, "P13 absorbs the 53rd week and is flagged");
        assert!(!y.periods.iter().any(|p| p.code == "W53"));
        let days: i64 = y.periods.iter().map(|p| (d(&p.end_date) - d(&p.start_date)).num_days() + 1).sum();
        assert_eq!(days, y.week_count as i64 * 7);
    }
}
