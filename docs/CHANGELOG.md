# CHANGELOG.md

> OneFP&A · Kept in Keep-a-Changelog format. Versions follow semver. Releases: v1.0.0+.

## [Unreleased]
### Added
- Specification suite (37 documents) — see `docs/DOCS-INDEX.md` for the complete map.
- First-run Wizard, Industry Pack library (12 packs), GL-Dump-first ingestion pipeline, Excel-compatible formula grid, driver-based modeling, scenarios/versions, consolidation engine, statement suite, audit trail, offline licensing — all specified, none yet implemented (implementation starts per `docs/ROADMAP.md`).

### Changed
- (none yet)

### Fixed
- (none yet)

## [0.1.0] — 2026-08-30
### Added
- `docs/` specification suite initialized:
  - Stage 0: Deep analysis + research baseline (market, industries, scenarios, conglomerate support, zero-compromise rules B1–B20) — summarized in `docs/DECISIONS.md`
  - Stage 1: `GLOSSARY.md` — terminology lock (12 sections, ~150 terms, 10 invariants, BANNED-synonym list)
  - Stage 2 Phase 1: `PROJECT-BRIEF.md`, `PRD.md`, `USER-PERSONAS.md`, `USER-STORIES.md`
  - Stage 2 Phase 2: `DESIGN-SYSTEM.md`, `SCREENS-SPEC.md`, `USER-FLOWS.md`, `COMPONENT-LIBRARY.md`, `RESPONSIVE-DESIGN.md`, `ACCESSIBILITY.md`
  - Stage 2 Phase 3: `TECH-STACK.md`, `ARCHITECTURE.md`, `DATABASE-SCHEMA.md`, `API-SPEC.md`, `AUTH-SPEC.md`, `STATE-MANAGEMENT.md`, `INTEGRATIONS.md`, `ERROR-HANDLING.md`
  - Stage 2 Phase 4: `CLAUDE.md`, `CODING-STANDARDS.md`, `GIT-STANDARDS.md`
  - Stage 2 Phase 5: `TESTING-STRATEGY.md`, `QA-CHECKLIST.md`, `PERFORMANCE-REQUIREMENTS.md`, `SECURITY-CHECKLIST.md`
  - Stage 2 Phase 6: `ENV-VARIABLES.md`, `DEPLOYMENT.md`, `CI-CD.md`, `MONITORING.md`
  - Stage 2 Phase 7: `README.md` (root), `CHANGELOG.md`, `TODO.md`, `KNOWN-ISSUES.md`, `DECISIONS.md`
  - `README.md` quickstart (root)

### Security
- Zero telemetry by design (B18-9); secrets policy defined; threat model documented (`SECURITY-CHECKLIST.md`).

<!-- Template: ## [x.y.z] — date | Added / Changed / Fixed / Removed / Security -->
