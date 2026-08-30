import { defineConfig } from "@playwright/test";

/** E2E: UI smoke flows against the Vite build (webview parity surface; tauri-driver runs in release CI). */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0, // CI-CD §6.2: never mask flakes with retries
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
