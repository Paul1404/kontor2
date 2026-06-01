import { describe, expect, it } from "vitest";
import {
  createView,
  parseStoredViews,
  serializeViews,
  type ViewSearch,
  viewSearchEquals,
} from "~/lib/saved-views";

const SEARCH: ViewSearch = {
  q: "müller",
  status: "passiv",
  abteilungId: "abt-1",
  includeAusgetretene: true,
  orphanOnly: false,
  sortBy: "ort",
  sortDir: "desc",
};

describe("parseStoredViews", () => {
  it("returns [] for null / empty / garbage", () => {
    expect(parseStoredViews(null)).toEqual([]);
    expect(parseStoredViews("")).toEqual([]);
    expect(parseStoredViews("not json{")).toEqual([]);
    expect(parseStoredViews("{}")).toEqual([]);
    expect(parseStoredViews("42")).toEqual([]);
  });

  it("drops entries without an id or name", () => {
    const raw = JSON.stringify([
      { id: "a", name: "Aktive", search: {} },
      { id: "b" },
      { name: "no id" },
      { id: "c", name: "   ", search: {} },
    ]);
    const views = parseStoredViews(raw);
    expect(views).toHaveLength(1);
    expect(views[0]?.name).toBe("Aktive");
  });

  it("coerces an unknown status / sort to safe defaults", () => {
    const raw = JSON.stringify([
      { id: "a", name: "Weird", search: { status: "hacked", sortBy: "drop table", sortDir: "x" } },
    ]);
    const [view] = parseStoredViews(raw);
    expect(view?.search.status).toBe("aktiv");
    expect(view?.search.sortBy).toBe("nachname");
    expect(view?.search.sortDir).toBe("asc");
  });

  it("round-trips a serialized view", () => {
    const view = createView("Passive Müllers", SEARCH);
    const restored = parseStoredViews(serializeViews([view]));
    expect(restored).toHaveLength(1);
    expect(restored[0]?.id).toBe(view.id);
    expect(restored[0]?.name).toBe("Passive Müllers");
    expect(restored[0]?.search).toEqual(SEARCH);
  });
});

describe("createView", () => {
  it("trims the name and assigns a non-empty id", () => {
    const view = createView("  Meine Ansicht  ", SEARCH);
    expect(view.name).toBe("Meine Ansicht");
    expect(view.id.length).toBeGreaterThan(0);
  });
});

describe("viewSearchEquals", () => {
  it("is true for identical searches", () => {
    expect(viewSearchEquals(SEARCH, { ...SEARCH })).toBe(true);
  });

  it("is false when any field differs", () => {
    expect(viewSearchEquals(SEARCH, { ...SEARCH, q: "other" })).toBe(false);
    expect(viewSearchEquals(SEARCH, { ...SEARCH, sortDir: "asc" })).toBe(false);
    expect(viewSearchEquals(SEARCH, { ...SEARCH, abteilungId: null })).toBe(false);
  });
});
