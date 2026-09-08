-- WS-07 · company.archive_year (PRD F-001/F-037 · API-SPEC §2.1): `archived_at` marks a
-- detached Fiscal Year; NULL = active. Archive is a mark + reference guard — the command
-- refuses with ARCHIVE_IN_USE while anything still references the year's periods, then
-- stamps the mark in one transaction with an HMAC-chained audit event. No data is moved
-- or compressed (F-037 compression is a recorded follow-up), so restoring = clearing the
-- mark. Restorable by design: nothing is deleted.
ALTER TABLE fiscal_years ADD COLUMN archived_at TEXT;
