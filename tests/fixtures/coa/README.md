# tests/fixtures/coa/

Chart of Accounts (F-002) fixtures (TEST-FIXTURES-SPEC §1 `coa/`). Synthetic,
deterministic, data-only (no code) — B5/B18-3. They pin the documented upsert and
merge semantics of `coa.import` / `coa.merge_accounts` (API-SPEC; S-021).

**Semantics under test** (src-tauri/src/commands/coa.rs):

| Outcome | Rule |
|---|---|
| `created` | code not present in the Company (BU-less scope) |
| `updated` | code present, SAME `account_type`, zero `gl_lines` usage → in-place rename/section bump, `version += 1` |
| `COA_REFERENCED` (409) | code present, same type, but referenced by ≥1 GL line — history is never rewritten |
| `COA_DUPLICATE_CODE` (409) | code present with a DIFFERENT `account_type` — no silent type flip |
| merge | `gl_lines.account_id` remapped `from→to`, children reparented, `from` soft-deactivated (`active=0`, `version += 1`) |

| File | Content |
|---|---|
| `import-pack-coa.json` | Clean pack-style import source: 6 new accounts (one control account). |
| `import-pack-coa.expected.json` | `{created: 6, updated: 0}`. |
| `import-update.json` | Existing 4000 (revenue) + incoming 4000 same type, no usage → upsert. |
| `import-update.expected.json` | `{created: 0, updated: 1, version: 2, name bumped}`. |
| `duplicate-code.json` | Existing 4000 (**asset**) + incoming 4000 (**revenue**) → type conflict. |
| `duplicate-code.expected.json` | `{error: COA_DUPLICATE_CODE, http_status: 409, code: 4000}`. |
| `referenced-account.json` | Existing 4000 (revenue) with 1 GL line + incoming 4000 same type → referenced guard. |
| `referenced-account.expected.json` | `{error: COA_REFERENCED, http_status: 409, count: 1}`. |
| `merge-remap.json` | 4000 (root, 2 GL lines) + child 4010 + target 4100; merge 4000 → 4100. |
| `merge-remap.expected.json` | `{remapped: 2, from_active: 0, from_version: 2, child 4010 reparented to 4100}`. |

**Consumers:**
- `commands/coa.rs` cargo tests (CI): `fixture_import_pack_coa`,
  `fixture_import_update`, `fixture_import_duplicate_code`,
  `fixture_import_referenced_account`, `fixture_merge_remap` — bind the engine
  to these files (fixture edit or engine regression fails CI).
- `src/test/coa-fixtures.test.ts` (sandbox-runnable): file integrity +
  internal consistency (sidecars match the fixture inputs they describe).

Account ids are deterministic in the engine tests: `acct-<code>` (see
`commands/coa.rs` test module) — the fixtures express the SAME shape with
`code`/`parent_code` keys, which the test helpers resolve to those ids.
