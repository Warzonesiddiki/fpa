# 09 · Industry Packs playbook (data only, B15)

Industry behavior is **Pack data**, never code (B15). There is no per-industry `if`, page,
or engine anywhere. A pack is JSON (+ SQL seeds) that the generic engine consumes.

## Read first

- `docs/INDUSTRY-PACK-SPEC.md` — the pack schema (sections, KPIs §3, drivers §4,
  layouts, seeds, checksums, calendar defaults).
- `scripts/pack-validate.mjs` — the exact validation rules and every warning it emits.
- `packs/<industry>/` — the 12 existing packs (use a clean one as the template).

## The 12 packs must validate with ZERO warnings

`npm run packs:validate` currently passes but emits ~132 "legacy" warnings (missing KPI
formulas/bands, drivers with no links). Zero-compromise target = **0 warnings** (see
remediation WS-10). Each pack must have, per the spec:

- **KPIs (§3):** every KPI has a `formula` (valid against the formula-engine whitelist)
  and valid alert `bands` (green/amber/red), so alerts aren't target-only.
- **Drivers (§4):** every driver has `links` (what it feeds), so Federation/attribution
  works.
- Sections, `rollup.maps`, layouts, seeds, calendar default — populated per schema.
- Checksums recomputed as the validator expects.

## Editing / issuing a pack (recipe)

1. Run `npm run packs:validate 2>&1 | tee /tmp/packs.log`; list every warning per field.
2. Fill the missing fields with **finance-correct, industry-appropriate** values — never
   placeholder junk to silence the validator (that violates zero-compromise). KPI
   business definitions are an ACCA decision; ask the owner with concrete options if
   unsure, then implement the correct formula syntax.
3. Validate formula syntax against the engine whitelist (see `10-formula-engine-playbook.md`)
   — no invented functions.
4. Recompute checksums; re-run the validator until **0 warnings**.
5. If a **Pack Builder** emits packs, ensure it produces complete, valid fields (the audit
   found it emitted invalid driver types / partial files) — fix the builder so it can't
   regenerate incomplete packs, or record a follow-up.

## Hard rules

- **No executable code in packs** (`scripts/pack-data-only.mjs` enforces B15). JSON/SQL data only.
- **No per-industry code** in `src/` or `src-tauri/` — if you're tempted to branch on
  industry, the behavior belongs in pack data instead.
- Terms follow `docs/GLOSSARY.md` (e.g. "Pack", not "template/plugin").

## Gates

```bash
npm run packs:validate     # target: 12/12 valid, 0 warnings
npm run check
```

## Anti-patterns (banned)

- Any `if (industry === "...")` in code.
- Placeholder/dummy values to mute the validator.
- An invented formula function in a KPI.
- Shipping a pack with missing bands/links "to fix later".
