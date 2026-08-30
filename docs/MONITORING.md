# MONITORING.md

> OneFP&A · v1.0.0 · **Local-first = no telemetry (B18-9).** "Monitoring" splits into (a) **app-internal observability** owned by the user (Health Check, diagnostics, audit) and (b) **vendor-side release/infra monitoring** (CI, release integrity, support signal) — all privacy-preserving. No Sentry/analytics by default; if a customer opts in later it's require-adoption-per-customer (DECISIONS.md).

---

## 1. APP-INTERNAL EVENTS (what we track **locally**, user-visible)

| Event | Where stored | User access | Alert threshold |
|---|---|---|---|
| Model Health Check findings | `health_checks`/`health_findings` | S-071 | Any HARD = surface now |
| Import/Tie-Out failures | `import_batches.status` | S-030/032 | fail = banner + alert center |
| Audit chain verification | `audit.events.hash` | S-070 | mismatch = read-only + restore |
| License state transitions | `licenses.status` | S-073 | grace < 30d = banner |
| Backup failures | `backups` | S-074 | fail = alert |
| Connector health | `connectors` + `connector_sync_runs` | S-033 | auth/rate-limit = alert |
| Unlock failures (count) | `pin_metadata` | Security log | ≥3 in 10 min = local notice |
| Storage usage | SQLite `dbstat` + file size | S-074 | >85% of quota |
| Local crash/panic log | `Local Diagnostics` (opt-out area) | S-075 | created = toast once |

**Nothing leaves the machine** — these are for the *user* and their auditor (data-room export), not for us.

## 2. VENDOR-SIDE (privacy-preserving, release infra only)

| Monitor | Tool | Alert threshold | Action |
|---|---|---|---|
| CI test health | GitHub Actions | PR red > 24h | Pager/review |
| Release integrity checksums | `SHA256SUMS` verify job | mismatch = block publish | investigate build/signing |
| Update manifest/signature | updater check (local) | signature fail = notify vendor via release issue (manual) | pull bad release |
| Dependency advisories | `npm audit`/`cargo audit` nightly | HIGH | triage ≤ 24h |
| License activation support load | manual vendor tooling (offline files) | none (privacy) | support SLA |
| Community/support signals | GitHub Issues templates | critical-severity labels | triage SLA (24h critical) |

**No user-level metrics exist** (no product analytics, no crash telemetry, no usage counts) — by design (B18-9). If the vendor later wants adoption metrics, DECISIONS.md ADR + explicit user opt-in is mandatory, and financial values are never included.

## 3. ALERT RULES (app-side, threshold table)

| Rule | Condition | Severity | Action |
|---|---|---|---|
| `cash.floor` | 13-week cash < threshold | warning | Alert Center + optional OS notification |
| `covenant.leverage` | net debt/EBITDA > 3.5x | critical | gauge red + alert + Board Pack note |
| `variance.threshold` | |Δ| > 10% + > ₹1M | warning | alert + reason-code prompt (dedupe 24h) |
| `data.completeness` | BU missing from import at close | warning | close checklist block |
| `license.grace` | < 30 days to expiry | warning | banner + S-073 |
| `backup.idle` | no successful backup > 7 days | warning | S-074 alert |
| `connector.health` | auth/rate-limit failure | warning | S-033 banner (manual fallback reminder) |
| `audit.integrity` | chain verify fail | critical | read-only + restore path |

**Digest:** at most one notification per rule per 24h; alerts retained 90 days; no telemetry of alert contents.

## 4. SLOs (internal, release-gate relevant)

| SLO | Target | Measure |
|---|---|---|
| Start-up success (fresh/recovery paths) | ≥ 99.5% | E2E suite |
| Import success (given valid mapped template) | ≥ 99% | fixture matrix |
| Statement integrity (tie-outs pass on build data) | 100% | oracle tests |
| Update success (signed artifacts) | ≥ 99.9% | release test on 3 OS |
| CI green rate on `main` | ≥ 98% | Actions API |

## 5. INCIDENT & SUPPORT WORKFLOW (no data leaves the machine)

1. User exports Local Diagnostics (sanitized: no money values, no secrets; amounts blanked to `0`/`***`).
2. User attaches diagnostics to a GitHub issue template (contains no finance data).
3. Vendor triages; escalation SLA: Critical 24h / High 72h / Medium 14d.
4. Follow-ups: fix + regression test + release note; no data retention on vendor side beyond the issue.

*Referenced by: SECURITY-CHECKLIST.md, QA-CHECKLIST.md, CI-CD.md, KNOWN-ISSUES.md.*
