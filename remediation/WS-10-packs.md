# WS-10 · Re-issue the 12 Industry Packs to zero warnings

**Priority:** Phase C. **Decision:** D8. **Finding:** `npm run packs:validate` passes but
emits **132 "legacy" warnings**. Examples: SaaS KPIs `nrr`, `burn`, `cac_payback`, `arr`
have **missing formulas and alert bands** ("alerts fall back to target-only"); several
drivers in retail/saas (`footfall`, `conversion`, `aov`, `reps_quota`, `churn`, `arpu`)
have **no links** ("Federation/attribution degraded until re-issued"). Packs are data
(B15) — this is a data-completeness fix, not code.

## Objective

All 12 packs validate with **zero warnings**: every KPI has a formula and valid alert
bands; every driver has its links; and any other warned-on field (§3/§4/rollup.maps,
sections, etc.) is populated per the pack schema.

## Why it matters (business terms)

The industry packs are what make the app instantly useful for, say, a SaaS or retail
business — the right KPIs, alert thresholds, and driver relationships out of the box.
Missing formulas/bands mean alerts can't fire properly and attribution analysis is
degraded. "Zero compromise" means the packs ship complete.

## Read first

- `scripts/pack-validate.mjs` — the exact rules that emit each warning (search for
  `formula missing`, `bands missing`, `has no links`). This tells you precisely which
  fields must be filled.
- `docs/PACKS-SPEC.md` (or the pack schema doc) §3 (KPIs: formula + bands) and §4
  (drivers: links), plus rollup.maps, sections, checksum requirements.
- `docs/MODELING-METHODS-SPEC.md` / `docs/FORMULA-ENGINE-SPEC.md` for correct KPI formula
  syntax (must use the real function whitelist — no invented functions).
- Existing complete packs (whichever emit no warnings) as the reference template.

## Files

- `packs/<industry>/*.json` (and any `.sql` seed) for all 12 packs. Focus first on the
  packs the validator warns about (retail, saas, and any others in the 132).

## Steps

1. Run `npm run packs:validate 2>&1 | tee /tmp/packs.log` and extract the full unique
   list of warnings and which pack/field each belongs to.
2. Group by type:
   - **KPI formula missing** → add a correct formula (validated against the formula
     engine whitelist) that computes the KPI (e.g. `nrr`, `arr`, `burn`, `cac_payback`).
     Use finance-correct definitions (you are ACCA-backed — the owner can confirm the
     business definition; the agent implements the formula syntax).
   - **KPI bands missing/invalid** → add alert bands (green/amber/red thresholds) per the
     schema so alerts aren't target-only.
   - **Driver has no links** → add the driver's links (which model lines/other drivers it
     feeds) per §4 so Federation/attribution works.
   - Any other warned field (sections, rollup.maps, logo_ref/seed_sql/assets if the
     validator checks them) → populate per schema.
3. Keep every value **finance-correct and industry-appropriate.** Do not fill with
   placeholder junk to silence the validator — that would violate the spirit of zero
   compromise. If a KPI definition needs a business decision, ask the owner (they're an
   ACCA) with 2–3 concrete options.
4. Recompute any checksums the validator expects (the script will tell you).
5. Confirm the Pack Builder (if it emits packs) also produces these fields going forward
   — the audit noted the builder emitted invalid driver types / partial files. If a small
   builder fix prevents regenerating incomplete packs, do it; otherwise record as
   follow-up.

## Acceptance criteria

- `npm run packs:validate` prints **12/12 packs valid with 0 warnings**.
- Every KPI has a formula that parses against the engine whitelist and valid bands.
- Every driver has links; rollup.maps/sections/etc. populated per schema.
- No placeholder/junk values — all finance-correct.

## Gates to run

```bash
npm run packs:validate     # target: 0 warnings
npm run check              # full suite stays green
```

## Docs to sync

- `docs/PACKS-SPEC.md` if any field semantics are clarified.
- Traceability / `TASKBOARD.md` B15/pack rows.
- If KPI business definitions were chosen, note them (so they're auditable).
