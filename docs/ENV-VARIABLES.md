# ENV-VARIABLES.md

> OneFP&A · v1.0.0 · **There is NO runtime `.env`** (B1 — no server, no cloud, B18-9 — no telemetry).
> This table covers **build/CI variables** (GitHub Actions secrets/vars) and **rare dev-only toggles**. Runtime configuration is stored in the app (`settings` table) or OS keychain — never in environment files shipped to users.

---

## 1. CI / BUILD (GitHub Actions secrets & vars)

| Name | Purpose | Example value | Required | Used by |
|---|---|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Ed25519 private key for updater-signed artifacts | base64 (env, never printed) | **Yes** (release builds) | tauri updater signing |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the signing key | (secret) | Yes | updater |
| `MACOS_CERTIFICATE` | Developer ID Application `.p12` base64 | (secret) | Yes (macOS release) | codesign |
| `MACOS_CERTIFICATE_PASSWORD` | `.p12` password | (secret) | Yes | codesign |
| `MACOS_NOTARIZATION_APPLE_ID` | Apple ID for notarization | `vendor@example.com` | Yes | notarize |
| `MACOS_NOTARIZATION_TEAM_ID` | Apple Developer Team ID | `ABCDE12345` | Yes | notarize |
| `MACOS_NOTARIZATION_PASSWORD` | App-specific password | (secret) | Yes | notarize |
| `WINDOWS_CERTIFICATE` | PFX (VS code-signing cert) base64 | (secret) | Yes (Windows release) | signtool |
| `WINDOWS_CERTIFICATE_PASSWORD` | PFX password | (secret) | Yes | signtool |
| `LINUX_SIGNING_KEY` | GPG/dpkg-sig key for deb/rpm | (secret) | Recommended | package signing |
| `UPDATE_ENDPOINT` | GitHub Releases endpoint for updater (default: own repo) | `https://github.com/onefpa/onefpa/releases` | No (default set) | updater plugin |
| `LICENSE_VENDOR_PUBKEY` | Ed25519 pubkey (base64) used to verify license payloads | (public, built in) | No — compiled default | license.rs |
| `BUNDLE_ID` / `PRODUCT_NAME` | Tauri app identifier/product name | `com.onefpa.desktop` / `OneFP&A` | No — tauri.conf.json | build |
| `SENTRY_DSN` | **Forbidden** — no telemetry (B18-9). Do not add. | — | Never | — |

## 2. DEV-ONLY (never in production builds)

| Name | Purpose | Example | Where |
|---|---|---|---|
| `VITE_DEV_SERVER_PORT` | Local webview dev server port | `5173` | vite.config (default) |
| `ONE_FPA_DEV_MODE` | Enables devtools + demo pack hot-reload | `1` | build.rs / vite define |
| `RUST_LOG` | Rust logging verbosity (dev only; redaction always on) | `onefpa_core=debug` | env_logger |
| `CI_SANDBOX_MODE` | Marks sandbox CI (network-off) so keychain/browser tests adapt explicitly — never silently skip | `1` | e2e config |

## 3. RUNTIME CONFIG (in-app, `settings` table — NOT env)

| Key | Type | Default | Purpose |
|---|---|---|---|
| `app.theme` | `'system'/'light'/'dark'` | system | Theme |
| `app.density` | `'compact'/'comfortable'` | comfortable (<1100px) | Grid density |
| `app.autoLockMinutes` | int 1–60 | 5 | Auto-lock |
| `format.negativeStyle` | `'paren'/'minus'` | paren | Accounting format |
| `format.thousandSeparator` / `decimalSeparator` | locale | derived | Locale formats |
| `format.displayThousands` | bool | true | 000s default |
| `storage.backupRetentionDays` | int | 30 | Backup rotation |
| `updates.channel` | `'stable'/'beta'` | stable | Update channel |
| `alerts.digestEnabled` | bool | true | Alert digest |
| `import.templateDir` | path | user dir | Default import dir |

## 4. RULES (binding)

1. No `.env` file, no `dotenv`, no `process.env` reads in shipped code paths (lint rule).
2. Secrets only in: CI secrets (build), OS keychain (runtime), bundled signing keys (public).
3. `git grep -r "process.env" src src-tauri` in CI must return only dev-server whitelist entries.
4. Every new variable added here gets: name → purpose → example → required Y/N → which service uses it (this table's columns), plus an audit note in DECISIONS.md.

*Referenced by: DEPLOYMENT.md, CI-CD.md, SECURITY-CHECKLIST.md.*
