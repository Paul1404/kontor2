import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { desc, eq } from "drizzle-orm";
import * as v from "valibot";
import { bestandserhebungenTable } from "~/server/db/schema/bestandserhebungen";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { type CsvColumn, toCsv } from "~/server/lib/csv";
import { adminProc, vorstandProc } from "~/server/orpc/base";
import { renderPdfBase64 } from "~/server/pdf/renderer";
import { BestandserhebungDocument } from "~/server/pdf/templates/bestandserhebung";
import { computeBestandserhebung } from "~/server/verbandsmeldung/bestandserhebung";

const ISO_DATE = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/, "Erwartet YYYY-MM-DD"));

const ComputeInput = v.object({
  stichtag: ISO_DATE,
  abteilungIds: v.optional(v.array(v.pipe(v.string(), v.uuid())), []),
});

type CsvRow = {
  abteilungName: string;
  sportart: string;
  verbandName: string;
  verbandNr: string;
  male: number;
  female: number;
  divers: number;
  age_0_6: number;
  age_7_14: number;
  age_15_18: number;
  age_19_26: number;
  age_27_40: number;
  age_41_60: number;
  age_61_plus: number;
  age_unknown: number;
  total: number;
};

const CSV_COLUMNS: ReadonlyArray<CsvColumn<CsvRow>> = [
  { key: "abteilungName", label: "Abteilung" },
  { key: "sportart", label: "Sportart" },
  { key: "verbandName", label: "Verband" },
  { key: "verbandNr", label: "Verbands-Nr." },
  { key: "male", label: "Männlich" },
  { key: "female", label: "Weiblich" },
  { key: "divers", label: "Divers" },
  { key: "age_0_6", label: "0-6" },
  { key: "age_7_14", label: "7-14" },
  { key: "age_15_18", label: "15-18" },
  { key: "age_19_26", label: "19-26" },
  { key: "age_27_40", label: "27-40" },
  { key: "age_41_60", label: "41-60" },
  { key: "age_61_plus", label: "61+" },
  { key: "age_unknown", label: "unbekannt" },
  { key: "total", label: "Gesamt" },
];

function toCsvRows(data: Awaited<ReturnType<typeof computeBestandserhebung>>): CsvRow[] {
  const cellMap = new Map<string, number>();
  for (const c of data.cells) {
    cellMap.set(
      `${c.abteilungId}|${c.ageBucket}`,
      (cellMap.get(`${c.abteilungId}|${c.ageBucket}`) ?? 0) + c.count,
    );
  }
  return data.perAbteilung.map((a) => ({
    abteilungName: a.abteilungName,
    sportart: a.sportart ?? "",
    verbandName: a.verbandName ?? "",
    verbandNr: a.verbandNr ?? "",
    male: a.male,
    female: a.female,
    divers: a.divers,
    age_0_6: cellMap.get(`${a.abteilungId}|0-6`) ?? 0,
    age_7_14: cellMap.get(`${a.abteilungId}|7-14`) ?? 0,
    age_15_18: cellMap.get(`${a.abteilungId}|15-18`) ?? 0,
    age_19_26: cellMap.get(`${a.abteilungId}|19-26`) ?? 0,
    age_27_40: cellMap.get(`${a.abteilungId}|27-40`) ?? 0,
    age_41_60: cellMap.get(`${a.abteilungId}|41-60`) ?? 0,
    age_61_plus: cellMap.get(`${a.abteilungId}|61+`) ?? 0,
    age_unknown: cellMap.get(`${a.abteilungId}|unbekannt`) ?? 0,
    total: a.total,
  }));
}

async function loadVereinsname(db: Parameters<typeof computeBestandserhebung>[0]): Promise<string> {
  const [row] = await db
    .select({ vereinsname: organizationSettingsTable.vereinsname })
    .from(organizationSettingsTable)
    .limit(1);
  return row?.vereinsname ?? "Verein";
}

export const verbandsmeldungRouter = {
  compute: vorstandProc.input(ComputeInput).handler(async ({ context, input }) => {
    return computeBestandserhebung(context.db, {
      stichtag: input.stichtag,
      abteilungIds: input.abteilungIds?.length ? input.abteilungIds : undefined,
    });
  }),

  exportCsv: vorstandProc.input(ComputeInput).handler(async ({ context, input }) => {
    const data = await computeBestandserhebung(context.db, {
      stichtag: input.stichtag,
      abteilungIds: input.abteilungIds?.length ? input.abteilungIds : undefined,
    });
    const content = toCsv(toCsvRows(data), CSV_COLUMNS);
    return {
      filename: `bestandserhebung-${input.stichtag}.csv`,
      content,
    };
  }),

  exportPdf: vorstandProc.input(ComputeInput).handler(async ({ context, input }) => {
    const data = await computeBestandserhebung(context.db, {
      stichtag: input.stichtag,
      abteilungIds: input.abteilungIds?.length ? input.abteilungIds : undefined,
    });
    const vereinsname = await loadVereinsname(context.db);
    const pdf = await renderPdfBase64(BestandserhebungDocument({ data, vereinsname }));
    return {
      filename: `Bestandserhebung-BE-${input.stichtag}.pdf`,
      base64: pdf.base64,
    };
  }),

  archive: adminProc
    .input(
      v.object({
        stichtag: ISO_DATE,
        notes: v.optional(v.string(), ""),
        signedOff: v.optional(v.boolean(), false),
      }),
    )
    .handler(async ({ context, input }) => {
      const data = await computeBestandserhebung(context.db, { stichtag: input.stichtag });
      const actor = context.session?.user;
      const sha = createHash("sha256").update(JSON.stringify(data)).digest("hex");
      const [row] = await context.db
        .insert(bestandserhebungenTable)
        .values({
          stichtag: input.stichtag,
          createdBy: actor?.id ?? null,
          createdByEmail: actor?.email ?? null,
          breakdown: data,
          signedOff: input.signedOff,
          signedOffAt: input.signedOff ? new Date() : null,
          signedOffBy: input.signedOff ? (actor?.id ?? null) : null,
          signedOffByEmail: input.signedOff ? (actor?.email ?? null) : null,
          deliverableSha256: sha,
          notes: input.notes || null,
        })
        .returning({ id: bestandserhebungenTable.id });
      if (!row)
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Speichern fehlgeschlagen." });
      return { id: row.id, sha256: sha };
    }),

  listArchived: vorstandProc.input(v.void()).handler(async ({ context }) => {
    return context.db
      .select({
        id: bestandserhebungenTable.id,
        stichtag: bestandserhebungenTable.stichtag,
        createdAt: bestandserhebungenTable.createdAt,
        createdByEmail: bestandserhebungenTable.createdByEmail,
        signedOff: bestandserhebungenTable.signedOff,
        signedOffAt: bestandserhebungenTable.signedOffAt,
        signedOffByEmail: bestandserhebungenTable.signedOffByEmail,
        deliverableSha256: bestandserhebungenTable.deliverableSha256,
        grandTotal: bestandserhebungenTable.breakdown,
      })
      .from(bestandserhebungenTable)
      .orderBy(desc(bestandserhebungenTable.stichtag), desc(bestandserhebungenTable.createdAt));
  }),

  getArchived: vorstandProc
    .input(v.object({ id: v.pipe(v.string(), v.uuid()) }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .select()
        .from(bestandserhebungenTable)
        .where(eq(bestandserhebungenTable.id, input.id))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Eintrag nicht gefunden." });
      return row;
    }),
};
