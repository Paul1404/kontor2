import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests need a real database; they run via the separate
    // `vitest.integration.config.ts` (bun run test:int), never in the fast suite.
    exclude: ["**/node_modules/**", "**/dist/**", "tests/integration/**"],
    globals: false,
  },
});
