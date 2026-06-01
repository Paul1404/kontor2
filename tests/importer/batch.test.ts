import { describe, expect, it, vi } from "vitest";
import { chunkedWrite } from "~/server/importer/batch";

describe("chunkedWrite", () => {
  it("writes everything in chunks when no chunk fails", async () => {
    const rows = Array.from({ length: 23 }, (_, i) => i);
    const chunks: number[][] = [];
    const writeOne = vi.fn();
    const written = await chunkedWrite(rows, {
      chunkSize: 10,
      writeChunk: async (c) => {
        chunks.push(c);
      },
      writeOne,
      onError: () => {},
    });
    expect(written).toBe(23);
    expect(chunks.map((c) => c.length)).toEqual([10, 10, 3]);
    // No chunk failed, so the per-row path is never touched.
    expect(writeOne).not.toHaveBeenCalled();
  });

  it("falls back to per-row when a chunk fails and isolates the bad row", async () => {
    const rows = [1, 2, 3, 4]; // 3 is poison
    const onError = vi.fn();
    const written = await chunkedWrite(rows, {
      chunkSize: 4,
      writeChunk: async (c) => {
        if (c.includes(3)) throw new Error("chunk failed");
      },
      writeOne: async (r) => {
        if (r === 3) throw new Error("bad row 3");
      },
      onError,
    });
    // 1, 2, 4 succeed individually; only 3 is reported.
    expect(written).toBe(3);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe(3);
    expect((onError.mock.calls[0]?.[1] as Error).message).toBe("bad row 3");
  });

  it("only retries the failing chunk row-by-row, not the healthy ones", async () => {
    const rows = [1, 2, 3, 4, 5, 6]; // chunk [4,5,6] fails
    const perRow: number[] = [];
    await chunkedWrite(rows, {
      chunkSize: 3,
      writeChunk: async (c) => {
        if (c.includes(5)) throw new Error("nope");
      },
      writeOne: async (r) => {
        perRow.push(r);
      },
      onError: () => {},
    });
    expect(perRow).toEqual([4, 5, 6]);
  });

  it("reports cumulative progress after each chunk", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => i);
    const seen: number[] = [];
    await chunkedWrite(rows, {
      chunkSize: 10,
      writeChunk: async () => {},
      writeOne: async () => {},
      onError: () => {},
      onProgress: (p) => seen.push(p),
    });
    expect(seen).toEqual([10, 20, 25]);
  });

  it("returns 0 and does nothing for an empty input", async () => {
    const writeChunk = vi.fn();
    const written = await chunkedWrite([], {
      writeChunk,
      writeOne: async () => {},
      onError: () => {},
    });
    expect(written).toBe(0);
    expect(writeChunk).not.toHaveBeenCalled();
  });
});
