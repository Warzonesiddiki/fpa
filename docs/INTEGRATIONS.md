# INTEGRATIONS.md

> OneFP&A · v1.0.0 · **Every 3rd-party service: purpose · required env/credentials · rate limits · fallback behavior.** No cloud dependency at runtime (B18-9): connectors are opt-in, everything else is OS-level.

---

## 1. INTEGRATION INVENTORY

| # | Integration | Direction | Purpose | Auth / secret | Rate limits | Fallback if fails |
|---|---|---|---|---|---|---|
| 1 | **QuickBooks Online** (connector) | Inbound | Actuals, COA, budgets, invoices | OAuth 2.0 PKCE, refresh 100d (keychain) | 100 req/15s per app (+32/s per user); query limits 1,000 rows/page | Manual Import (GL Dump from QBO export) — always available |
| 2 | **Xero** | Inbound | Transactions, accounts, contacts, budgets | OAuth 2.0 PKCE, refresh 60d | 60 req/min; 1,000 rows/page | Manual Import |
| 3 | **NetSuite** (SuiteTalk REST/TBA) | Inbound | Accounts, transactions, budgets, segments | OAuth 1.0a TBA, HMAC-SHA256; token per integration | ~15 concurrent API calls; search limits per account | Manual Import (NetSuite CSV export) |
| 4 | **Sage** (Sage 200/300/Intacct-style adapters) | Inbound | GL, accounts, budgets (per product variant) | OAuth 2.0 client-credentials/keychain | Provider-specific (≤ 10 req/s default) | Manual Import |
| 5 | **OS Credential Store** (keyring) | Inbound/out | Token storage only | OS-backed (no env var) | N/A | Linux fallback: encrypted local store with user passphrase (explicit warning, never plaintext) |
| 6 | **OS Browser** | Outbound | OAuth consent | N/A | N/A | "Copy URL" fallback; callback returns via loopback |
| 7 | **OS File Dialogs / Notifications** | Outbound | File pick, saves, alerts | N/A | N/A | In-app notification center always works |
| 8 | **GitHub Releases (updater)** | Inbound | Signed app updates + packs | Public endpoint; release assets ed25519-signed | GitHub standard (~60 req/hr unauthenticated) | User downloads installer manually; offline update via `.fpa-update` file |
| 9 | **System fonts** | Inbound | Inter/JetBrains Mono (bundled) | Bundled woff2 | N/A | OS fallback stacks (DESIGN-SYSTEM §2.1) |
| 10 | **Local filesystem** | Inbound/out | Company File, vault, backups, exports | N/A | N/A | Error surfaced; never silent |
| 11 | **Optional live FX (V2)** | Inbound | Rate feeds (ECB/IMF) | opt-in, no default | 1/day default | Manual rate entry + stored rates |

**No telemetry/analytics/cloud API exists** (B18-9). `Local Diagnostics` export is user-triggered and contains no financial values.

---

## 2. CONNECTOR ADAPTER CONTRACT (`connectors/adapter.rs`)

```text
trait IngestionAdapter {
  fn provider() -> ProviderKey;                      // quickbooks_online | xero | netsuite | sage
  fn auth_flow() -> AuthFlow;                        // oauth2_pkce | oauth1_tba
  fn fetch_accounts(&self, cursor) -> Page<Account>;
  fn fetch_transactions(&self, from, to, cursor) -> Page<GlLineDraft>;
  fn fetch_budgets(&self, fy) -> Page<BudgetDraft>;
  fn normalize(draft) -> Result<NormalizedRow, ConnectorError>;
}
```

- All adapters output `NormalizedRow` → same pipeline as Manual Import (map → validate → tie-out → commit as Import Batch).
- Pagination/cursor handled per provider; `rate_limiter` (bucket, per-provider config) wraps every call.
- Circuit breaker: 3 consecutive failures → paused + `CONNECTOR_RATE_LIMITED`; UI offers retry or Manual Import; no partial commits (commit is all-or-nothing → Import Batch).

## 3. RATE LIMIT & RETRY POLICIES (exact)

| Provider | Limit (request) | Retry | Backoff | Pause condition |
|---|---|---|---|---|
| QBO | 100/15s per app | 3 | exponential 1s→2s→4s | 429 on 3rd retry → paused |
| Xero | 60/min | 3 | 1s→2s→4s | 429/503 3rd → paused |
| NetSuite | 15 concurrent | 2 | 2s→4s | 429/too many requests 2nd → paused |
| Sage | 10/s | 3 | 1s→3s | 429 3rd → paused |

User-facing messages (exact): `CONNECTOR_RATE_LIMITED` → "Your provider is rate-limiting requests. Sync paused — retry in ~{minutes} or switch to Manual Import." `CONNECTOR_NETWORK` → "Could not reach {provider}. Check connection. Nothing was lost — Manual Import remains available."

---

## 4. ENV / SECRETS (no `.env` in product)

| Secret/Config | Storage | Required | Notes |
|---|---|---|---|
| QBO client id/secret | keychain (vendor app config) + `app.config.json` (dev) | Only to enable QBO connector | Not in repo |
| Xero client id/secret | keychain + dev config | Only Xero | Not in repo |
| NetSuite consumer key/secret + token/secret | keychain + dev config | Only NetSuite | Not in repo |
| Sage client id/secret | keychain + dev config | Only Sage | Not in repo |
| Update public key | bundled in binary (ed25519 pubkey) | Yes (auto-update verify) | In `tauri.conf.json` |
| License verify public key | bundled in binary | Yes | In `license.rs` |
| HMAC audit key | generated per Company, stored in Rust keyring (never in DB) | Yes (audit integrity) | Rotate with backup/restore |

**Rule:** no secret ever lives in the Company SQLite DB; keychain entries are named `com.onefpa.conn.<provider>`.

---

## 5. FAILURE MATRIX (what happens when each integration is down)

| Integration down | App behavior | Data safety |
|---|---|---|
| Connector providers | App fully functional; sync shows error card; Manual Import works | No data loss; previous batches intact |
| OS keychain | Connectors unavailable; local encrypted fallback (Linux) with warning; PIN/encryption unaffected | Credentials never plaintext |
| Updater (GitHub) | No auto-update; manual install; app full-featured | — |
| File system | I/O errors surfaced per op; snapshots prevent partial writes | Company intact |
| Network (none) | 100% offline functionality (design) | — |

*Referenced by: ENV-VARIABLES.md, DEPLOYMENT.md, ERRORS/ERROR-HANDLING.md, SECURITY-CHECKLIST.md.*
