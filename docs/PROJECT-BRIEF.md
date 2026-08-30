# PROJECT-BRIEF.md

> **Product:** OneFP&A — the all-in-one Financial Planning & Analysis desktop suite
> **Version:** 1.0.0 (documents), lock: Stage 0 v8 + GLOSSARY.md
> **Status:** Build specification — not marketing.

---

## 1. THE PROBLEM

A finance team's quarterly budget and monthly close runs on **12–40 disconnected Excel workbooks** — one per Business Unit, per cost center, per scenario — plus a BI tool, plus a cloud planning subscription. The failure modes are systemic:

| Failure | Evidence-based reality |
|---|---|
| **Formula corruption** | Shared spreadsheets accumulate broken links, copy-paste divergence, and manual overwrites; nobody can prove a total is right |
| **Float rounding drift** | IEEE-754 math in spreadsheets silently produces wrong cents in large aggregates; audit-grade proof is impossible |
| **No audit trail** | There is no record of who changed what, when, or which version produced the board numbers |
| **Variance = guesswork** | "Revenue is $50K under budget" with no volume/price/mix decomposition |
| **Multi-entity chaos** | Groups consolidate via email-and-paste; intercompany lines don't tie; FX translation is hand-built |
| **Industry blindness** | Generic tools force every industry into the same model — retail needs 4-5-4, construction needs WIP/POC, healthcare needs payer mix, SaaS needs NRR |
| **Cross-platform lock** | The alternatives are cloud-only (Anaplan, Pigment, Adaptive: 2–6 month implementations, per-seat subscriptions) or Excel add-ons (Vena, Datarails, Cube) |

## 2. THE SOLUTION

**OneFP&A** is a local-first desktop application (Windows, macOS, Linux) that covers the entire FP&A cycle in one product:

```
Company setup (Industry Pack) → Data ingestion (GL Dump / Excel / 4 ERP Connectors)
→ Model build (Drivers, Assumptions, Excel-compatible formulas, multi-sheet)
→ Plan (Budget, Forecast, Rolling Forecast, Scenarios)
→ Analyze (Variance + Attribution, What-If, Sensitivity, FVA)
→ Report (Statement Suite, Segment, Dashboard, Board Pack, Excel/PDF)
→ Govern (Audit Trail, Health Checks, Encryption, License)
```

Everything runs on the user's machine. Financial data never leaves it (rule B18-9). The **Industry Pack** system makes the single engine work for every industry (B15) — and for **groups** where each Business Unit uses a different pack, calendar, and currency, consolidated into one group view.

## 3. THE PITCH (one line)

**An FP&A team should never open Excel, a BI tool, or a cloud EPM account again — one offline-first desktop app does plan → forecast → consolidate → variance → board pack, for any industry, with audit precision.**

## 4. WHY NOW

1. **The market split leaves a gap.** Platform tools (Anaplan, Workday Adaptive, Pigment) take 1–6 months to implement at $20K–$100K+/yr; Excel-adjacent tools (Vena, Datarails, Cube, Jirav) keep users in spreadsheets and never solve governance. Nobody delivers **platform capability with zero implementation project, fully offline, on the user's hardware** ([market comparison, Q3 2026](https://www.getaleph.com/answers/top-fpa-software-2026)).
2. **Hardware is ready.** A 2020+ laptop runs a 500k-row model, 1M formula cells, and local AI inference. Desktop native apps are viable again (Tauri 2).
3. **The engine technology is finally there.** HyperFormula gives Excel-compatible formulas; `rust_decimal` gives audit-exact money; SQLite/WAL + Tauri gives encrypted local-first data; `typst` gives deterministic PDF. Five years ago this stack was not production-grade.
4. **Regulation and data sovereignty.** More clients (especially non-US, healthcare, government, and regulated industries) cannot put financial data in US/EU SaaS. Local-first is not a feature — it is a purchase requirement.
5. **The previous attempt in this project space proves the failure mode and the demand.** A 200-engine, web+server+PWA+desktop hybrid with float math and broken secure storage shows what "everything at once, badly" looks like — and that the all-in-one demand is real.

## 5. TARGET USER

| Segment | Primary | Description |
|---|---|---|
| **SMB / mid-market finance teams** | ✅ | Companies $5M–$500M revenue; one FP&A analyst or CFO; monthly close + annual budget + rolling forecast |
| **Diversified groups / conglomerates** | ✅ | 2–50 Business Units across industries; need consolidation, eliminations, FX, segment reporting |
| **Startups (pre-revenue)** | ✅ | Plan-only mode; runway, drivers, investor reporting |
| **Enterprise (regulated, non-US)** | ✅ | Data sovereignty buyers; offline; audit-ready |

## 6. DIFFERENTIATION (what we do that others don't)

| Capability | Anaplan/Adaptive/Pigment | Vena/Datarails/Cube | OneFP&A |
|---|---|---|---|
| Implementation time | 1–6 months | 2–4 weeks | **Hours (first-run wizard)** |
| Works offline, data on own hardware | ❌ | ❌ | ✅ |
| Any industry (config, not code) | Partial | Partial | ✅ 12 packs + pack builder |
| Multi-industry group in one model | Partial | ❌ | ✅ |
| GL Dump from ANY ERP (Tally, SAP, Oracle, etc.) | ❌ | Partial | ✅ equal-first-class |
| Exact money (no float in financial paths) | ❌ (SQL floats) | ❌ | ✅ integer minor units + rust_decimal |
| Full Excel formula compatibility | Partial | ✅ (via Excel) | ✅ native HyperFormula |
| Complete statement suite + SoCE + Segment | Partial | Partial | ✅ |
| Audit-chained trail + auditor export | Partial | ❌ | ✅ HMAC chain, one-click data room |
| License: self-host/offline | ❌ | ❌ | ✅ offline Ed25519 activation |

## 7. SUCCESS CRITERIA (v1.0.0 acceptance)

| Criterion | Target |
|---|---|
| Time from install → first working Budget | < 10 minutes (First-Run Wizard) |
| Monthly process: actuals in → Board Pack out | < 60 minutes per Company |
| Data integrity: accidental wrong number shipped | 0 (Health Check + tie-out gates block export) |
| Import success rate (GL Dump, real files) | ≥ 99% on mapped templates; every failure has an explicit fix path |
| Platform parity | Identical test results on Windows / macOS / Linux |
| Statement reconciliation | Every statement ties to the cent, every period, every BU, every currency |

## 8. NON-GOALS (v1.0.0) — see PRD "NOT BUILDING"

Accounting system of record (journals, AR/AP, payroll, bank reconciliation), tax provision engine, lease accounting, treasury trading, ESG reporting, mobile apps, multi-user collaboration, hosted cloud sync.

---

*Referenced by: PRD.md, USER-PERSONAS.md, USER-STORIES.md, ROADMAP.md, DEFINITION-OF-DONE.md.*
