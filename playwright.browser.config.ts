import { defineConfig } from "@playwright/test";

/** Isolated browser regressions for shared UI. No database or app server needed. */
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "*.spec.ts",
  workers: 1,
  reporter: "list",
  use: { browserName: "chromium" },
});
