import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: "npm run dev -- --host 127.0.0.1 --port 4174",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: true,
      timeout: 30_000
    },
    {
      command: "npm run preview:pages -- --host 127.0.0.1 --port 4175",
      url: "http://127.0.0.1:4175/loader.js",
      reuseExistingServer: true,
      timeout: 30_000
    }
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13 Mini"] } }
  ]
});
