#!/usr/bin/env bun
/**
 * Spin up a throwaway Postgres + Redis for integration tests and run something
 * against them. The whole point is speed: `bun run test:int` brings the stack
 * up (tmpfs, so a couple of seconds), applies migrations, and runs the
 * integration suite, all with the right env wired in.
 *
 * Usage:
 *   bun scripts/test-db.ts up        # start containers, wait for health
 *   bun scripts/test-db.ts migrate   # apply Drizzle migrations to the test DB
 *   bun scripts/test-db.ts down      # stop and wipe
 *   bun scripts/test-db.ts run <cmd...>   # up + migrate, then run <cmd> with env
 *
 * Requires Docker. The test database is fully disposable; never point this at
 * a real database.
 */
import { spawnSync } from "node:child_process";
import { createTestEnv } from "./test-env";

const COMPOSE = ["compose", "-f", "docker-compose.test.yml"];

/**
 * Env handed to migrations and the test command. These are deliberate, safe
 * test-only values. APP_SECRET is 64 hex zeros (valid shape, no real secret).
 * AWS_* are placeholders so `env()` parses; tests that need S3 must mock it.
 */
const TEST_ENV = createTestEnv();

function run(cmd: string, args: string[], extraEnv: Record<string, string> = {}): number {
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (res.error) {
    console.error(`[test-db] failed to run ${cmd}: ${res.error.message}`);
    return 1;
  }
  return res.status ?? 1;
}

function docker(args: string[]): number {
  return run("docker", [...COMPOSE, ...args]);
}

function up(): number {
  console.log("[test-db] starting postgres + redis…");
  // `--wait` blocks until the healthchecks pass, so migrations never race the DB.
  return docker(["up", "-d", "--wait"]);
}

function down(): number {
  console.log("[test-db] tearing down…");
  return docker(["down", "-v"]);
}

function migrate(): number {
  console.log("[test-db] applying migrations…");
  return run("bun", ["scripts/migrate-all.ts"], TEST_ENV);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "up":
      process.exit(up());
      break;
    case "down":
      process.exit(down());
      break;
    case "migrate":
      process.exit(migrate());
      break;
    case "run": {
      if (rest.length === 0) {
        console.error("[test-db] run needs a command, e.g. `run vitest run`");
        process.exit(1);
      }
      const upCode = up();
      if (upCode !== 0) process.exit(upCode);
      const migrateCode = migrate();
      if (migrateCode !== 0) process.exit(migrateCode);
      const [cmd, ...args] = rest;
      process.exit(run(cmd as string, args, TEST_ENV));
      break;
    }
    default:
      console.log(
        "Usage: bun scripts/test-db.ts <up|down|migrate|run <cmd...>>\n" +
          "  up       start containers and wait for health\n" +
          "  migrate  apply migrations to the test DB\n" +
          "  down     stop and wipe\n" +
          "  run      up + migrate, then run a command with the test env",
      );
      process.exit(command ? 1 : 0);
  }
}

main();
