/**
 * gen-license-fixtures.mjs — deterministic Ed25519 license fixtures (TEST-FIXTURES-SPEC §1:
 * `license/` — valid / signature-invalid / expired / machine-mismatch payloads).
 *
 * node:crypto Ed25519 (Node ≥ 16); keypairs are DERIVED FROM FIXED 32-BYTE SEEDS, so every
 * run produces byte-identical fixtures (B5). The test private key is committed DELIBERATELY
 * (clearly marked test-only): fixtures must be regenerable and verifiable in CI without any
 * external secret. The PRODUCTION license keypair is a different seed; only its PUBLIC key
 * is embedded in the app (src-tauri license.rs) — the production private key is never
 * committed (LICENSE-SPEC §Key custody).
 *
 * Usage: npm run fixtures:gen:license   (or: node scripts/gen-license-fixtures.mjs)
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "tests", "fixtures", "license");

/** Fixed 32-byte seed → deterministic Ed25519 keypair (raw 32-byte seed, PKCS8 DER wrapper). */
function keypairFromSeed(seedText) {
  const seed = Buffer.from(seedText.slice(0, 32), "utf8");
  // RFC 8410 §A.1 PKCS8 prefix for Ed25519 (alg OID 1.3.101.112 + 0x04 0x20 octet-string)
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  return { privateKey, publicKey: createPublicKey(privateKey) };
}

const TEST_SEED = "onefpa-test-license-key-seed-00000000000001";
const PROD_SEED = "onefpa-prod-license-key-seed-00000000000001"; // public key only ships (see below)

const test = keypairFromSeed(TEST_SEED);
const prod = keypairFromSeed(PROD_SEED);

const pubHex = (k) => k.export({ type: "spki", format: "der" }).toString("hex");
const privHex = (k) => k.export({ type: "pkcs8", format: "der" }).toString("hex");

/** Canonical JSON: sorted keys at every level, no whitespace — the exact signed bytes
 *  (LICENSE-SPEC §Canonical payload). Rust must sign/verify the identical serialization. */
function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
}

/** A license payload (LICENSE-SPEC §Response payload). */
function makePayload({ keyId, companyHash, plan, expiresAt, fingerprint }) {
  return {
    license_key_id: keyId,
    licensed_company_hash: companyHash,
    plan,
    expires_at: expiresAt,
    machine_fingerprint: fingerprint,
  };
}

const COMPANY_ID = "11111111-2222-3333-4444-555555555555"; // fixture Company id (RFC 4122 format)
// `licensed_company_hash` holds the Company UUID DIRECTLY — the locked contract of
// company.list (`l.licensed_company_hash = c.id`); the "hash" in the name is legacy.
const COMPANY_HASH = COMPANY_ID;
const FINGERPRINT =
  "fp-" + createHash("sha256").update("fixture-machine").digest("hex").slice(0, 32);
const WRONG_FINGERPRINT =
  "fp-" + createHash("sha256").update("other-machine").digest("hex").slice(0, 32);

/** The signature covers the canonical bytes of the payload WITHOUT the signature key
 *  (the key is absent, not null/undefined — LICENSE-SPEC §Canonical payload). */
function stripSignature(payload) {
  const { signature: _unused, ...rest } = payload;
  return rest;
}

function signed(payload, key) {
  const bytes = Buffer.from(canonicalize(payload), "utf8");
  const signature = sign(null, bytes, key.privateKey);
  return { ...payload, signature: signature.toString("base64") };
}

