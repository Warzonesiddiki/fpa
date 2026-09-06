# DESKTOP-PACKAGING.md

> OneFP&A · v0.1.0 · **Native Desktop Packaging, Code Signing & Distribution Architecture (M7-7).**
> Complete operations manual for building, signing, verifying, and distributing OneFP&A installers across Windows, macOS, and Linux. Terms per GLOSSARY.md; Zero-Compromise rules per ZERO-COMPROMISE-RULES.md.

---

## 1. OVERVIEW & PLATFORM TARGETS

OneFP&A packages as a native desktop application powered by Tauri 2 + Rust + React 19 + TypeScript + SQLite. To maintain strict parity and enterprise IT deployment standards across desktop operating systems (B1/B18-8), the packaging configuration produces native installer artifacts for three target families:

| Operating System | Target Packages | Formats & Output | Target Architectures | Primary Use Case |
|---|---|---|---|---|
| **Windows** | `msi`, `nsis` | `.msi` (WiX v4), `.exe` (NSIS) | `x86_64-pc-windows-msvc` | Enterprise GPO/Intune/SCCM (`.msi`); Direct user install (`.exe`) |
| **macOS** | `dmg` | `.dmg`, `.app` bundle | `x86_64-apple-darwin`, `aarch64-apple-darwin` (Universal) | Apple Silicon & Intel Macs; MDM distribution |
| **Linux** | `appimage`, `deb` | `.AppImage`, `.deb` | `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` | Universal portable standalone (`.AppImage`); Debian/Ubuntu apt (`.deb`) |

---

## 2. BUNDLE CONFIGURATION (`src-tauri/tauri.conf.json`)

The desktop packaging metadata is centralized in `src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "OneFP&A",
  "version": "0.1.0",
  "identifier": "com.onefpa.desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "OneFP&A",
        "width": 1280,
        "height": 800,
        "minWidth": 920,
        "minHeight": 600,
        "resizable": true,
        "center": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["msi", "nsis", "dmg", "appimage", "deb"],
    "icon": [
      "icons/32x32.png",
      "icons/64x64.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.png",
      "icons/icon.ico",
      "icons/icon.icns"
    ],
    "publisher": "OneFP&A Contributors",
    "copyright": "Copyright © 2026 OneFP&A Contributors. All rights reserved.",
    "category": "Finance",
    "shortDescription": "Local-first, encrypted, all-industry FP&A",
    "longDescription": "OneFP&A — plan, model, consolidate and report entirely on your machine. GL-Dump-first ingestion for any ERP, Excel-parity formulas, 12 config-driven Industry Packs, audit-grade statements.",
    "resources": ["../packs/**/*", "../assets/demo/**/*"]
  }
}
```

### Key Configuration Directives:
1. **Bundle Identifier**: `com.onefpa.desktop` binds OS keychain items and system preferences.
2. **Company & Copyright**: Publisher is set to `OneFP&A Contributors`; legal copyright notice is embedded in executable metadata and installer manifests.
3. **App Icons**: Complete resolutions provided:
   - Windows: `icons/icon.ico` (multi-size ICO container with 16x16 to 256x256 mipmaps)
   - macOS: `icons/icon.icns` (Retina 1024x1024 Apple Icon Image)
   - Linux / Web: PNG assets (`32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png`, `icon.png`)
4. **Bundled Resources**:
   - `../packs/**/*`: All 12 config-driven Industry Packs (JSON templates for COA, KPIs, Drivers, Layouts).
   - `../assets/demo/**/*`: Read-only Demo Company seed data.

---

## 3. SECURITY & LEAST PRIVILEGE CONTROLS

In accordance with Zero-Compromise rules (B1, B2, B18-4, B18-9) and `SECURITY-CHECKLIST.md`:

### 3.1 Strict Content Security Policy (CSP)
```text
default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'
```
- **No Remote URLs**: The CSP strictly blocks any remote network connections, external scripts, external styles, or unauthorized origins.
- **Local-First Asset Protocol**: Assets are served exclusively through Tauri's internal secure origin (`asset://` or `tauri://localhost`).

### 3.2 Capability Scoping (`src-tauri/capabilities/default.json`)
The application operates on the principle of least privilege:
- **Allowed**: Window management (minimize, maximize, close, resize), native file dialogs (`dialog:default`), system notifications (`notification:default`), global shortcuts, clipboard text read/write for financial grids, OS info, and window state restoration.
- **Forbidden / Blocked**: No generic shell execution (`shell:allow-execute` is omitted), no raw arbitrary filesystem access, and no HTTP client capabilities in the UI webview.

### 3.3 OS Credential Storage & Keychain Integration
- Cryptographic keys (such as the HMAC-SHA256 audit key) and secure session credentials interface with OS credential managers via the `keyring` crate:
  - **Windows**: Windows Credential Manager (`windows-native`).
  - **macOS**: Apple Keychain Services.
  - **Linux**: Secret Service API / `libsecret` via DBus.
