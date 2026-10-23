#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { createDevEnv } from "./dev-env";

const environment = createDevEnv();
function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit", env: environment });
  if (result.error) {
    console.error(`[dev] ${command} could not start: ${result.error.message}`);
  }
  if (result.error || result.status !== 0) process.exit(result.status ?? 1);
}
function compose(args: string[]): void {
  run("docker", ["compose", "-f", "docker-compose.dev.yml", ...args]);
}
function up(): void {
  compose(["up", "-d", "--wait", "postgres", "redis", "minio"]);
  // MinIO can be running before it accepts connections; its bucket helper waits.
  compose(["run", "--rm", "createbucket"]);
  run("bun", ["run", "db:migrate"]);
}

switch (process.argv[2]) {
  case "up":
    up();
    break;
  case "reset":
    compose(["down", "-v"]);
    up();
    break;
  case "vite":
    run("bun", [
      "x",
      "vite",
      "dev",
      "--port",
      environment.PORT ?? "3000",
      ...process.argv.slice(3),
    ]);
    break;
  case "serve":
    run("bun", ["run", "build"]);
    run("bun", ["run", "start"]);
    break;
  default:
    console.error("Usage: bun scripts/dev.ts <up|reset|serve|vite>");
    process.exit(1);
}
