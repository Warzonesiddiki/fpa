# 01 · Repository map — where every concern lives

Find the **single owner** before you edit (B14: one owner per concern). Editing the
wrong place, or adding a second implementation, voids the change.

## Top level

| Path           | What it is                                                               |
| -------------- | ------------------------------------------------------------------------ |
| `docs/`        | 64 canonical specs — the source of truth. Start at `docs/DOCS-INDEX.md`. |
| `src/`         | React 19 + TS UI (view only; never computes money).                      |
| `src-tauri/`   | Rust core (all math, storage, security) + Tauri shell.                   |
| `packs/`       | 12 Industry Packs — **data only** (JSON + SQL seeds), no code (B15).     |
| `e2e/`         | Playwright user-flow specs (UF-001…UF-014).                              |
| `scripts/`     | Gate scripts (money:ast, docs:verify, pack-validate, schema check, …).   |
| `benchmarks/`  | Vitest perf benches.                                                     |
| `infra/ci.yml` | The CI pipeline (see remediation WS-01/02).                              |
| `TASKBOARD.md` | Live build order & status.                                               |
| `HANDOVER.md`  | Session-to-session state and pitfalls.                                   |

## Rust core (`src-tauri/src/`)

| Concern                        | Owner file                                    |
| ------------------------------ | --------------------------------------------- |
| Command handlers (IPC)         | `commands/*.rs` (one file per domain)         |
| Handler registration           | `lib.rs` → `generate_handler![…]`             |
| **Money** (exact arithmetic)   | `core/money.rs`                               |
| **Calendar / fiscal years**    | `core/calendar.rs`                            |
| **Model / formula graph**      | `core/model.rs`                               |
| **Audit chain**                | `core/audit.rs`                               |
| **Typed errors**               | `core/error.rs` (`AppError` enum + builders)  |
| SQLite access & migrations run | `storage/db.rs`, `src-tauri/migrations/*.sql` |
| Keychain / encryption keys     | `storage/keystore.rs`, `storage/keys.rs`      |
| Encrypted container            | `storage/container.rs`                        |

## Frontend (`src/`)

| Concern                    | Owner                                                    |
| -------------------------- | -------------------------------------------------------- |
| Screens (42)               | `src/pages/sNNN-*/index.tsx` (+ `*.test.tsx`)            |
| IPC client (typed bridge)  | `src/api/bridge.ts` (calls `call("cmd", args)`)          |
| Command arg/return schemas | `src/api/schema.ts` (Zod; `CommandArgs` map)             |
| Dev-preview mock core      | `src/api/mock.ts` (**dev only** — see remediation WS-08) |
| App state stores           | `src/stores/*.ts` (Zustand)                              |
| Shared UI primitives       | `src/components/ui/*` (Button, Input, Card, StatePanel)  |
| Domain components          | `src/components/domain/*` (e.g. MoneyCell)               |
| Global chrome              | `src/components/global/*`                                |
| i18n                       | `src/i18n/*`, `src/i18n/en.json`                         |
| Design tokens / theme      | `src/theme/tokens.ts`                                    |
| Formula/model worker       | `src/workers/modelEngine.ts`                             |

## The golden path of a request

```
Screen (src/pages) → store (src/stores) → call() (src/api/bridge.ts)
   → Zod validate (src/api/schema.ts)
   → [dev] mock.ts   OR   [shell] Tauri invoke → commands/*.rs
       → core/*.rs (math)  → storage/*.rs (SQLite)  → audit_events row
```

## How to locate the owner fast

```bash
grep -rn "pub fn <thing>"    src-tauri/src/          # Rust function
grep -rn "\"cmd.name\""      src/api/schema.ts        # command schema
grep -rn "cmd_name"          src-tauri/src/lib.rs     # is it registered?
grep -rln "S-0NN"            docs/ src/               # a screen's spec + code
```

If you can't find a single clear owner, **stop** — do not create a new one on a hunch.
Re-read `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`; the owner is defined there.
