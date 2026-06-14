// EINMALIGES, TEMPORÄRES Skript. Setzt min_age/max_age je Beitragsart (SVU).
// Lauf: railway run -- bun scripts/tmp-set-fee-age.mts
// Nutzt DATABASE_PUBLIC_URL (extern erreichbar) bzw. DATABASE_URL. Gibt die URL nie aus.
// Danach löschen.
import postgres from "postgres";

const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Keine DATABASE_URL im Prozess. Mit 'railway run --' starten.");
  process.exit(1);
}

// art -> [min_age, max_age]  (null = leer lassen / nicht prüfen)
const RANGES: Record<number, [number | null, number | null]> = {
  103: [0, 13], // Kind bis 14 J. o. Eltern
  107: [0, 13], // Kind bis 14 J. mit Eltern
  105: [14, 17], // Jugendl. bis 18 J. o. Eltern
  106: [14, 17], // Jugendl. bis 18 J. mit Eltern
  104: [18, 24], // Junge Leute (bis 25 -> rollt mit 25)
  100: [25, null], // Erwachsene
  102: [25, null], // Erwachsene dopp
};

const sql = postgres(url, { prepare: false, onnotice: () => {}, max: 1 });

try {
  const before = await sql`select art, name, min_age, max_age from fee_types order by art`;
  console.log("VORHER:");
  for (const r of before) console.log(`  ${r.art}  ${r.name}  min=${r.min_age} max=${r.max_age}`);

  await sql.begin(async (tx) => {
    for (const [art, [mn, mx]] of Object.entries(RANGES)) {
      await tx`update fee_types set min_age = ${mn}, max_age = ${mx} where art = ${Number(art)}`;
    }
  });

  const after = await sql`select art, name, min_age, max_age from fee_types order by art`;
  console.log("\nNACHHER:");
  for (const r of after) console.log(`  ${r.art}  ${r.name}  min=${r.min_age} max=${r.max_age}`);
  console.log("\nFertig.");
} finally {
  await sql.end({ timeout: 5 });
}
