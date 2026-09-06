/**
 * GL Import Benchmarking Suite (M7-3 · PERFORMANCE-REQUIREMENTS §2 · B3/B18-2).
 *
 * Ingestion & parse throughput:
 * Benchmark: 500k-row GL trial balance ingestion & parse throughput.
 * Target: <5s for 500k rows. Measures MB/s and rows/sec.
 *
 * Adheres strictly to Zero-Compromise rules:
 * - Integer minor units and Decimal.js only (no floats for money, no parseFloat, no Math.round, no Number()).
 * - Deterministic dataset generation conforming to GL-TEMPLATE-SPEC §2.
 */

import { bench, describe } from "vitest";
import Decimal from "decimal.js";

export interface BenchmarkParseResult {
  rowCount: number;
  sizeBytes: number;
  durationMs: number;
  throughputMBps: number;
  rowsPerSec: number;
  debitMinorSum: Decimal;
  creditMinorSum: Decimal;
}

/**
 * Generate synthetic canonical CSV trial balance data with N rows.
 * Uses exact 2-decimal strings and guaranteed debit == credit balance.
 */
export function generateSyntheticGLCsv(rowCount: number): string {
  const header =
    "period,account_code,account_name,debit,credit,cost_center,business_unit,currency,posting_ref,doc_type\n";
  const lines: string[] = [header];

  // Produce pairs of debit and credit rows to maintain strict trial balance tie-out
  for (let i = 0; i < rowCount; i += 2) {
    const period = "2026-08";
    const ref = `INV-${period}-${String(Math.floor(i / 2) + 1).padStart(7, "0")}`;
    const amountStr = "18250.00";

    // Row 1: Debit Accounts Receivable (1200)
    lines.push(
      `${period},1200,Accounts Receivable,${amountStr},,sales_north,bu-manu,USD,${ref},INVOICE\n`,
    );

    // Row 2: Credit Sales Revenue (4000)
    if (i + 1 < rowCount) {
      lines.push(
        `${period},4000,Sales Revenue,,${amountStr},sales_north,bu-manu,USD,${ref},INVOICE\n`,
      );
    }
  }

  return lines.join("");
}

/**
 * Fast canonical CSV parse & decimal normalisation engine
 * adhering to B3 / MONEY-ROUNDING-SPEC §2 / GL-TEMPLATE-SPEC §2.
 */
export function parseAndIngestGLCsv(csvText: string): BenchmarkParseResult {
  const start = performance.now();
  const sizeBytes = csvText.length; // 1 char = 1 byte for ASCII CSV

  let rowCount = 0;
  let debitSumMinor = new Decimal(0);
  let creditSumMinor = new Decimal(0);

  let lineStart = 0;
  let isHeader = true;

  while (lineStart < csvText.length) {
    let lineEnd = csvText.indexOf("\n", lineStart);
    if (lineEnd === -1) {
      lineEnd = csvText.length;
    }

    const line = csvText.slice(lineStart, lineEnd).trim();
    lineStart = lineEnd + 1;

    if (!line) continue;

    if (isHeader) {
      isHeader = false;
      continue;
    }

    rowCount++;

    // Fast split by comma for standard Canonical GL
    // period,account_code,account_name,debit,credit,cost_center,business_unit,currency,posting_ref,doc_type
    const parts = line.split(",");
    const debitText = parts[3]?.trim();
    const creditText = parts[4]?.trim();

    if (debitText) {
      // Convert exact decimal string to minor units without float
      const dec = new Decimal(debitText);
      const minor = dec.mul(100);
      debitSumMinor = debitSumMinor.plus(minor);
    }

    if (creditText) {
      const dec = new Decimal(creditText);
      const minor = dec.mul(100);
      creditSumMinor = creditSumMinor.plus(minor);
    }
  }

  const durationMs = performance.now() - start;
  const durationSec = durationMs / 1000;
  const sizeMB = sizeBytes / (1024 * 1024);

  return {
    rowCount,
    sizeBytes,
    durationMs,
    throughputMBps: durationSec > 0 ? sizeMB / durationSec : 0,
    rowsPerSec: durationSec > 0 ? rowCount / durationSec : 0,
    debitMinorSum: debitSumMinor,
    creditMinorSum: creditSumMinor,
  };
}

describe("GL Import 500k-row Ingestion Benchmark", () => {
  // Generate fixture for the bench test
  // 50k rows in microbench iterations, and 500k run in full runner
  const csv50k = generateSyntheticGLCsv(50_000);

  bench("GL Import parse & ingest (50k sample batch)", () => {
    parseAndIngestGLCsv(csv50k);
  });
});
