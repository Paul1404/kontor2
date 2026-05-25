#!/usr/bin/env bun
/**
 * One-shot: regenerate `src/routes/routeTree.gen.ts` from the current
 * filesystem layout. The TanStack Router Vite plugin normally does this on
 * `vite dev` / `vite build`; this script is the headless equivalent for
 * cases like CI or when running `bun run typecheck` after adding a route
 * without booting Vite.
 */
import { Generator, getConfig } from "@tanstack/router-generator";

const config = await getConfig({
  target: "react",
  routesDirectory: "./src/routes",
  generatedRouteTree: "./src/routes/routeTree.gen.ts",
  routeFileIgnorePattern: "routeTree\\.gen\\.ts",
});

const generator = new Generator({ config, root: process.cwd() });
await generator.run();
console.log("routeTree.gen.ts regenerated");
