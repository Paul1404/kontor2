import ExcelJS from "exceljs";

export type Severity = "error" | "warn" | "info";

export type DqFindingRow = {
  pruefung: string;
  severity: Severity;
  schweregradLabel: string;
  reference: string;
  name: string;
  ort: string | null;
  email: string | null;
};

export type DqCountRow = {
  label: string;
  description: string;
  severity: Severity;
  count: number;
};

const SEVERITY_FILL: Record<Severity, string> = {
  error: "FFFDE2E1",
  warn: "FFFDF1D6",
  info: "FFEEF1F4",
};
const SEVERITY_FONT: Record<Severity, string> = {
  error: "FF991B1B",
  warn: "FF92400E",
  info: "FF374151",
};
const SEVERITY_LABEL: Record<Severity, string> = {
  error: "Fehler",
  warn: "Warnung",
  info: "Hinweis",
};
const HEADER_FALLBACK = "FF1F2937";

/** "#1E40AF" / "1e40af" -> "FF1E40AF"; null/ungültig -> Fallback. */
function toArgb(hex: string | null | undefined): string {
  const h = (hex ?? "").trim().replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(h) ? `FF${h}` : HEADER_FALLBACK;
}

/** Helle, kräftige Farbe? Dann dunkle Schrift, sonst weiße (grober Kontrast-Check). */
function headerFontColor(argb: string): string {
  const r = Number.parseInt(argb.slice(2, 4), 16);
  const g = Number.parseInt(argb.slice(4, 6), 16);
  const b = Number.parseInt(argb.slice(6, 8), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "FF1F2937" : "FFFFFFFF";
}

/**
 * Baut die Datenqualitäts-Auswertung als formatierte XLSX (Übersicht +
 * Befunde) und gibt sie als base64 zurück. Reines Server-Modul: exceljs darf
 * nicht ins Client-Bundle. Aufrufer importiert es nur in der oRPC-Prozedur.
 */
export async function buildDataQualityWorkbook(opts: {
  rows: DqFindingRow[];
  counts: DqCountRow[];
  title: string;
  primaryColor: string | null;
  generatedAt: Date;
}): Promise<string> {
  const headerArgb = toArgb(opts.primaryColor);
  const headerFont = headerFontColor(headerArgb);
  const total = opts.rows.length;
  const stamp = opts.generatedAt.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = opts.title;
  wb.created = opts.generatedAt;

  const severityCell = (cell: ExcelJS.Cell, severity: Severity) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SEVERITY_FILL[severity] } };
    cell.font = { color: { argb: SEVERITY_FONT[severity] }, bold: true };
    cell.alignment = { horizontal: "center" };
  };
  const styleHeaderRow = (row: ExcelJS.Row) => {
    row.height = 20;
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerArgb } };
      cell.font = { color: { argb: headerFont }, bold: true };
      cell.alignment = { vertical: "middle" };
    });
  };

  // --- Übersicht ---
  const ueb = wb.addWorksheet("Übersicht", {
    views: [{ state: "frozen", ySplit: 4 }],
  });
  ueb.columns = [
    { key: "label", width: 42 },
    { key: "severity", width: 14 },
    { key: "count", width: 10 },
    { key: "description", width: 80 },
  ];
  ueb.mergeCells("A1:D1");
  const titleCell = ueb.getCell("A1");
  titleCell.value = `Datenqualität · ${opts.title}`;
  titleCell.font = { size: 16, bold: true, color: { argb: headerFont } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerArgb } };
  titleCell.alignment = { vertical: "middle", indent: 1 };
  ueb.getRow(1).height = 30;
  ueb.mergeCells("A2:D2");
  const subCell = ueb.getCell("A2");
  subCell.value = `Stand ${stamp} · ${total} offene Hinweise`;
  subCell.font = { italic: true, color: { argb: "FF6B7280" } };
  subCell.alignment = { indent: 1 };

  const uebHeader = ueb.getRow(4);
  uebHeader.values = ["Prüfung", "Schweregrad", "Anzahl", "Beschreibung"];
  styleHeaderRow(uebHeader);

  const sevOrder: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
  const relevant = opts.counts
    .filter((c) => c.count > 0)
    .sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity] || b.count - a.count);
  let r = 5;
  for (const c of relevant) {
    const row = ueb.getRow(r);
    row.values = [c.label, SEVERITY_LABEL[c.severity], c.count, c.description];
    severityCell(row.getCell(2), c.severity);
    row.getCell(3).alignment = { horizontal: "center" };
    row.getCell(4).font = { color: { argb: "FF6B7280" }, size: 10 };
    row.getCell(1).font = { bold: true };
    r += 1;
  }
  ueb.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 4 } };

  // --- Befunde ---
  const bef = wb.addWorksheet("Befunde", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  bef.columns = [
    { header: "Prüfung", key: "pruefung", width: 38 },
    { header: "Schweregrad", key: "schweregrad", width: 14 },
    { header: "Mitgliedsnummer", key: "reference", width: 18 },
    { header: "Name", key: "name", width: 32 },
    { header: "Ort", key: "ort", width: 24 },
    { header: "E-Mail", key: "email", width: 34 },
  ];
  styleHeaderRow(bef.getRow(1));
  for (const row of opts.rows) {
    const added = bef.addRow({
      pruefung: row.pruefung,
      schweregrad: row.schweregradLabel,
      reference: row.reference,
      name: row.name,
      ort: row.ort ?? "",
      email: row.email ?? "",
    });
    severityCell(added.getCell(2), row.severity);
    added.getCell(3).font = { name: "Consolas", size: 10 };
  }
  bef.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 6 } };

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}
