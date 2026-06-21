import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";
import { envOnlyMacros } from "vite-env-only";

const routerOptions = {
  target: "react" as const,
  autoCodeSplitting: false,
  routesDirectory: "./src/routes",
  generatedRouteTree: "./src/routes/routeTree.gen.ts",
  routeFileIgnorePattern: "routeTree\\.gen\\.ts",
};

// The production build (command === "build") keeps the original, verified plugin
// pipeline untouched. Dev (vite dev) needs React Fast Refresh: tanstackStart
// requires a React Refresh runtime, and viteReact provides it. In dev we let
// tanstackStart bundle the router instead of also running a standalone
// tanstackRouter() — having both would double the code-splitter and clash with
// Fast Refresh ("Duplicate declaration hot").
export default defineConfig(({ command }) => ({
  server: {
    port: Number(process.env.PORT ?? 3000),
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins:
    command === "serve"
      ? [tailwindcss(), envOnlyMacros(), tanstackStart(), viteReact()]
      : [tanstackRouter(routerOptions), tailwindcss(), envOnlyMacros(), tanstackStart()],
}));
