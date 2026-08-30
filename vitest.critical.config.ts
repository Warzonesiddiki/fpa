import { defineConfig } from "vitest/config";
import base from "./vitest.config";

/**
 * Stage 3 "critical modules" gate (CI-CD §2.3): money/bridge/schema/session must be ≥95 lines
 * and ≥90 branches. Runs after the global coverage gate.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    coverage: {
      ...base.test!.coverage,
      include: [
        "src/utils/money.ts",
        "src/api/schema.ts",
        "src/api/bridge.ts",
        "src/stores/session.ts",
        "src/components/domain/MoneyCell.tsx",
      ],
      thresholds: {
        lines: 95,
        functions: 90,
        branches: 90,
        statements: 95,
      },
    },
  },
});
