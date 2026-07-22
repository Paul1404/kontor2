#!/usr/bin/env bun
/**
 * Launch a completely disposable Kontor2 instance for interactive browser QA.
 *
 * The sandbox uses the tmpfs-backed integration-test Postgres and Redis on
 * their offset ports, creates a fresh admin, and starts Vite on port 3100 by
 * default. Ctrl-C stops the server and removes the containers and their data.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createTestEnv } from "./test-env";

const COMPOSE = ["compose", "-f", "docker-compose.test.yml"];
const DEFAULT_PORT = 3100;

export type SandboxCredentials = {
  name: string;
  email: string;
  password: string;
};

export function createSandboxCredentials(): SandboxCredentials {
  const token = randomBytes(6).toString("hex");
  return {
    name: "Sandbox Admin",
    email: `sandbox-${token}@example.test`,
    password: `Sandbox-${randomBytes(12).toString("base64url")}`,
  };
}

export function sandboxPort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("SANDBOX_PORT muss eine ganze Zahl zwischen 1024 und 65535 sein.");
  }
  return port;
}

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: env ?? process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} ist mit Status ${result.status ?? 1} beendet.`);
  }
}

function docker(args: string[], allowFailure = false): void {
  try {
    run("docker", [...COMPOSE, ...args]);
  } catch (error) {
    if (!allowFailure) throw error;
    console.warn(
      `[sandbox] Aufräumen übersprungen: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function seedAdmin(credentials: SandboxCredentials): Promise<void> {
  const [{ completeSetup }, { closeDb }, { closeRedis }, { primaryTenant }] = await Promise.all([
    import("../src/server/auth/setup"),
    import("../src/server/db/client"),
    import("../src/server/redis/client"),
    import("../src/server/tenants/resolve"),
  ]);

  try {
    const result = await completeSetup(primaryTenant(), credentials);
    if (!result.ok) {
      throw new Error(result.message ?? `Admin konnte nicht angelegt werden: ${result.reason}`);
    }
  } finally {
    await Promise.all([closeDb(), closeRedis()]);
  }
}

async function waitUntilReady(baseUrl: string, server: ChildProcess): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Sandbox-Server wurde vorzeitig mit Status ${server.exitCode} beendet.`);
    }
    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) return;
    } catch {
      // Vite is still starting or compiling the first request.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Sandbox-Server unter ${baseUrl} wurde nicht rechtzeitig bereit.`);
}

async function waitForExit(server: ChildProcess): Promise<number> {
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", (code) => resolve(code ?? 0));
  });
}

export async function main(): Promise<void> {
  const port = sandboxPort(process.env.SANDBOX_PORT);
  const baseUrl = `http://localhost:${port}`;
  const credentials = createSandboxCredentials();
  const sandboxEnv = { ...process.env, ...createTestEnv(baseUrl), PORT: String(port) };
  let server: ChildProcess | undefined;
  let stopRequested = false;

  const requestStop = () => {
    stopRequested = true;
    server?.kill("SIGTERM");
  };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  try {
    console.log("[sandbox] alte Test-Instanz entfernen…");
    docker(["down", "-v", "--remove-orphans"]);
    if (stopRequested) return;

    console.log("[sandbox] Postgres und Redis starten…");
    docker(["up", "-d", "--wait"]);
    if (stopRequested) return;

    console.log("[sandbox] Migrationen anwenden…");
    run("bun", ["scripts/migrate-all.ts"], sandboxEnv);
    Object.assign(process.env, sandboxEnv);

    console.log("[sandbox] temporären Admin anlegen…");
    await seedAdmin(credentials);
    if (stopRequested) return;

    console.log("[sandbox] App starten…");
    server = spawn(
      "bunx",
      ["vite", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
      {
        cwd: process.cwd(),
        env: sandboxEnv,
        stdio: "inherit",
      },
    );
    await waitUntilReady(baseUrl, server);

    console.log("\nKontor2 Sandbox ist bereit");
    console.log(`URL:      ${baseUrl}/login`);
    console.log(`E-Mail:   ${credentials.email}`);
    console.log(`Passwort: ${credentials.password}`);
    console.log("\nMit Ctrl-C beenden. Danach werden alle Sandbox-Daten gelöscht.\n");

    const exitCode = await waitForExit(server);
    if (!stopRequested && exitCode !== 0) {
      throw new Error(`Sandbox-Server ist mit Status ${exitCode} beendet.`);
    }
  } finally {
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
    if (server?.exitCode === null) server.kill("SIGTERM");
    console.log("[sandbox] temporäre Daten entfernen…");
    docker(["down", "-v", "--remove-orphans"], true);
    console.log("[sandbox] beendet");
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`[sandbox] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
