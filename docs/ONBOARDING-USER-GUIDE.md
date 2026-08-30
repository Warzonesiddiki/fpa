# ONBOARDING-USER-GUIDE.md

> OneFP&A · v1.0.0 · **Task-based user guide** (per persona — Ravi/Priya/Alex, USER-PERSONAS.md). Designed for a finance user, not a developer; every step references a screen ID so it stays accurate.

---

## 1. FIRST 10 MINUTES (all users)

1. Install (official installer or portable AppImage). Launch → **S-001 Unlock**.
2. **S-002 First-Run Wizard** — 5 steps: Company name → Industry Pack → Calendar → COA → Model.
   - Plan-Only? Yes, if you have no Actuals yet (you can attach them later — US-009).
3. Set your PIN + **write down the Recovery Phrase** (S-072/D-007) — this is the only recovery path (KI-001).
4. Land on **S-010 Dashboard**. Click "?" on any KPI card to see how it's computed (KPIExplainer).

## 2. RAVI (Manufacturing — GL Dump first)

**Day 1**
1. **S-030 Import Hub → GL Dump** → drop the SAP export.
2. **S-031 Mapping Wizard**: choose "SAP GL dump" mapping template (or map once → save as template).
3. Preview → **S-032 Tie-Out** → check debits = credits (₹0.05 diff? Exclude-with-log, never silent) → **Commit**.
4. **S-021 COA** — confirm accounts/types; **S-022 Calendar** — confirm FY April.
5. **S-043 Drivers**: Units, Price, Scrap %, Utilization, FTEs (≤ 7 core).
6. **S-044 Assumptions**: wage_inflation, copper price (register refs — don't hardcode).
7. **S-041 Revenue sheet**: method = Driver → `units * price`. Watch everything cascade.
8. **S-046 Capital/Debt**: capex ₹40M, 10-yr SL; loan ₹25M 6.5%; **13-Week Cash** appears.
9. **S-064 Board Pack** → generate → export PDF.

**Monthly close (60 min)**
1. **S-053 Close Checklist**: all BUs imported, tie-outs pass, Health Check green.
2. **S-054 Variance**: 3-Way (Plan/Commit/Actuals) + Attribution (volume/price/mix) → add Reason Codes + narrative.
3. **S-060 Statements** → GAAP preset, 000s → export Excel + PDF.
4. **S-070 Audit** → "export Data Room" for the auditor.

## 3. PRIYA (Group CFO — 5 BUs, mixed data)

**Setup (once)**
1. **S-020 Companies** → create Group Company.
2. **S-021 COA/Business Units**: add 5 BUs — Manufacturing (EUR, 4-4-5), Retail (GBP, **4-5-4**), Hospital (USD), SaaS (USD), Asset Mgmt (USD).
3. **S-022 Calendar** → per-BU presets → **Transit Period map** (retail P06 spans group P05–P06 — explicit).
4. **S-061/S-060 group scope** → Group Rollup Maps per BU; FX rates table; IC Tags in mapping.

**Monthly**
1. Import per BU (dumps or **S-033 Connectors**); **S-034 Reconciliation** cross-check.
2. **Consolidation → run** → IC Tie-Out Check (unmatched IC blocks), NCI on the 80% BU, FX to OCI, Group BS ties.
3. **S-061 Segment Report** + statements + **S-064 Board Pack** (segment page).
4. Every group number: click → BU → Account → GL Line (drill-down, B18-1).

## 4. ALEX (Startup — Plan-Only, investor reporting)

1. Wizard: Plan-Only + SaaS Pack (no Actuals yet) → 3-year horizon.
2. **S-043 Drivers**: reps × quota × attainment, churn, ARPU, CAC. Runway + 13-week cash appear.
3. **S-050 Scenarios**: Base → Approve → Lock (Version); duplicate "Upside" (reps 6→8).
4. **S-052 What-If**: Sensitivity tornado + Goal Seek (reps for ₹300M revenue).
5. **S-051 Compare**: Base vs Upside — cell diff → export.
6. **S-055 FVA** (month 4+): score forecasts vs Actuals.
7. Investor pack: **S-064** → PDF; every KPI has an explainer (no "what does NRR mean?" in the boardroom).

## 5. DAY-90 (attach Actuals without rebuilding)

1. **S-030** import QBO/CSV Actuals + **Opening Balances** → same model, drivers untouched.
2. Dashboard now shows Actuals; Variance works; label changes from PLAN_ONLY to HYBRID (labeled, MODELING-METHODS-SPEC §5).
3. **S-055 FVA** starts scoring from the first 3 Forecast Versions.

## 6. DAILY DOs / DON'Ts

| Do | Don't |
|---|---|
| Reference Assumptions (never type a rate into a cell) | Hardcode inflation/rates (Health Check flags) |
| Import rather than edit Actuals (batches are immutable) | Type over Actuals |
| Lock approved Scenarios (creates Version) | Edit a locked scenario (blocked — create Version) |
| Run Health Check before export | Export while red (blocked) |
| Backup + write passphrase elsewhere | Store passphrase in the same folder as the backup |
| Use Reason Codes on every large variance | Leave an unexplained ₹50K variance (Board Pack needs commentary) |

## 7. HELP & SUPPORT

- `F1` anywhere (S-076); `/help/glossary` mirrors GLOSSARY.md.
- `Ctrl+K` global search (S-003).
- Errors: in-app error reference (Help → Error reference) — never raw messages.
- Issues: GitHub issue + **Local Diagnostics** export (sanitized; no financial data, B18-9).

*Referenced by: README.md, USER-PERSONAS.md, SCREENS-SPEC, F-038.*
