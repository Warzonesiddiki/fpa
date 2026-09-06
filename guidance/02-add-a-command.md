# 02 · Add or change a Tauri command (end-to-end)

The order is **Rust first, then TypeScript** (`docs/CLAUDE.md`, AGENTS.md). Never ship a
command that exists on only one side (mock-only or orphan-handler are both defects — see
the audit findings).

## Read first

- `docs/API-SPEC.md` — the exact contract (args, returns, error codes). If your command
  isn't there, add the row **first** and update the traceability matrix + `DOCS-INDEX.md`.
- `docs/ERROR-HANDLING.md` — the error codes you may return (verbatim only).
- The owner file for the concern (see `01-repo-map.md`).

## Step 1 — Rust handler (`src-tauri/src/commands/<domain>.rs`)

Mirror an existing handler (e.g. `assumption.rs::assumption_waive`). Standard skeleton:

```rust
#[tauri::command]                      // (this repo registers via lib.rs; keep style consistent)
pub fn my_command(
    app: AppHandle,
    // typed args exactly matching API-SPEC …
    state: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    // 1. Session gate:
    let company_id = require_session_write(&state)?;   // writes
    // let company_id = require_session(&state)?;       // reads

    // 2. Validate inputs → typed AppError with a code from ERROR-HANDLING:
    if bad { return Err(AppError::invalid("VALUE_INVALID: …")); }

    // 3. Open DB + ownership check:
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    if !model_belongs_to_company(&conn, &model_id, &company_id)? {
        return Err(AppError::Scope("… not owned by active Company".into()));
    }

    // 4. Do work inside a transaction:
    let tx = conn.transaction()?;
    // … reads/writes …

    // 5. MUTATION → write an audit event (B7) with the hash chain:
    let key  = keystore::audit_hmac_key(&dir)?;
    let prev = audited_hash(&tx, &company_id)?;
    let hash = next_hash(&key, &prev, after_json.as_bytes());
    tx.execute("INSERT INTO audit_events (…) VALUES (…)", params![…])?;
    tx.commit()?;

    // 6. Return the documented shape:
    Ok(serde_json::json!({ "data": { /* exactly API-SPEC returns */ } }))
}
```

Rules:

- **Reads** do not open a write transaction and do **not** write audit rows.
- **Every mutation** writes an audit event via the existing hash-chain helpers — never
  invent a second audit mechanism (B7/B14).
- Money is `rust_decimal` / i64 minor units — never `f64` (see `05-money-and-numbers.md`).
- Errors come from `core/error.rs`; if you need a new one, add it there **and** in
  `docs/ERROR-HANDLING.md` (see `04-error-handling-playbook.md`).

## Step 2 — register it (`src-tauri/src/lib.rs`)

Add the function name to `generate_handler![ … ]`. **An unregistered handler is dead
code; an unlisted command 404s in the shell.** Verify both directions:

```bash
grep -n "my_command" src-tauri/src/lib.rs        # must appear in generate_handler!
```

## Step 3 — add Rust tests (`#[cfg(test)]` in the same file)

Cover: happy path (asserts the returned shape + that an audit row was written for
mutations), each error branch, and any bounds. These run in CI (`cargo test`).

## Step 4 — TypeScript schema (`src/api/schema.ts`)

```ts
export const MyCommandArgs = z.object({ /* args, tight types */ });
// …in the CommandArgs map:
"my.command": MyCommandArgs,
```

Keep the return type as a Zod schema too if the repo models returns (mirror a neighbor).
Names use dot-notation matching API-SPEC (`domain.action`, `_v1` suffix if versioned).

## Step 5 — dev-preview mock (`src/api/mock.ts`)

Add a `case "my.command":` that mirrors the native contract (same shape, same error
codes) so the browser preview behaves like the shell. The mock is **dev only** (WS-08).

## Step 6 — call it from a store/page

```ts
import { call } from "@/api/bridge";
const res = await call("my.command", {
  /* args */
}); // Zod-validated both ways
```

Handle the `BridgeError` (typed `code`, `userMessage`, `retryable`) in the UI.

## Step 7 — verify parity (no drift)

```bash
# schema commands vs registered rust handlers — should reconcile:
grep -oE '"[a-z][a-z_]*\.[a-z_.0-9]+":' src/api/schema.ts | sort -u
sed -n '/generate_handler/,/])/p' src-tauri/src/lib.rs | grep -oE '[a-z_]+,'
```

## Definition of done for a command

- [ ] Row in `docs/API-SPEC.md` (+ matrix + DOCS-INDEX) matches the code exactly.
- [ ] Rust handler implemented, registered in `lib.rs`, with tests.
- [ ] Mutations write an audit event; reads don't.
- [ ] Zod schema + `CommandArgs` binding added; mock case added (dev only).
- [ ] A real caller exists (no orphan). No mock-only MVP command.
- [ ] `npm run check` green; `cargo test` green in CI.
