# RELEASE-CHECKLIST.md

> OneFP&A · v1.0.0 · **The pre-release sign-off checklist** — superset of DEFINITION-OF-DONE §3, tied to DEPLOYMENT.md step-by-step. Version under test: `vX.Y.Z`. Every box = named owner + evidence (CI output, fixture result, artifact hash).

---

## 1. CODE & QUALITY

- [ ] All 38 MVP features individually Done (DEFINITION-OF-DONE §1) — matrix in FEATURE-TRACEABILITY-MATRIX
- [ ] CI 12-stage pipeline green on `release/vX.Y.Z` (CI-CD.md §2) — evidence link to run
- [ ] Coverage: engines ≥95% lines/90% branch; TS ≥85/80; critical modules ≥95% — coverage JSON attached
- [ ] E2E: 8 P0 flows (UF-001/002/003/005/006/010/011/012) pass on Windows, macOS, Linux — traces attached
- [ ] a11y: axe 0 × all screens × 5 states; keyboard flow; 200% zoom; reduced-motion — reports attached
- [ ] Perf suite within budget (PERFORMANCE-REQUIREMENTS) + bench history ≤10% regression
- [ ] Money: `money:ast` 0 violations; oracle statements/consolidation/calendar fixtures pass
- [ ] Schema: migration forward + rollback tests; schema-equality check; no REAL money columns
- [ ] Zero-mock-data audit: no production path loads fixtures (scripts/mock-data-audit)
- [ ] Docs: `docs:verify` (index/links/glossary) + BANNED-word scan pass

## 2. SECURITY

- [ ] `npm audit` + `cargo audit` HIGH=0; license gate (no GPL/AGPL); SBOM generated (CycloneDX)
- [ ] Secrets scan + telemetry scan clean; capability manifest least-privilege verified
- [ ] Crypto tests: Argon2id vectors, AES-GCM round-trip, Ed25519 accept/reject, HMAC chain tamper
- [ ] Threat model reviewed for changed surface (SECURITY-CHECKLIST §5 checkbox) — signed off
- [ ] Release keys present in CI secrets; signing identity valid (not expired); no unsigned artifacts published

## 3. BUILD & DISTRIBUTION

- [ ] Version bumped in package.json + Cargo.toml + tauri.conf.json (same value)
- [ ] Installers: MSI/NSIS (Win) · DMG notarized + stapled (mac) · DEB/RPM/AppImage signed (Linux) — all 3 built on CI
- [ ] Update manifest (`vX.Y.Z.json`) generated + Ed25519 signed; `SHA256SUMS` generated
- [ ] Smoke test on all 3 OS: install → unlock → import sample GL dump → statement export → Health Check green
- [ ] Rollback plan verified (previous release assets intact; updater rollback documented)
- [ ] Offline bundle (installers + packs + demo Company + `.fpa-update`) assembled for air-gap customers

## 4. PRODUCT & DOCUMENTATION

- [ ] Demo Company + 12 packs + sample GL dump QA'd (load, wizard, import, export)
- [ ] CHANGELOG.md updated (Keep-a-Changelog); release notes drafted (user-facing: what's new, how to upgrade, known limitations)
- [ ] DOCS-INDEX regenerated; README quickstart re-verified against actual commands
- [ ] KNOWN-ISSUES triaged: no open Critical/High without disposition; new items logged
- [ ] License activation templates + vendor signing tool verified (offline path)
- [ ] Support pack: Local Diagnostics guidance, recovery guide (DR-RECOVERY-RUNBOOK §5), contact path

## 5. GATES (STOP conditions — release does not proceed)

- [ ] No Critical/High open security or data-integrity issue
- [ ] No unsigned/untested artifact in the release set
- [ ] No unverifiable claim in release notes (every stat traceable to CI evidence)
- [ ] No skipped tests or `continue-on-error` in the release pipeline (B18-7)

## 6. SIGN-OFF

| Role | Name | Date | Evidence |
|---|---|---|---|
| Engineering owner | — | — | CI run link |
| Security owner | — | — | security gates run |
| QA owner | — | — | E2E/a11y/perf reports |
| Product owner | — | — | CHANGELOG + notes review |

**Post-release (24 h):** verify update manifest served, checksums match, install on one clean machine per OS, monitor GitHub issue intake; if any Critical emerges → SECURITY-INCIDENT-RESPONSE (Critical SLA 24 h).

*Referenced by: DEPLOYMENT.md, CI-CD.md, DEFINITION-OF-DONE.md, ENV-VARIABLES.md.*
