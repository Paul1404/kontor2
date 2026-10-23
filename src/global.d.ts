// Load the TanStack Start type augmentations globally. Start adds the `server`
// option (request handlers, server middleware) to file-route options via a
// `declare module "@tanstack/router-core"` augmentation that ships in
// `@tanstack/react-start`. Nothing in `src` imports that package directly, so
// without this reference the augmentation never enters the program and
// `createFileRoute(...)({ server: ... })` fails to typecheck.
/// <reference types="@tanstack/react-start" />

// Installed by the server bundle (src/server/lib/lifecycle.ts) so the slim
// runtime entrypoint (scripts/serve.ts), which can't import `~/server/*`, can
// release the DB pool, Redis client, and buffered log sink on shutdown.
declare var __kontor2CloseResources: (() => Promise<void>) | undefined;

declare module "*.css?url" {
  const url: string;
  export default url;
}

declare module "*.css" {
  const css: string;
  export default css;
}

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.png" {
  const src: string;
  export default src;
}
