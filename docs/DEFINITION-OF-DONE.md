# DEFINITION-OF-DONE.md

> OneFP&A · v1.0.0 · **A feature is NOT done until EVERY item below is checked** (QA-CHECKLIST B1–B8 + feature-specific + gates). No partial credit; "merged but not done" is not done.

---

## 1. FEATURE DONE CHECKLIST (per PRD feature)

- [ ] **Spec complete:** PRD feature (tag MVP/V2/FUTURE) + glossary terms + screens (SCREENS-SPEC) + stories (USER-STORIES) + API commands (API-SPEC) + DB tables/columns (DATABASE-SCHEMA) all reference **this feature** — no orphan.
- [ ] **All 5 states** implemented (loading/empty/error/success/populated) with exact texts.
- [ ] **All error paths** return codes from ERROR-HANDLING.md; UI renders `userMessage`; retry policy honored; no raw errors.
- [ ] **Money correctness:** zero float in paths (`money:ast`); exact tests (rounding, tie-outs, to-the-cent assertions); no `n/a` shown as 0.
- [ ] **QA-CHECKLIST feature-specific items** (8 per feature) all pass.
- [ ] **Tests:** unit + integration + (where flow) E2E; coverage targets met (≥85% TS, ≥95% engines); failure-first regression exists for any bug fixed.
- [ ] **Accessibility:** axe 0; keyboard-only path works; contrast tokens; no color-only; 200% zoom verified.
- [ ] **Performance:** meets the metric in PERFORMANCE-REQUIREMENTS; bench regression ≤ 10%.
- [ ] **Security:** no secrets; no injection risk; capability least-privilege; audit event on every mutation; threat-model row verified if surface changed.
- [ ] **Audit & traceability:** every number drillable to source (B18-1) OR explicitly documented exception.
- [ ] **Docs synced:** terms in GLOSSARY (used verbatim); PRD/API/ERROR updated if changed; docs-index regenerated; CHANGELOG updated (release-affecting).
- [ ] **Localization baseline:** locale-aware formatting; English strings centralized (i18n file).

## 2. FEATURE NOT DONE IF ANY OF THESE ARE TRUE (traps)

| Trap | Rule |
|---|---|
| "Works in my machine" | 3-OS CI evidence required (B18-8) |
| "Tests pass locally" | CI green on PR head required |
| "UI looks fine" | screenshot + a11y + keyboard E2E evidence required |
| "We'll add error handling later" | all states/errors in same PR (B18-5/6) |
| "Should be fine" for numbers | oracle/tie-out tests mandatory (B18-1) |
| "Docs will be updated" | docs updated in the same PR (B8) |
| "Almost done — just needs X" | not done — no partial merge without visible TODO entry |
| "Demo data proves it" | production path uses real schema/persistence (B18-3) |

## 3. RELEASE DONE CHECKLIST (v1.0.0)

- [ ] 38 MVP features individually Done (this file tracks checkboxes per feature in the board)
- [ ] CI 12-stage green on main; branch protection enforced
- [ ] 3-OS packaging + signing + notarization verified (DEPLOYMENT §3)
- [ ] E2E 14 flows × 3 OS; P0 evidence package
- [ ] Perf budgets met (PERFORMANCE-REQUIREMENTS); bench history archived
- [ ] a11y sweep 0 violations; dark theme; 200% zoom
- [ ] Security: audits HIGH=0; threat model sign-off; secrets scan clean
- [ ] Demo Company + 12 packs + sample GL dump QA'd
- [ ] Release notes + CHANGELOG + SHA256SUMS + SBOM published
- [ ] Docs audit Stage 3/4 complete (traceability PASS; build-readiness YES)

## 4. V2 ("DEFERRED BY DESIGN") — NOT the same as done

- V2 items are documented in PRD §3 + TODO V-backlog + this file §1 does **not** apply until their milestone.
- Nothing in v1.0.0 may be "half-V2": a v1.0.0 feature is complete or it is not shipped (B20).

*Referenced by: ROADMAP.md, QA-CHECKLIST.md, CI-CD.md, DOCS-INDEX.md.*
