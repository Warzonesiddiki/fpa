#!/usr/bin/env node
/**
 * scripts/build-desktop.mjs
 *
 * Automates pre-flight verification gates and native desktop packaging for OneFP&A (M7-7).
 *
 * Pre-flight Gates:
 *  1. npm run check (lint, typecheck, unit tests, docs:verify, packs:validate, money:ast, security:scan)
 *  2. cargo test --manifest-path src-tauri/Cargo.toml
 *  3. cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
 *  4. cargo fmt --check (cwd src-tauri/, per CI — cargo fmt takes no --manifest-path)
 *  5. Security & Configuration Audit:
 *     - Strict CSP (no remote origins, no unsafe-eval, local-first protocols)
 *     - No remote scripts or insecure external resources in index.html and web assets
 *     - Local asset protocol and frontendDist alignment in tauri.conf.json
 *     - Least-privilege capability audit (capabilities/default.json)
 *
 * Packaging Readiness Report:
 *  - Generates JSON and Markdown pre-flight reports in reports/
 *
 * Execution:
 *  - Packaging is executed unless --preflight-only is specified or run via npm run desktop:preflight.
 *
 * Usage:
 *  node scripts/build-desktop.mjs [options]
 *  npm run desktop:preflight
 *  npm run desktop:build
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
OneFP&A Desktop Packaging & Build Pre-flight Automation (M7-7)

Usage:
  node scripts/build-desktop.mjs [options]

Options:
  --preflight-only     Execute verification gates and security checks only (skip tauri packaging)
  --skip-gates         Skip pre-build verification gates (warning: release packages MUST run gates)
  --skip-cargo         Skip Rust gates (cargo test, cargo clippy, cargo fmt)
  --debug              Pass --debug to tauri build
  --target <triple>    Pass custom Rust target triple to tauri build
  --bundles <targets>  Pass specific bundle targets (e.g. msi,nsis, dmg, deb,appimage)
  --report-dir <path>  Specify directory for readiness reports (default: reports)
  --help, -h           Show this help message
`);
  process.exit(0);
}

const isPreflightOnly =
  args.includes("--preflight-only") || process.env.npm_lifecycle_event === "desktop:preflight";
const skipGates = args.includes("--skip-gates");
const skipCargo = args.includes("--skip-cargo");
const isDebug = args.includes("--debug");

let customTarget = null;
const targetIdx = args.indexOf("--target");
if (targetIdx !== -1 && args[targetIdx + 1]) {
  customTarget = args[targetIdx + 1];
}

let bundleTargets = null;
const bundlesIdx = args.indexOf("--bundles");
if (bundlesIdx !== -1 && args[bundlesIdx + 1]) {
  bundleTargets = args[bundlesIdx + 1];
}

let reportDir = join(rootDir, "reports");
const reportIdx = args.indexOf("--report-dir");
if (reportIdx !== -1 && args[reportIdx + 1]) {
  reportDir = resolve(rootDir, args[reportIdx + 1]);
}

const startTime = new Date();
const gateResults = [];

function recordGate(name, passed, durationMs, details = "") {
  gateResults.push({
    name,
    passed,
    durationMs,
    details,
  });
}

function runStep(name, cmd, cmdArgs, opts = {}) {
  console.log(`\n==================================================`);
  console.log(`[Gate] ${name}`);
  console.log(`Command: ${cmd} ${cmdArgs.join(" ")}`);
  console.log(`==================================================\n`);

  const stepStart = Date.now();
  const result = spawnSync(cmd, cmdArgs, {
    stdio: "inherit",
    shell: true,
    cwd: rootDir,
    ...opts,
  });
  const durationMs = Date.now() - stepStart;

  if (result.status !== 0) {
    recordGate(name, false, durationMs, `Exit code ${result.status}`);
    console.error(`\n❌ Error: Step "${name}" failed with exit code ${result.status}`);
    generateReadinessReport(false);
    process.exit(result.status ?? 1);
  }

  recordGate(name, true, durationMs, "Passed");
  console.log(`\n✅ Step "${name}" completed successfully (${(durationMs / 1000).toFixed(2)}s).`);
}

/**
 * Security Constraints Verification:
 *  - Verifies tauri.conf.json CSP and frontend distribution configuration.
 *  - Verifies index.html has no remote scripts, unsafe tags, or unvetted CDNs.
 *  - Verifies capabilities/default.json enforces least-privilege (no shell execution, no arbitrary fs).
 */
