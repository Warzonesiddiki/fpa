-- 002: packs.description — the Pack summary text shown in the wizard pack cards and the
-- Pack browser (SCREENS-SPEC S-002; TODO M1-3). Source of truth: the `pack.description`
-- field of each bundled pack.json (packs/schema/pack.schema.json — required).
ALTER TABLE packs ADD COLUMN description TEXT NOT NULL DEFAULT '';
