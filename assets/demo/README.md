# Demo assets (clearly-marked sample data — B18-3)

> **DEMO DATA — synthetic, clearly-marked.** These files power the First-Run
> Wizard's "demo data toggle" and "Open Demo Company" link (SCREENS-SPEC S-002,
> QA-CHECKLIST F-004 item 6). They are **sample learning data, never production
> data**: every import they trigger is committed under a `DEMO —` marked batch
> name, and the Demo Company itself is named to say so.

| File | Purpose |
|---|---|
| `sample_gl_dump.csv` | Actuals GL dump for the demo flow — **byte-identical** to `docs/examples/sample_gl_dump.csv` (Canonical GL Template, GL-TEMPLATE-SPEC §2; 480 rows, single period 2026-08/P08, tie-out 937,976.64 balanced). SHA256 `c675ef6d7ec8a532cab50615f2fce2366985d82b4fb72e351af04e132b9aa2f6` (matches `docs/examples/sample_gl_dump.expected.json`) |

## Shipment

Bundled as a Tauri resource (`tauri.conf.json → bundle.resources:
["../packs/**/*", "../assets/demo/**/*"]`), resolved by `import.parse` via the
same resource-dir-with-dev-fallback pattern the Pack loader uses
(`commands/pack.rs::find_packs_dir`). The demo wizard flow calls the **normal**
import pipeline (`import.parse` → `import.validate` → `import.tieout` →
`import.commit`) with `mapping_id = "canonical"` (GL-TEMPLATE-SPEC §7 — the
file follows the template, so no mapping step) and a `DEMO —` batch name.

## Regeneration

`npm run fixtures:gen` regenerates the source fixture; after any change, re-copy
`docs/examples/sample_gl_dump.csv` here and update the SHA256 above.

*Referenced by: TESTING-STRATEGY.md, QA-CHECKLIST.md.*