- In-memory vault keys are kept in `storage::keys::KeyVault`, zeroised upon locking (`zeroize`).

---

## 4. BUILD PIPELINE & VERIFICATION GATES

Desktop packages must never be compiled without satisfying the strict verification gates.

### 4.1 Automated Build Script (`scripts/build-desktop.mjs`)
The `scripts/build-desktop.mjs` script orchestrates the build process:

```bash
# Run full pre-build verification gates followed by production packaging:
npm run desktop:build

# Or directly via node:
node scripts/build-desktop.mjs

# Build for specific bundle targets (e.g., Windows MSI only):
node scripts/build-desktop.mjs --bundles msi

# Debug build for troubleshooting installer behavior:
node scripts/build-desktop.mjs --debug
```

### 4.2 Gate Execution Order
1. **Gate 1: Full Suite (`npm run check`)**:
   - `eslint` (0 warnings permitted)
   - `typecheck` (`tsc --noEmit`)
   - `vitest` unit and component tests
   - `docs:verify` (documentation consistency and reference integrity)
   - `packs:validate` (ensures industry packs are schema-compliant and contain no executable code)
   - `money:ast` (AST scan ensuring zero IEEE-754 floats in money paths)
   - `security:scan` (scans for credentials, telemetry, and license compatibility)
2. **Gate 2: Rust Verification (`cargo test`)**:
   - Executes all Rust unit, integration, and property tests (statements, formula evaluation, database migrations, cryptographic key unwrapping).
3. **Packaging Phase (`tauri build`)**:
   - Compiles Vite frontend production distribution (`dist/`).
   - Compiles Rust core with `--release` profile.
   - Packages OS-specific installers into `src-tauri/target/release/bundle/`.

---

## 5. CODE SIGNING & NOTARIZATION PREPARATION

To ensure operating system trust filters (Windows SmartScreen, macOS Gatekeeper) do not block or warn users, release binaries must be signed with certified developer credentials.

### 5.1 Windows (Authenticode Signing)
- **Certificate Type**: Extended Validation (EV) or Standard Code Signing Certificate (PFX file or Hardware Security Module / Azure Key Vault / AWS CloudHSM).
- **Environment Variables**:
  ```bash
  # PFX file path and password:
  export TAURI_SIGNING_CERTIFICATE_PATH="C:\certs\onefpa_code_signing.pfx"
  export TAURI_SIGNING_CERTIFICATE_PASSWORD="<certificate_password>"

  # Timestamp Server URL:
  export TAURI_SIGNING_TIMESTAMP_SERVER="http://timestamp.digicert.com"
  ```
- **WiX Installer Configuration**:
  The MSI installer target requires the WiX Toolset v4/v5 installed on the build runner.

### 5.2 macOS (Developer ID & Apple Notarization)
- **Certificate Type**: Apple Developer ID Application certificate.
- **Environment Variables**:
  ```bash
  # Signing identity name:
  export APPLE_SIGNING_IDENTITY="Developer ID Application: OneFP&A (XXXXXXXXXX)"

  # Apple Notarization credentials (App Store Connect API key):
  export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  export APPLE_API_KEY="XXXXXXXXXX"
  export APPLE_API_KEY_PATH="/path/to/AuthKey_XXXXXXXXXX.p8"
  ```
- **Entitlements**: Hardened runtime is enabled by default in Tauri 2 macOS builds. Notarization tickets are stapled to both `.app` and `.dmg`.

### 5.3 Linux (GPG Signatures & Package Verification)
- **AppImage**: Portable bundle with embedded runtime. GPG detached signatures are generated during release.
- **Debian (`.deb`)**:
  Signed using repository GPG keys:
  ```bash
  dpkg-sig -k <GPG_KEY_ID> --sign builder src-tauri/target/release/bundle/deb/*.deb
  ```
- **Checksums**:
  Every CI release generates a `SHA256SUMS` file signed with the official OneFP&A release GPG key.

### 5.4 Tauri Auto-Updater Signing Key
The Tauri updater uses Ed25519 public-key cryptography to verify in-place software update packages:
- **Private Key (`TAURI_SIGNING_PRIVATE_KEY`)**: Stored exclusively as an encrypted GitHub Actions secret.
- **Public Key**: Baked into `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.

---

## 6. RELEASE ARTIFACT VERIFICATION

Before publishing release artifacts:
1. Verify package checksums against `SHA256SUMS`.
2. Inspect package contents to confirm bundled packs (`packs/`) are present and uncorrupted.
3. Test clean installation on a pristine virtual machine for each OS (no existing Node or Rust environment installed).
4. Launch app and verify that S-001 (Welcome / Company Picker) loads without CSP errors in the developer console.
