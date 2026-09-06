# 06 · Database & migrations

SQLite lives **only in the Rust core** (`rusqlite`, bundled). The schema is documented in
`docs/DATABASE-SCHEMA.md` and enforced by `scripts/schema-equality-check.mjs` (blocking:
docs and SQL must agree; no float money columns).

## Read first

- `docs/DATABASE-SCHEMA.md` — every table/column/index/constraint (the source of truth).
- `src-tauri/migrations/*.sql` — the applied migrations (`001_initial.sql`,
  `002_packs_description.sql`, …). Migrations run via `rusqlite_migration` in `storage/db.rs`.

## Rules

- **Migrations are append-only and forward-only.** Add a new numbered file; never edit an
  already-shipped migration.
- **Docs and SQL must match** — add the column/table to `docs/DATABASE-SCHEMA.md` in the
  same commit; `schema-equality-check` fails otherwise.
- **No `REAL`/float column for money.** Use `INTEGER` minor units or `TEXT` decimal
  strings per the schema doc (money:ast/schema-check enforce the spirit).
- **Every table that can change carries audit context** — mutations write `audit_events`
  (B7), not just the domain row.
- Respect existing conventions: `company_id` scoping, `created_at` timestamps, foreign
  keys, `UNIQUE`/`CHECK` constraints, and FK-safe ordering.

## Adding a migration (recipe)

1. Update `docs/DATABASE-SCHEMA.md` with the new table/column/index + rationale.
2. Create `src-tauri/migrations/00N_<short_description>.sql` (next number).
   - Use `IF NOT EXISTS` only where the migration framework expects; follow the pattern
     of existing files. Include indexes and constraints, not just the bare table.
3. Ensure `storage/db.rs` picks up the new migration (the framework loads the folder;
   confirm the migration list/registration if it's explicit).
4. If a command reads/writes the new shape, update its handler + `docs/API-SPEC.md`.
5. Run the gate:
   ```bash
   node scripts/schema-equality-check.mjs   # must PASS
   npm run check
   cargo test                               # (CI) incl. migration/rollback tests
   ```

## Verify parity by hand

```bash
# tables present in SQL vs documented:
grep -oiE "create table [a-z_]+" src-tauri/migrations/*.sql | sort -u
grep -oiE "^\|\s*\`?[a-z_]+\`?" docs/DATABASE-SCHEMA.md | head
node scripts/schema-equality-check.mjs
```

## Backups, restore, archive

- Backup/restore/retention and year-archive are real features (F-037). Follow
  `docs/DR-RECOVERY-RUNBOOK.md`. A restore takes a pre-restore snapshot; archives are
  compressed and **restorable** — never lossy. Archiving/deleting must not excise the
  audit trail (B7).

## Anti-patterns (banned)

- Editing a shipped migration in place.
- Adding a column in SQL but not in `docs/DATABASE-SCHEMA.md` (or vice-versa).
- A `REAL` money column.
- A schema change with no migration (or a migration with no doc update).
- Deleting rows that would break the audit hash chain.
