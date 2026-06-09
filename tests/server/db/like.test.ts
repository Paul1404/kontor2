import { describe, expect, it } from "vitest";
import { escapeLike } from "~/server/db/like";

describe("escapeLike", () => {
  it("escapes LIKE wildcards so they match literally", () => {
    expect(escapeLike("50%")).toBe("50\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
  });

  it("escapes the backslash escape character itself", () => {
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  it("leaves ordinary search text untouched", () => {
    expect(escapeLike("Müller")).toBe("Müller");
    expect(escapeLike("Schmidt, Anna")).toBe("Schmidt, Anna");
  });
});
