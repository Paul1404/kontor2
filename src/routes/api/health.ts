import { createFileRoute } from "@tanstack/react-router";

/**
 * Deployment healthcheck (Railway `healthcheckPath`). A bare `{ ok: true }`
 * cannot tell a working runtime from a broken one: a slim-image build that
 * accidentally drops a runtime dependency still answers JSON fine while every
 * server-rendered page 500s. So the check actually exercises the most fragile
 * runtime path -- the PDF renderer, whose `@react-pdf/renderer -> fontkit`
 * chain pulls in runtime helper libraries that an over-eager image prune can
 * remove. If a required module is missing the render throws and we answer 503,
 * which makes Railway reject the deploy instead of letting it go live.
 *
 * The render is cached after the first success: the module graph is fixed for
 * the life of the process, so later healthchecks are a constant-time read.
 */
let runtimeOk = false;

async function checkRuntime(): Promise<boolean> {
  if (runtimeOk) return true;
  try {
    const { Document, Page, Text, renderToBuffer } = await import("@react-pdf/renderer");
    const { createElement: h } = await import("react");
    const doc = h(Document, null, h(Page, null, h(Text, null, "ok")));
    // biome-ignore lint/suspicious/noExplicitAny: react-pdf's element type is internal.
    const buf = await renderToBuffer(doc as any);
    runtimeOk = buf.length > 0;
    return runtimeOk;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const ok = await checkRuntime();
        return Response.json({ ok, time: new Date().toISOString() }, { status: ok ? 200 : 503 });
      },
    },
  },
});
