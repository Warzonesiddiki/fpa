# DEPLOYMENT.md

> OneFP&A · v1.0.0 · **Cross-platform desktop delivery (self-host/enterprise focused).** No cloud service to deploy — the "platform" part is CI packaging + signing + distribution + offline activation. Terms per GLOSSARY.md.

---

## 1. PLATFORM CHOICE & REASONING

| Platform | Choice | Reasoning |
|---|---|---|
| App runtime | **Tauri 2 native** | 10–15 MB installers, native file/keychain/updater, one Rust+TS codebase, offline-first, three-OS parity |
| Signing | per-OS trust chain | Windows Authenticode (EV/OV for enterprise), macOS Developer ID + notarization, Linux package signatures |
| Distribution | self-host: GitHub Releases + signed artifacts + enterprise repo (S3/Artifactory mirror optional) | Self-host/enterprise model chosen (Stage 0); no SaaS; customers download installers or IT deploys via GPO/pkgs |
| Updates | Tauri updater (stable/beta channels, ed25519 signed) | Auto-Update from day one (F-036) |
| Licensing | offline Ed25519 activation (AUTH-SPEC §4) | No cloud dependency for activation |

## 2. EXACT BUILD COMMANDS

```bash
# 1. Dependencies (Node + Rust toolchain required: node>=22, rust>=1.85)
npm ci
cargo fetch

# 2. Full local check (CI-equivalent)
npm run check            # tsc + eslint + vitest + coverage
cargo test && cargo clippy -- -D warnings && cargo audit

# 3. Build UI + core (production)
npm run build            # vite → dist/
cargo build --release --manifest-path src-tauri/Cargo.toml

# 4. Package installers (per OS; run on the target OS runner)
npm run tauri:build      # wrappers: cargo tauri build
# Windows → .msi + .exe (NSIS)   macOS → .dmg + .app (notarized)
# Linux   → .deb + .rpm + .AppImage (x86_64; aarch64 for deb/AppImage)
```

## 3. STEP-BY-STEP RELEASE (GitHub Actions)

1. **Check gate:** full CI green (CI-CD.md §3) on `release/vX.Y.Z` branch.
2. **Bump:** package.json + Cargo.toml + tauri.conf.json version; CHANGELOG entry; `docs-index.json` regenerate.
3. **Sign & package:** job per OS with secrets (§ENV-VARIABLES): Windows signtool PFX; macOS codesign + notarization (stapled); Linux gpg sign deb/rpm + AppImage signing.
4. **Update manifest:** `${VERSION}.json` (sha256 + signature) → GitHub Release assets (updater manifest + installers).
5. **Publish:** draft → smoke test on 3 OS runners (install → unlock → import sample GL dump → statement export).
6. **Announce:** release notes; enterprise customers get checksums file (`SHA256SUMS`) + SBOM + license activation templates.
7. **Rollback:** keep previous release assets; updater rollback documented; `vX.Y.Z-1` channel pinned in `update.channel` settings if needed.

## 4. ENTERPRISE DEPLOYMENT MODES

| Mode | What ships | How IT installs |
|---|---|---|
| Standard installer | MSI/NSIS · DMG · DEB/RPM/AppImage | Manual / SCCM+Intune (Win) / MDM (mac) / apt+rpm (Linux) |
| Portable | AppImage + pre-configured `.fpa`-profile | Copy + launch; no admin needed |
| Offline bundle | Installer + packs + demo company + offline update `.fpa-update` | Air-gapped machine; activation via file exchange |
| GPO/System policy | MSI with transforms (appDir, update channel, telemetry-off already default) | Windows policy; channel pinned |

**Requirements per OS:** Windows 10 22H2+/11, x64; macOS 12+ (universal); Linux glibc 2.31+ x86_64/aarch64 (AppImage/deb). No root required after install (AppImage/user install).

## 5. DATA & MIGRATION SAFETY

1. Company Files are portable: copy `.fpa` + use any OS — migrations run on open (never on copy).
2. First open of an older-version file: pre-migration Snapshot + migration + verified reopen (F-036).
3. Backups are cross-OS compatible (encrypted format versioned).
4. Never overwrite user files on update; updater only replaces app binaries.

## 6. FAILURE HANDLING (deployment-specific)

| Failure | Behavior |
|---|---|
| Installer signature invalid | OS blocks; user downloads from official release only; checksums verified |
| Updater network fail | manual install path; app keeps working (F-036) |
| Update corrupt | signature/sha mismatch → rollback + retry; never partial install |
| Notarization fail (mac) | CI red; release blocked (no unsigned dmg published) |
| License activation offline | file-exchange flow (AUTH-SPEC §4) |
| Keychain missing (Linux) | explicit fallback (INTEGRATIONS §1.5) |

## 7. ENVIRONMENT & SIZING

| Factor | Spec |
|---|---|
| Disk | Installer ≤ 25 MB; app ≤ 120 MB on disk; Company file per GB of GL data |
| RAM | 8 GB min (16 GB recommended for 2M-row models) |
| Network | none required (connectors opt-in) |
| Timezone/DST | handled by Fiscal Calendar engine (Daylight Rule) |

*Referenced by: CI-CD.md, ENV-VARIABLES.md, MONITORING.md, ROADMAP.md.*
