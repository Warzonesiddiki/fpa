# Security Policy

> **Pointer file.** The canonical security documentation lives in `docs/`:

- **Reporting a vulnerability:** [`docs/SECURITY-INCIDENT-RESPONSE.md`](docs/SECURITY-INCIDENT-RESPONSE.md) — disclosure handling, severity ladder, response SLAs
- **Threat model & controls:** [`docs/SECURITY-CHECKLIST.md`](docs/SECURITY-CHECKLIST.md)
- **Recovery:** [`docs/DR-RECOVERY-RUNBOOK.md`](docs/DR-RECOVERY-RUNBOOK.md)
- **Known issues:** [`docs/KNOWN-ISSUES.md`](docs/KNOWN-ISSUES.md)

## Short version

OneFP&A is an offline-first desktop application: financial data never leaves the machine
except through user-initiated exports. Secrets live in the OS keychain, databases are
sealed `.fpa` containers with HMAC-chained audit logs, and the codebase is gated against
telemetry (`telemetry-scan`) and leaked credentials (`secret-scan`) on every CI run.

**Do not open public issues for security findings.** Use GitHub's private vulnerability
reporting on this repository, or the process in the incident-response doc above.
