# CONNECTOR-DATA-DICTIONARY.md

> OneFP&A · v1.0.0 · **Per-provider pulled objects, exact endpoints, pagination, field → Canonical GL Template mapping, and supported-scope table (F-009).** All adapters output `NormalizedRow` → same pipeline as Manual Import (B19 guarantee). Contract tests use recorded payload fixtures (TEST-FIXTURES-SPEC §2).

---

## 1. SHARED ADAPTER OUTPUTS (what every provider must produce)

| Output object | Canonical fields | GL Template |
|---|---|---|
| `ExternalAccount` | external_id, code, name, type (mapped), parent_id, is_active | COA sheet |
| `ExternalTransaction` | fs_period, account_code, debit_minor, credit_minor, cc, project, customer, cost_center, posting_ref, doc_type, currency | GL sheet |
| `ExternalBudget` | fy_label, account_code, period_no, amount_minor, dimension values | Budget bootstrap |
| `ExternalDimension` | key, code, name, parent_code | Dimensions sheet |

Provider-specific field → canonical mapping is declared per adapter (table below) and covered by a fixture test that asserts exact output for recorded payloads.

## 2. QUICKBOOKS ONLINE

| Item | Spec |
|---|---|
| Auth | OAuth 2.0 + PKCE; scopes `com.intuit.quickbooks.accounting`; refresh 100 days |
| Base URL | `https://quickbooks.api.intuit.com/v3/company/{realmId}` |
| Accounts | `GET /account?minorversion=75&limit=1000` (type map: Bank→Asset, Other Current Asset→Asset, Fixed Asset→Asset, Expense→Opex, Income→Revenue, Cost of Goods Sold→COGS, Other Expense→Opex, Equity→Equity, Accounts Payable→Liability, Credit Card→Liability, Other Current Liability→Liability) |
| Transactions | Reports API `GET /reports/JournalReport?start_date=&end_date=&accounting_method=Accrual` (paginated by `startPosition`/`maxResults=1000`) + `GET /journalentry` when report limits hit |
| Budgets | `GET /budget` (annual/quarterly) |
| Pagination | cursor `startPosition`; page size 1000; rate 100 req/15s |
| Known limits | JournalReport max 5 years deep, 10k rows/report → fallback to journalentry; memo/class mapping optional |

## 3. XERO

| Item | Spec |
|---|---|
| Auth | OAuth 2.0 + PKCE; scopes `accounting.transactions accounting.settings`; refresh 60 days |
| Base URL | `https://api.xero.com/api.xro/2.0` |
| Accounts | `GET /Accounts` (type map: REVENUE→Revenue, DIRECTCOSTS→COGS, EXPENSE→Opex, CURRENTASSET/FIXEDASSET/NONCURRENTASSET→Asset, CURRENTLIABILITY/NONCURRENTLIABILITY→Liability, EQUITY→Equity) |
| Transactions | `GET /Journals?offset=0&page=1&paymentsOnly=false` (date-filtered, paginated `page` + `offset`; 60 req/min) |
| Budgets | `GET /Budgets` (requires Advanced subscription → `CONNECTOR_SCOPE_UNAVAILABLE` warning; Manual Import fallback) |
| Notes | JournalLine includes `SourceJournalLineID` (dedupe key), `TrackingCategories` → Dimensions; currency per line |

## 4. NETSUITE (SuiteTalk REST / RESTlet)

| Item | Spec |
|---|---|
| Auth | OAuth 1.0a TBA: consumer key/secret + token/secret, HMAC-SHA256; per-integration token |
| Base URL | `https://{accountId}.suitetalk.api.netsuite.com/services/rest/record/v1` |
| Accounts | `GET /account` (fields: `acctName`, `acctNumber`, `acctType` — map via SuiteTax/expense/revenue tables; `subsidiary`, `custdim` segments) |
| Transactions | `GET /journalEntry` (pagination `pageSize=1000`, `offset`); plus `GET /vendorBill`, `GET /customerPayment` when journalEntry doesn't cover a posting type |
| Budgets | `GET /budget` (requires Budget module permission; else Manual) |
| Segments | `GET /department`, `/class`, `/location`, `/subsidiary` → Dimensions |
| Limits | ~15 concurrent requests per account; 429 → backoff 2s→4s, pause after 2 attempts |

## 5. SAGE (Sage Intacct / 200 / 300 / X3 adapters)

| Item | Spec |
|---|---|
| Auth | OAuth 2.0 client-credentials (Intacct Web Services auth via session key for XML API; OAuth for cloud) — per variant `AuthFlow` |
| Base URLs | Intacct: `https://api.intacct.com/ia/xml/xmlgw.phtml`; X3: `https://{tenant}.prod.apirest.sage.com` |
| Accounts | `GLACCOUNT` table / `generalLedger/accounts` |
| Transactions | `GLENTRY` (XML API, `filter` by `POSTEDDATE`, `limit=1000`, `offset`) / `generalLedger/entries` |
| Budgets | `GLBUDGET` (Intacct); X3 budgets via `budgets` endpoint (scope-limited → Manual fallback) |
| Limits | ≤10 req/s default; retry 3 (1s→3s), pause on 429 |

## 6. SCOPE & FALLBACK MATRIX (exact — displayed in Connector UI)

| Provider | COA | Actuals | Budgets | Dimensions | Fallback if any scope missing |
|---|---|---|---|---|---|
| QuickBooks Online | ✅ | ✅ (JournalReport + JE) | ✅ | ⬜ (class/memo → mapping only) | Manual Import (QBO report export) |
| Xero | ✅ | ✅ (Journals) | ⚠️ Advanced plan | ✅ (Tracking) | Manual Import |
| NetSuite | ✅ | ✅ | ⚠️ module perm | ✅ (dept/class/loc/subsid) | Manual Import (SuiteAnalytics CSV) |
| Sage | ✅ | ✅ | ⚠️ scope-dependent | ⬜ (client-specific) | Manual Import |

`CONNECTOR_SCOPE_UNAVAILABLE` is a WARNING-level provider status (code added to ERROR-HANDLING.md E/F as `CONNECTOR_SCOPE_UNAVAILABLE`); the connector continues with available scopes; user can "Use Manual Import" for the missing scope — never a blocked import.

## 7. NORMALIZATION & CONTRACT TESTS

1. Every adapter declares `CAPABILITY: {accounts, actuals, budgets, dimensions}`.
2. Contract test per provider uses **recorded fixtures** (`tests/fixtures/connectors/qbo/*.json` etc.) → asserts exact `NormalizedRow[]` (currency minor units, canonical types, period mapping).
3. Adversarial fixtures: malformed payload, missing required field, rate-limit 429, expired token, 2-page pagination — all produce typed `ConnectorError` (never `INTERNAL`).
4. Network is disabled in CI contract tests (fixture replay only) — no live calls in test.

*Referenced by: INTEGRATIONS.md, API-SPEC connector.*, ERROR-HANDLING F, TEST-FIXTURES-SPEC.*
