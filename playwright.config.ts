import { defineConfig } from "@playwright/test";

/**
 * E2E: UI smoke flows against the Vite DEV server (webview parity surface; tauri-driver
 * runs in release CI). The dev server is required because the mock core that answers
 * commands outside Tauri is DEV-ONLY and tree-shaken from production builds (B18-7,
 * WS-08) — a production bundle must never contain it.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0, // CI-CD §6.2: never mask flakes with retries
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: "npm run dev -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
