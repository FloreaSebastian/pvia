import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 8080);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

// Variant permet de séparer les rapports desktop / mobile en CI.
const VARIANT = process.env.E2E_VARIANT ?? "desktop";
const REPORT_DIR =
  process.env.PLAYWRIGHT_HTML_REPORT ?? `playwright-report-${VARIANT}`;
const RESULTS_DIR =
  process.env.PLAYWRIGHT_RESULTS_DIR ?? `test-results-${VARIANT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  outputDir: RESULTS_DIR,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: REPORT_DIR }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        // Pixel 7 fournit déjà viewport + deviceScaleFactor + isMobile + hasTouch
      },
    },
  ],
});