const payloads = {
  "license-valid.json": signed(
    makePayload({
      keyId: "LK-TEST-VALID-0001",
      companyHash: COMPANY_HASH,
      plan: "pro",
      expiresAt: "2099-12-31T23:59:59Z",
      fingerprint: FINGERPRINT,
    }),
    test,
  ),
  "license-expired.json": signed(
    makePayload({
      keyId: "LK-TEST-EXPIRED-0001",
      companyHash: COMPANY_HASH,
      plan: "pro",
      // > 60 days (grace, DECISIONS.md) in the past → `expired`, not `grace`
      expiresAt: "2020-01-01T00:00:00Z",
      fingerprint: FINGERPRINT,
    }),
    test,
  ),
  // Grace window (DECISIONS.md: 60d): expired but within 60 days OF 2026-08-31 (42 days).
  // Time-dependent by design: the status function is pure and tested at fixed times in the
  // core; after 2026-09-18 this payload is `expired`. Regenerate or adjust the core's
  // fixture-time pin if this drifts (LICENSE-SPEC §Fixtures).
  "license-grace.json": signed(
    makePayload({
      keyId: "LK-TEST-GRACE-0001",
      companyHash: COMPANY_HASH,
      plan: "pro",
      expiresAt: "2026-07-20T00:00:00Z",
      fingerprint: FINGERPRINT,
    }),
    test,
  ),
  "license-machine-mismatch.json": signed(
    makePayload({
      keyId: "LK-TEST-MISMATCH-0001",
      companyHash: COMPANY_HASH,
      plan: "pro",
      expiresAt: "2099-12-31T23:59:59Z",
      fingerprint: WRONG_FINGERPRINT,
    }),
    test,
  ),
};

// Signature-invalid: valid payload, then corrupt ONE signature byte (deterministic flip).
const invalid = { ...payloads["license-valid.json"] };
const sigBytes = Buffer.from(invalid.signature, "base64");
sigBytes[0] ^= 0xff;
invalid.signature = sigBytes.toString("base64");
payloads["license-invalid-signature.json"] = invalid;

// Self-verification: re-verify every signed payload against the test public key.
for (const [name, p] of Object.entries(payloads)) {
  if (name === "license-invalid-signature.json") continue;
  const bytes = Buffer.from(canonicalize(stripSignature(p)), "utf8");
  const ok = verify(null, bytes, test.publicKey, Buffer.from(p.signature, "base64"));
  if (!ok) throw new Error(`self-verify FAILED: ${name}`);
}
// The invalid one MUST NOT verify.
{
  const p = payloads["license-invalid-signature.json"];
  const bytes = Buffer.from(canonicalize(stripSignature(p)), "utf8");
  if (verify(null, bytes, test.publicKey, Buffer.from(p.signature, "base64"))) {
    throw new Error("self-verify FAILED: invalid-signature payload verified (should not)");
  }
}

mkdirSync(OUT, { recursive: true });
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const files = {};
for (const [name, p] of Object.entries(payloads)) {
  writeFileSync(path.join(OUT, name), JSON.stringify(p, null, 2) + "\n");
  files[name] = sha256(path.join(OUT, name));
}

writeFileSync(
  path.join(OUT, "keys.json"),
  JSON.stringify(
    {
      test_only:
        "FIXTURE KEYPAIR — test-only, committed deliberately (CI regenerability). NOT the production key.",
      test_public_spki_der_hex: pubHex(test.publicKey),
      test_private_pkcs8_der_hex: privHex(test.privateKey),
      production_public_spki_der_hex: pubHex(prod.publicKey),
      production_public_key_hex_raw32: prod.publicKey
        .export({ type: "spki", format: "der" })
        .subarray(-32)
        .toString("hex"),
    },
    null,
    2,
  ) + "\n",
);
files["keys.json"] = sha256(path.join(OUT, "keys.json"));

writeFileSync(
  path.join(OUT, "expected.json"),
  JSON.stringify(
    {
      fixture: "license",
      synthetic: true,
      company_id: COMPANY_ID,
      company_hash: COMPANY_HASH,
      machine_fingerprint: FINGERPRINT,
      grace_days: 60, // DECISIONS.md
      as_of: "2026-08-31",
      expected_status: {
        "license-valid.json": "active",
        "license-grace.json": "grace", // as of 2026-08-31 (expires 2026-07-20, 42 days < 60)
        "license-expired.json": "expired",
        "license-invalid-signature.json": "invalid",
        "license-machine-mismatch.json": "invalid", // machine binding mismatch
      },
      files,
    },
    null,
    2,
  ) + "\n",
);
files["expected.json"] = sha256(path.join(OUT, "expected.json"));

console.log(
  `fixtures:gen:license OK — ${Object.keys(payloads).length} payloads + keys.json + expected.json in tests/fixtures/license/ (deterministic seeds; self-verified)`,
);