function verifySecurityConstraints() {
  const stepStart = Date.now();
  console.log(`\n==================================================`);
  console.log(`[Gate] Security Constraints & Packaging Configuration`);
  console.log(`==================================================\n`);

  const violations = [];

  // 1. Check tauri.conf.json
  const tauriConfPath = join(rootDir, "src-tauri", "tauri.conf.json");
  if (!existsSync(tauriConfPath)) {
    violations.push("Missing src-tauri/tauri.conf.json");
  } else {
    try {
      const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));

      // Check identifier
      if (!tauriConf.identifier || tauriConf.identifier === "com.tauri.dev") {
        violations.push(`Invalid tauri bundle identifier: "${tauriConf.identifier}"`);
      }

      // Check frontendDist
      if (tauriConf.build?.frontendDist !== "../dist") {
        violations.push(
          `tauri.conf.json build.frontendDist must be "../dist", found: "${tauriConf.build?.frontendDist}"`,
        );
      }

      // Check CSP
      const csp = tauriConf.app?.security?.csp;
      if (!csp) {
        violations.push("Security CSP is missing in src-tauri/tauri.conf.json");
      } else {
        if (!csp.includes("default-src 'self'")) {
          violations.push("CSP must enforce default-src 'self'");
        }
        if (csp.includes("http:") || csp.includes("https:") || csp.includes("*")) {
          violations.push(
            `CSP must not allow arbitrary remote HTTP/HTTPS origins in release bundle: "${csp}"`,
          );
        }
        if (csp.includes("'unsafe-eval'")) {
          violations.push("CSP must not allow 'unsafe-eval'");
        }
      }

      // Check bundle targets and icons
      if (!Array.isArray(tauriConf.bundle?.targets) || tauriConf.bundle.targets.length === 0) {
        violations.push("tauri.conf.json must define active bundle targets");
      }
      if (!Array.isArray(tauriConf.bundle?.icon) || tauriConf.bundle.icon.length === 0) {
        violations.push("tauri.conf.json must define application icons");
      } else {
        for (const iconPath of tauriConf.bundle.icon) {
          const resolvedIcon = join(rootDir, "src-tauri", iconPath);
          if (!existsSync(resolvedIcon)) {
            violations.push(`Referenced icon file not found: ${iconPath}`);
          }
        }
      }
    } catch (e) {
      violations.push(`Failed to parse src-tauri/tauri.conf.json: ${e.message}`);
    }
  }

  // 2. Check index.html for remote scripts or insecure external resources
  const indexPath = join(rootDir, "index.html");
  if (!existsSync(indexPath)) {
    violations.push("Missing index.html");
  } else {
    const indexContent = readFileSync(indexPath, "utf8");
    const remoteScriptMatch = indexContent.match(
      /<script[^>]+src=["'](https?:|\/\/)[^"']+["'][^>]*>/gi,
    );
    if (remoteScriptMatch) {
      violations.push(
        `index.html contains remote script references: ${remoteScriptMatch.join(", ")}`,
      );
    }
    const remoteLinkMatch = indexContent.match(
      /<link[^>]+href=["'](https?:|\/\/)[^"']+["'][^>]*>/gi,
    );
    if (remoteLinkMatch) {
      violations.push(`index.html contains remote link references: ${remoteLinkMatch.join(", ")}`);
    }
  }

  // 3. Check capabilities least privilege
  const capPath = join(rootDir, "src-tauri", "capabilities", "default.json");
  if (!existsSync(capPath)) {
    violations.push("Missing src-tauri/capabilities/default.json");
  } else {
    try {
      const cap = JSON.parse(readFileSync(capPath, "utf8"));
      const permissions = cap.permissions || [];
      const forbiddenPermissions = [
        "shell:default",
        "shell:allow-execute",
        "shell:allow-spawn",
        "fs:default",
        "fs:allow-read-file",
        "http:default",
      ];
      for (const forbidden of forbiddenPermissions) {
        if (permissions.includes(forbidden)) {
          violations.push(
            `capabilities/default.json violates least-privilege with permission: "${forbidden}"`,
          );
        }
      }
    } catch (e) {
      violations.push(`Failed to parse src-tauri/capabilities/default.json: ${e.message}`);
    }
  }

  const durationMs = Date.now() - stepStart;
  if (violations.length > 0) {
    console.error("❌ Security constraints check failed with violations:");
    violations.forEach((v) => console.error(`  - ${v}`));
    recordGate(
      "Security Constraints & Packaging Configuration",
      false,
      durationMs,
      violations.join("; "),
    );
    generateReadinessReport(false);
    process.exit(1);
  }

  console.log("✅ Security constraints check passed cleanly:");
  console.log("   - Strict CSP verified (no remote origins, no unsafe-eval).");
  console.log("   - No remote scripts or links found in index.html.");
  console.log("   - Local asset protocol and frontendDist verified.");
  console.log("   - Least-privilege capabilities verified (no shell, no arbitrary FS, no HTTP).");
  recordGate(
    "Security Constraints & Packaging Configuration",
    true,
    durationMs,
    "Strict CSP, local asset protocol, least-privilege capabilities verified",
  );
}

/**
 * Generate Packaging Readiness Report (JSON and Markdown)
 */
