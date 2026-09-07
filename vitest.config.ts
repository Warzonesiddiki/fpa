import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    testTimeout: 15000,
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/test/**",
        "src/**/*.test.{ts,tsx}",
        "src/**/*.bench.{ts,tsx}",
        "src/main.tsx",
        "src/components/ui/index.ts",
        // Dev-only mock core (B18-3/WS-08): tree-shaken from every production
        // bundle — it is browser-preview tooling, not product code, so it must not
        // dilute the product coverage gate. The mock's own contract tests run in
        // mock.test.ts; this exclusion does NOT change any threshold.
        "src/api/mock.ts",
      ],
      thresholds: {
        // Stage 3 gate — overall ≥85 lines / 80 branches (CI-CD §2.3); critical gate runs separately
        lines: 85,
        functions: 80,
        branches: 80,
        statements: 85,
      },
    },
  },
});
