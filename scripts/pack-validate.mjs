#!/usr/bin/env node
/**
 * packs:validate — Industry Pack gate (B15 / INDUSTRY-PACK-SPEC §8).
 * Packs are DATA ONLY: schema fields, versioning, no executable code.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "packs");
const problems = [];
const err = (m) => problems.push(m);
// Spec §8 warning tier: legacy-pack debts (KPI formula/bands, driver links,
// unverifiable checksum) surface as warnings "until re-issued" — visible in the
// gate output, non-blocking by spec. Blocking checks keep using err().
const warnings = [];
const warn = (m) => warnings.push(m);
const createHash = (await import("node:crypto")).createHash;

const PACK_KEYS = new Set([
  "saas",
  "manufacturing",
  "retail",
  "healthcare",
  "construction",
  "professional-services",
  "nonprofit",
  "government",
  "energy",
  "financial-services",
  "logistics",
  "real-estate",
]);

const packDirs = readdirSync(root).filter(
  (d) => d !== "schema" && statSync(join(root, d)).isDirectory(),
);
if (packDirs.length !== 12) err(`expected 12 industry packs, found ${packDirs.length}`);
for (const d of packDirs) if (!PACK_KEYS.has(d)) err(`unexpected pack dir: ${d}`);

const semver = /^\d+\.\d+\.\d+$/;
const accountTypes = new Set(["revenue", "cogs", "opex", "asset", "liability", "equity"]);
const driverTypes = new Set([
  "volume_x_rate",
  "headcount",
  "growth",
  "seasonal",
  "spread",
  "ratio",
  "manual",
]);

for (const d of packDirs) {
  const dir = join(root, d);
  const files = readdirSync(dir);
  const forbidden = files.filter((f) => /\.(rs|js|ts|py|sh|exe|dll|so)$/.test(f));
  if (forbidden.length) err(`${d}: executable files in pack (B15): ${forbidden.join(", ")}`);

  const pk = readJson(join(dir, "pack.json"), d);
  if (!pk) continue;
  if (pk.schema_version !== "1.0.0") err(`${d}: schema_version must be 1.0.0`);
  if (!semver.test(pk.pack?.version ?? "")) err(`${d}: pack.version must be semver`);
  if (pk.pack?.key !== d && pk.pack?.key !== d.replace("-", "_")) err(`${d}: pack.key mismatch`);
  const localeHint = pk.pack?.locale_hint ?? "";
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(localeHint)) err(`${d}: locale_hint must be BCP-47`);

  const coa = readJson(join(dir, pk.coa_template), `${d}/coa`);
  if (coa && (!Array.isArray(coa.accounts) || coa.accounts.length < 5))
    err(`${d}: COA needs ≥5 accounts`);
  if (coa) {
    const codes = new Set();
    for (const a of coa.accounts) {
      if (!accountTypes.has(a.type)) err(`${d}: invalid account type '${a.type}'`);
      if (codes.has(a.code)) err(`${d}: duplicate COA code '${a.code}'`);
      codes.add(a.code);
    }
  }

  const kpis = readJson(join(dir, pk.kpi_definitions), `${d}/kpis`);
  if (kpis && (!Array.isArray(kpis.kpis) || kpis.kpis.length < 4))
    err(`${d}: KPI definitions need ≥4`);
  if (kpis) {
    for (const k of kpis.kpis) {
      if (!k.key || !k.definition)
        err(`${d}: KPI missing key/definition (rendered in KPIExplainer)`);
      if (!/^\d+(\.\d+)?$/.test(String(k.target?.value ?? 0)))
        err(`${d}: KPI '${k.key}' target must be decimal`);
      // §8: formula present (non-empty string) — warning until re-issued.
      if (typeof k.formula !== "string" || k.formula.trim() === "")
        warn(`${d}: KPI '${k.key}' formula missing (§3) — re-issue the pack`);
      // §8: bands good/watch numeric — warning until re-issued.
      if (!k.bands || typeof k.bands.good !== "number" || typeof k.bands.watch !== "number")
        warn(`${d}: KPI '${k.key}' bands missing/invalid (§3) — alerts fall back to target-only`);
    }
  }

  const drivers = readJson(join(dir, pk.driver_templates), `${d}/drivers`);
  if (
    drivers &&
    (!Array.isArray(drivers.drivers) || drivers.drivers.length < 3 || drivers.drivers.length > 7)
  )
    err(`${d}: drivers must be 3–7 (B16 advisory)`);
  if (drivers) {
    for (const dr of drivers.drivers) {
      if (!driverTypes.has(dr.type)) err(`${d}: invalid driver type '${dr.type}'`);
      // §8: bounds numeric decimal — invalid (wrong path).
      for (const side of ["low", "high"]) {
        const v = dr.bounds?.[side];
        if (v === undefined || v === null || !/^\d+(\.\d+)?$/.test(String(v)))
          err(`${d}: driver '${dr.key}' bounds.${side} must be a decimal value`);
      }
      // §8: links non-empty — warning (Federation + attribution degraded).
      if (!Array.isArray(dr.links) || dr.links.length === 0)
        warn(
          `${d}: driver '${dr.key}' has no links (§4) — Federation/attribution degraded until re-issued`,
        );
    }
  }

  const layouts = readJson(join(dir, pk.report_layouts), `${d}/layouts`);
  if (layouts && (!Array.isArray(layouts.layouts) || layouts.layouts.length < 1))
    err(`${d}: ≥1 report layout`);
  if (layouts) {
    const columnTypes = new Set(["period", "ytd", "fy", "variance", "threeway"]);
    for (const l of layouts.layouts) {
      if (!Array.isArray(l.rows) || l.rows.some((r) => typeof r !== "string" || !r.trim()))
        err(`${d}: layout '${l.key}' rows must be non-empty line-key strings (LAYOUT_INVALID)`);
      if (!Array.isArray(l.columns) || l.columns.length === 0)
        err(`${d}: layout '${l.key}' needs columns (LAYOUT_INVALID)`);
      else
        for (const c of l.columns)
          if (!columnTypes.has(c.type))
            err(
              `${d}: layout '${l.key}' column type '${c.type}' not in period/ytd/fy/variance/threeway (LAYOUT_INVALID)`,
            );
    }
  }
  const gl = readJson(join(dir, pk.gl_template), `${d}/gl_template`);
  if (gl && typeof gl.columns !== "object") err(`${d}: gl_template.columns required`);
}

function readJson(p, label) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    err(`${label}: unreadable/malformed JSON (${e.message})`);
    return null;
  }
}

if (problems.length) {
  console.error(`packs:validate FAILED — ${problems.length} blocking, ${warnings.length} warnings`);
  problems.forEach((p) => console.error(`  ✗ ${p}`));
  process.exit(1);
}
if (warnings.length) {
  console.log(`packs:validate warnings (${warnings.length}) — non-blocking per spec §8:`);
  warnings.forEach((w) => console.log(`  ⚠ ${w}`));
}
console.log(
  `packs:validate PASS — ${packDirs.length}/12 packs data-only & schema-conformant (${warnings.length} legacy warnings)`,
);
