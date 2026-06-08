import { describe, expect, it } from "vitest";
import { errorLogFields } from "~/server/orpc/base";

describe("errorLogFields", () => {
  it("returns the plain message for a bare error", () => {
    expect(errorLogFields(new Error("boom"))).toEqual({ error: "boom" });
  });

  it("stringifies non-Error throwables", () => {
    expect(errorLogFields("nope")).toEqual({ error: "nope" });
  });

  it("unwraps a Drizzle-style wrapped pg error to expose reason and SQLSTATE", () => {
    // Mirrors how Drizzle surfaces a failed query: the outer error only says
    // "Failed query", the real reason and SQLSTATE live on the wrapped cause.
    const pgError = Object.assign(new Error('column "x" does not exist'), { code: "42703" });
    const wrapped = new Error("Failed query: select ...");
    wrapped.cause = pgError;

    expect(errorLogFields(wrapped)).toEqual({
      error: "Failed query: select ...",
      cause: 'column "x" does not exist',
      pgCode: "42703",
    });
  });

  it("prefers a SQLSTATE code carried on the top-level error", () => {
    const err = Object.assign(new Error("direct pg error"), { code: "23505" });
    expect(errorLogFields(err)).toEqual({ error: "direct pg error", pgCode: "23505" });
  });

  it("walks several cause levels without looping forever", () => {
    const inner = Object.assign(new Error("root reason"), { code: "40001" });
    const mid = new Error("mid");
    mid.cause = inner;
    const outer = new Error("outer");
    outer.cause = mid;

    expect(errorLogFields(outer)).toEqual({
      error: "outer",
      cause: "root reason",
      pgCode: "40001",
    });
  });
});
