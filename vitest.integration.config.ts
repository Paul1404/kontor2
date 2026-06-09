import { defineConfig } from "vitest/config";

/**
 * Integration tests that talk to a real Postgres + Redis (see
 * docker-compose.test.yml). Run via `bun run test:int`, which starts the
 * stack, applies migrations, and sets the test env before invoking this.
 *
 * Kept separate from the default unit config so the fast `bun run test` suite
 * never needs a database. File parallelism is off: the suites share one
 * database and we don't want them stepping on each other.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globals: false,
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