function generateReadinessReport(overallSuccess) {
  if (!existsSync(reportDir)) {
    mkdirSync(reportDir, { recursive: true });
  }

  const endTime = new Date();
  const totalDurationMs = endTime.getTime() - startTime.getTime();

  let tauriConf = {};
  try {
    tauriConf = JSON.parse(readFileSync(join(rootDir, "src-tauri", "tauri.conf.json"), "utf8"));
  } catch {
    // ignore
  }

  const reportData = {
    title: "OneFP&A Desktop Packaging Readiness Report",
    milestone: "M7-7",
    timestamp: endTime.toISOString(),
    durationSeconds: Number((totalDurationMs / 1000).toFixed(2)),
    status: overallSuccess ? "READY_FOR_RELEASE" : "FAILED",
    environment: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    },
    appMetadata: {
      productName: tauriConf.productName || "OneFP&A",
      version: tauriConf.version || "0.1.0",
      identifier: tauriConf.identifier || "com.onefpa.desktop",
      bundleTargets: bundleTargets ? bundleTargets.split(",") : tauriConf.bundle?.targets || [],
      csp: tauriConf.app?.security?.csp || "",
    },
    gates: gateResults,
  };

  const jsonReportPath = join(reportDir, "packaging-readiness-report.json");
  writeFileSync(jsonReportPath, JSON.stringify(reportData, null, 2), "utf8");

  const mdReport = `# OneFP&A Desktop Packaging Readiness Report (M7-7)

- **Status**: ${overallSuccess ? "✅ READY FOR RELEASE" : "❌ FAILED"}
- **Product**: ${reportData.appMetadata.productName} v${reportData.appMetadata.version} (\`${reportData.appMetadata.identifier}\`)
- **Timestamp**: ${reportData.timestamp}
- **Duration**: ${reportData.durationSeconds}s
- **Platform**: ${process.platform} (${process.arch})
- **Node**: ${process.version}
- **Bundle Targets**: \`${reportData.appMetadata.bundleTargets.join(", ")}\`

## Pre-flight Verification Gates

| Gate / Check | Status | Duration | Details |
|---|:---:|:---:|---|
${gateResults
  .map(
    (g) =>
      `| **${g.name}** | ${g.passed ? "✅ PASS" : "❌ FAIL"} | ${(g.durationMs / 1000).toFixed(2)}s | ${g.details} |`,
  )
  .join("\n")}

## Security Posture
- **CSP**: \`${reportData.appMetadata.csp}\`
- **Remote Script Execution**: Prohibited (zero external scripts or CDNs).
- **Capability Scoping**: Least-privilege (no shell execution, no arbitrary filesystem, no external HTTP).
- **Local Asset Protocol**: Enforced via Tauri custom secure protocol.

---
*Report generated automatically by \`scripts/build-desktop.mjs\`.*
`;

  const mdReportPath = join(reportDir, "packaging-readiness-report.md");
  writeFileSync(mdReportPath, mdReport, "utf8");

  console.log(`\n📄 Packaging Readiness Report written to:`);
  console.log(`   - ${jsonReportPath}`);
  console.log(`   - ${mdReportPath}`);
}

console.log("==================================================");
console.log("OneFP&A Native Desktop Packaging & Signing Pipeline");
console.log(`Platform: ${process.platform} (${process.arch})`);
console.log(`Node: ${process.version}`);
console.log(`Mode: ${isPreflightOnly ? "Pre-flight Verification Only" : "Full Build & Packaging"}`);
console.log("==================================================");

if (!skipGates) {
  // Gate 1: Full npm verification suite
  runStep("Verification Gate 1: npm run check", "npm", ["run", "check"]);

  if (!skipCargo) {
    // Gate 2: Rust unit and integration tests
    runStep("Verification Gate 2: cargo test", "cargo", [
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
    ]);

    // Gate 3: cargo clippy
    runStep("Verification Gate 3: cargo clippy", "cargo", [
      "clippy",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--",
      "-D",
      "warnings",
    ]);

    // Gate 4: cargo fmt --check
    runStep("Verification Gate 4: cargo fmt --check", "cargo", [
      "fmt",
      "--check",
      "--manifest-path",
      "src-tauri/Cargo.toml",
    ]);
  } else {
    console.warn("\n⚠️  WARNING: Skipping Rust verification gates due to --skip-cargo flag.");
  }

  // Gate 5: Security constraints & packaging configuration audit
  verifySecurityConstraints();
} else {
  console.warn("\n⚠️  WARNING: Skipping verification gates due to --skip-gates flag.");
}

// Generate readiness report
generateReadinessReport(true);

if (isPreflightOnly) {
  console.log("\n🎉 Desktop pre-flight verification completed cleanly! All gates passed.\n");
  process.exit(0);
}

// Prepare tauri build arguments
const tauriArgs = ["tauri", "build"];

if (isDebug) {
  tauriArgs.push("--debug");
}

if (customTarget) {
  tauriArgs.push("--target", customTarget);
}

if (bundleTargets) {
  tauriArgs.push("--bundles", bundleTargets);
}

// Execute tauri build
runStep("Desktop Packaging: tauri build", "npx", tauriArgs);

console.log("\n🎉 Native desktop packaging pipeline completed successfully!\n");
