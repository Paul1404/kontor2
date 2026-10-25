import { createRequire } from "node:module";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("patched transitive dependencies", () => {
  it("generates UUID-backed Excel formatting and reopens the workbook", async () => {
    const excelRequire = createRequire(require.resolve("exceljs/package.json"));
    const { v4, validate, version } = excelRequire("uuid");
    const JSZip = excelRequire("jszip");
    const id = v4();
    expect(validate(id)).toBe(true);
    expect(version(id)).toBe(4);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Compatibility");
    sheet.addRows([[10], [50], [90]]);
    sheet.addConditionalFormatting({
      ref: "A1:A3",
      rules: [
        {
          type: "iconSet",
          iconSet: "3Triangles",
          priority: 1,
          cfvo: [
            { type: "percent", value: 0 },
            { type: "percent", value: 33 },
            { type: "percent", value: 67 },
          ],
        },
      ],
    });
    const bytes = await workbook.xlsx.writeBuffer();
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    const generatedId = xml.match(/id="\{([0-9A-F-]{36})\}"/i)?.[1];
    expect(generatedId).toBeDefined();
    expect(validate(generatedId)).toBe(true);
    expect(version(generatedId)).toBe(4);
    expect(xml).toContain('iconSet="3Triangles"');

    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(bytes);
    expect(reopened.getWorksheet("Compatibility")?.getCell("A2").value).toBe(50);
  });

  it("keeps synchronous and asynchronous TypeScript transforms usable by the legacy loader", async () => {
    const kitRequire = createRequire(require.resolve("drizzle-kit"));
    const loaderRequire = createRequire(kitRequire.resolve("@esbuild-kit/esm-loader"));
    const { transformSync, transform } = loaderRequire("@esbuild-kit/core-utils");
    const source = "const value: number = 42; export default value;";
    const synchronous = transformSync(source, "/tmp/compatibility.ts");
    expect(synchronous.code).not.toContain(": number");
    const module = { exports: {} as { default?: number } };
    new Function("module", "exports", "require", synchronous.code)(module, module.exports, require);
    expect(module.exports.default).toBe(42);
    expect(synchronous.map).toBeDefined();

    const asynchronous = await transform(source, "/tmp/compatibility.ts");
    expect(asynchronous.code).not.toContain(": number");
    const url = `data:text/javascript;base64,${Buffer.from(asynchronous.code).toString("base64")}`;
    const loaded = await import(/* @vite-ignore */ url);
    expect(loaded.default).toBe(42);
    expect(asynchronous.map).toBeDefined();
  });
});
