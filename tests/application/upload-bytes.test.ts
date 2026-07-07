import { describe, expect, it } from "vitest";
import {
  decodeBase64Upload,
  extensionForMimeType,
  MIB,
  maxBase64Length,
} from "~/server/application/upload-bytes";

describe("upload byte helpers", () => {
  it("rejects malformed base64 instead of accepting decoded garbage", () => {
    expect(() => decodeBase64Upload("not base64 ***", MIB, "too large")).toThrow(
      "Datei konnte nicht gelesen werden.",
    );
  });

  it("caps encoded input before decoding", () => {
    const oversized = "A".repeat(maxBase64Length(1) + 4);
    expect(() => decodeBase64Upload(oversized, 1, "too large")).toThrow("too large");
  });

  it("uses MIME type, not filename, for stored upload suffixes", () => {
    expect(extensionForMimeType("application/pdf")).toBe("pdf");
    expect(extensionForMimeType("image/jpeg")).toBe("jpg");
    expect(extensionForMimeType("text/html")).toBeNull();
  });
});
