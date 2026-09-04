# COMPETITIVE-ANALYSIS.md

> OneFP&A · v1.0.0 · Terms per GLOSSARY.md · Closes checklist items **#4 Competitive Analysis** and **#5 Market & Positioning**.
> **Data discipline (B10):** every price/claim below is a published or review-site figure as of **2026-09-04** from the sources in §6. Prices are re-verified each release (RELEASE-CHECKLIST §2). Never quote these numbers in a customer-facing page without re-checking the source that day.

---

## 1. THE REAL COMPETITOR SET

The competitor is **not** Anaplan. It is **the workbook the team already owns** plus the spreadsheet governance they invented around it. Everything else is what they are told to compare us against.

| Class | Who | Why they are in the deal |
|---|---|---|
| **Status quo (primary)** | Excel / Google Sheets, ad-hoc file sharing, email-based consolidation | Already paid for, already trained, no project to approve |
| **Cloud EPM / xP&A** | Anaplan, Workday Adaptive Planning, Pigment, Planful, OneStream, Board | The "grown-up" option procurement shortlists |
| **Excel-native FP&A** | Vena, Datarails, Cube | "Keep Excel, add a data layer" — the closest UX match to our buyers' habit |
| **Mid-market EPM challengers** | Prophix, Jira-adjacent tooling, Fathom (reporting-only) | Cheaper seats, smaller scope |
| **Adjacent that gets confused for us** | Power BI / Tableau (analysis-only), QuickBooks/Xero/NetSuite native modules (no planning), Blackline (close mgmt) | Buyers assume overlap; we do not replace them |

## 2. PRICING (indicative, mid-market, published/secondary sources, 2026-09)

| Vendor | Model | Year-1 software | Implementation | Time to value |
|---|---|---|---|---|
| Anaplan | platform + named users | $150K–$500K | 1.5–3× license | 4–12 months |
| OneStream | enterprise CPM | $500K–$2M (3-yr) | heavy SI | 6–18 months |
| Workday Adaptive | $/planner/yr + platform fee | $30K–$120K platform + $300–$1,200/planner | $100K–$400K | 3–6 months |
| Pigment | platform + seats + modules | $30K–$50K entry; $100K–$300K typical | $50K–$150K | 2–4 months |
| Planful | platform + seats | $80K–$250K | $40K–$120K | 3–6 months |
| Board | $/user/yr | $1,250–$2,500/user/yr | add-ons | 3–6 months |
| Vena | Excel add-in + cloud data layer | from ~$30K/yr (£25K–£80K UK) | £15K–£50K | 6–12 weeks (often 2×) |
| Datarails | Excel add-in + FP&A Genius | from ~$24K/yr, opaque | PS engagement | 3–6 months |
| Cube | planning layer + Sheets | seat-based; no trial | $5K–$10K + ~$250/mo advisory | 2–3 months |
| **Excel (status quo)** | Microsoft 365 seat | ~$0 incremental | $0 | 0 days |
| **OneFP&A (ours)** | **per-Company license, offline activation (F-035), `plan` = pro / enterprise** | **flat per Company; no seats, no per-user counting** | **self-serve First-Run Wizard (S-002)** | **< 10 min to first working Budget (PROJECT-BRIEF §7)** |

**Structural difference:** every cloud competitor bills **per person who touches the numbers**, which is exactly the behaviour FP&A teams are trying to widen. Our license is per Company File. Do not market this as "cheap" — market it as "you never gate a review seat."

## 3. FEATURE MATRIX

✅ in-product today per PRD v1.0.0 · ◐ partially / requires their SI work · ❌ absent per published material.

| Capability | Excel | Anaplan | Adaptive | Pigment | OneStream | Vena | Datarails | Cube | **OneFP&A** |
|---|---|---|---|---|---|---|---|---|---|
| Works fully offline / no data leaves the machine | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅** |
| Zero per-seat billing | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ | ❌ | **✅** |
| Exact decimal money (no float drift) | ❌ | ◐ | ◐ | ◐ | ✅ | ❌ | ❌ | ◐ | **✅ (I1, MONEY-ROUNDING-SPEC)** |
| Tamper-evident audit trail on every number | ❌ | ✅ | ◐ | ◐ | ✅ | ◐ | ◐ | ❌ | **✅ (HMAC chain, ADR-011)** |
| Native Excel formula compatibility | ✅ | ❌ | ◐ | ❌ | ◐ | ✅ | ✅ | ◐ | **✅ (F-012, FORMULA-ENGINE-SPEC)** |
| Multi-entity consolidation: IC + FX + NCI | ❌ | ✅ | ✅ | ◐ | ✅ | ◐ | ◐ | ❌ | **✅ (v1.0.0, F-028)** |
| Non-calendar fiscal calendars (4-5-4 / 4-4-5 / 52-53wk) | ❌ | ◐ | ◐ | ◐ | ◐ | ❌ | ❌ | ❌ | **✅ (F-003)** |
| Industry-specific modelling without a consulting project | ❌ | ◐ (SI-built) | ◐ (SI-built) | ◐ (SI-built) | ◐ (SI-built) | ❌ | ❌ | ❌ | **✅ (12 Packs as data, B15)** |
| Variance attribution (Volume/Price/Mix/FX/Efficiency) | ❌ | ◐ | ◐ | ◐ | ◐ | ❌ | ◐ | ❌ | **✅ (F-024, S-054)** |
| FVA (forecast-vs-actual accuracy scoring) | ❌ | ◐ | ◐ | ◐ | ◐ | ❌ | ❌ | ❌ | **✅ (F-025, S-055)** |
| Board Pack / statement pack generation | ❌ | ◐ | ◐ | ◐ | ✅ | ◐ | ◐ | ❌ | **✅ (F-030, S-064)** |
| Data-residency answer that fits a 2-line email | ❌ (their laptops) | ◐ (region) | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | **✅ (no server exists)** |
| Linux desktop | n/a | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ (B18-8)** |
| Real-time multi-user collaboration | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | **❌ (V-015, v1.1)** |
| Web/mobile viewer | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **❌ (NOT BUILDING)** |
| ERP connectors | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (200+) | ◐ (NetSuite pain reported) | ◐ (4 shipped + GL Dump for every other ERP, B19) |

