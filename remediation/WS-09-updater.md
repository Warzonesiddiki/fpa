# WS-09 · Updater: real signing keys or disable it

**Priority:** Phase C. **Decision:** D7. **Finding:** `src-tauri/tauri.conf.json` sets
the updater `endpoints` to `github.com/Warzonesiddiki/fpa/releases/...` but
`"pubkey": ""`. A Tauri updater with an empty public key cannot verify update
signatures — shipping it is a security hole (an attacker-served update could be accepted).

## Objective

Either (preferred) configure a real Ed25519 updater keypair so updates are
signature-verified, OR — if release signing cannot be set up now — cleanly disable the
updater so no unverifiable update path ships.

## Why it matters (business terms)

Auto-update is how customers get fixes. If the app can't verify that an update genuinely
came from you, a malicious file could be installed. For a local-first financial app that
promises "data never leaves your machine," an unverified updater is unacceptable. Better
no updater than an insecure one.

## Read first

- `docs/AUTH-SPEC.md` / `docs/SECURITY-CHECKLIST.md` (signing, offline trust model).
- Tauri updater docs: https://tauri.app/plugin/updater/ (key generation with
  `tauri signer generate`, and the `pubkey` + `TAURI_SIGNING_PRIVATE_KEY` release flow).
- `src-tauri/tauri.conf.json` (the `updater` block) and `src-tauri/Cargo.toml`
  (`tauri-plugin-updater`).

## Path A — enable signing (preferred, if keys can be created)

1. Generate a keypair (locally, by the owner or you if the tool is available):
   `npx @tauri-apps/cli signer generate -w ~/.tauri/onefpa.key`.
2. Put the **public** key into `tauri.conf.json` `updater.pubkey`.
3. Store the **private** key + password as CI/release secrets
   (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) — never commit the
   private key (secret-scan gate must stay green).
4. Confirm the release build signs artifacts and generates `latest.json`.
5. Verify the endpoint URL is correct for the real release repo/owner.

## Path B — disable the updater (if keys cannot be set up in-session)

1. Remove the `updater` block from `tauri.conf.json` (and, if required, the
   `tauri-plugin-updater` registration) so no update capability is compiled in.
2. Record the decision in `docs/DECISIONS.md` (an ADR: "updater deferred to release; not
   shipped without a signing key") and in `TASKBOARD.md` M7.
3. Do NOT leave an empty-pubkey updater configured — that is the exact hole to close.

**Choose Path A if a keypair can be generated; otherwise Path B.** Never leave the
empty-pubkey state.

## Acceptance criteria

- `grep '"pubkey": ""' src-tauri/tauri.conf.json` returns nothing (either a real key, or
  the updater block is gone).
- No private key anywhere in the repo (`npm run security:scan` green).
- The chosen path is documented (ADR / TASKBOARD).
- The endpoint owner/URL is correct if Path A.

## Gates to run

```bash
npm run check          # security:scan must stay green (no committed private key)
npm run build
# Rust/desktop build verified in CI (WS-02) — tauri.conf change compiles.
```

## Docs to sync

- `docs/DECISIONS.md` (ADR for the choice).
- `docs/SECURITY-CHECKLIST.md` / `docs/AUTH-SPEC.md` if the updater trust model is
  described there.
- `TASKBOARD.md` M7 release row.
