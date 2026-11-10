import { describe, expect, it } from "vitest";
import { handleLiveness } from "~/routes/api/live";

describe("liveness", () => {
  it("responds without dependency configuration and prevents caching", async () => {
    const response = handleLiveness();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
  });
});
