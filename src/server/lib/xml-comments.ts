/** Remove well-formed XML comments without treating this as HTML sanitization. */
export function stripXmlComments(input: string): string {
  const parts: string[] = [];
  let cursor = 0;
  for (;;) {
    const start = input.indexOf("<!--", cursor);
    if (start < 0) break;
    const end = input.indexOf("-->", start + 4);
    if (end < 0 || input.slice(start + 4, end).includes("--")) {
      throw new Error("Ungültiger XML-Kommentar.");
    }
    parts.push(input.slice(cursor, start));
    cursor = end + 3;
  }
  parts.push(input.slice(cursor));
  const xml = parts.join("");
  if (xml.includes("<!--")) throw new Error("Ungültiger XML-Kommentar.");
  return xml;
}