## 4. WHAT THEY DO BADLY (and the review evidence)

| Vendor | Documented weakness | Our one-line answer |
|---|---|---|
| Anaplan | 4–12 month implementations; SI fees 1.5–3× license; not budget-fit for mid-market | Company File + Pack = configured in under 10 minutes, no SI |
| Vena | "Need IT for implementation"; slow template load (2–3 min reported); still Excel underneath | Rust core computes locally; no workbook to load |
| Datarails | Add-in breaks on **macOS** ("busy" errors, lost days); steepest learning curve in class; performance degrades on large data | Native app on all three OS, parity-gated (B18-8); no add-in to break |
| Cube | Reported **8-cube limit**, no simultaneous data loads, month-end refreshes taking 24 h+, NetSuite sync failures, no trial | GL Dump import (B19) + 2M-row/Company schema target (DATABASE-SCHEMA §gl_lines) |
| Workday Adaptive | "Viewer trap": review-only seats billed at planner rates; platform fee scales with entity count | No seats at all |
| Pigment | Priced 40–50 % of Anaplan — still a 6-figure cloud subscription | Runs on the laptop the CFO already owns |
| OneStream | 6–18 month projects, enterprise-only cost | Consolidation without the programme |
| Excel/Sheets | Float rounding, broken links, no provenance, no way to prove a total | `money:ast` gate, Audit chain, Health Check export gate |
| **Us** | **Single-user per machine, no web viewer, no live co-editing, no write-back to the ERP, 4 connectors, no AI in v1.0.0** | **Stated in PRD §5 NOT BUILDING; V-015 (multi-user) and V-001 (on-device AI) are the v1.1 answers** |

## 5. WEDGE, POSITIONING AND OBJECTION HANDLING

**Wedge:** the buyer who cannot survive a 6-month project and will not put actuals in a vendor's cloud. They are a 5–200 person finance team, several BUs, one ERP that has no connector, one auditor asking who changed the number.

**Positioning statement**
> For FP&A managers and CFOs of multi-BU companies who plan in Excel and close it by email, **OneFP&A** is the local-first desktop FP&A suite that covers import → model → plan → analyze → report → govern in one app. Unlike cloud EPM platforms, it needs no implementation project, bills no seats, and never moves a number off the machine.

**Category:** *local-first FP&A suite* (do not say "EPM" — it implies the procurement cycle we are escaping; do not say "spreadsheet tool" — it implies Vena/Datarails).

**Objection → answer**
| Objection | Answer |
|---|---|
| "We need browser access" | v1.0.0 is desktop-only (B1). Board consumption is handled by the Board Pack export (S-064, PDF/Excel), not a viewer seat. |
| "We need multiple planners at once" | v1.0.0 is single-user per Company File (A19). Exchange path: Company File + Model Dump; multi-user is V-015. Never fake concurrency. |
| "No connector for our ERP (Tally / SAP on-prem / Zoho)" | GL Dump is the guaranteed path (B19, GL-TEMPLATE-SPEC); connectors are convenience. |
| "Is our data on your servers?" | There are no servers (ADR-001/008). Encryption at rest (A7), zero telemetry (B18-9). |
| "Why not stay in Excel?" | Float money, no provenance, no tie-out gate. Same formulas, audit-grade results, plus the statement suite. |
| "You're a startup / what if you vanish?" | `.fpa` Company File is self-contained and documented (DR-RECOVERY-RUNBOOK, EXPORT-FORMAT-SPEC Model Dump); offline license needs no activation server. |

**Anti-positioning (what we never claim):** not a BI tool, not an accounting system of record (A4), not "AI FP&A" (A13), not an enterprise EPM replacement for Fortune 500 xP&A.

## 6. SOURCES (re-verify at every release; date every citation)

- `atonementlicensing.com/blog/workday-adaptive-planning-pricing-2026/` — Adaptive tiers, viewer classification, platform fee.
- `cfoshortlist.com/vendors/anaplan` · `/vendors/pigment` · `/vendors/workday-adaptive-planning` — Y1/3-yr TCO tables, implementation timelines, per-seat ranges.
- `farseer.com/blog/pigment-competitors/` — Anaplan ~$200K/yr, Adaptive entry.
- `coefficient.io/datarails-pricing` — Datarails from ~$24K, opaque pricing, PS dependency, Excel performance.
- `drivetrain.ai/post/cube-vs-datarails` — Datarails macOS add-in failures; Cube 8-cube/no-concurrent-load/month-end refresh + NetSuite sync complaints.
- `grove.financial/profiles/vena-solutions` · `datarails.com/vena-reviews-pros-and-cons-pricing-competitors/` — Vena £25K–£80K, implementation overruns, slow add-in.
- `golimelight.com/blog/limelight-vs-vena-vs-datarails` — Vena ~$30K→$60K+ Y1, Datarails ~$24K.

*Referenced by: PROJECT-BRIEF.md, PRD.md, DOCS-INDEX.md.*
