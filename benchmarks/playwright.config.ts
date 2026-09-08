import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/performance/runtime",
  testMatch: "orchestrator.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 3_600_000,
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      args: [
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
    },
  },
});
