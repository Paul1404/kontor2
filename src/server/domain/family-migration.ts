import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { appendAudit } from "~/server/audit/log";
import type { DBOrTx } from "~/server/db/client";
import { contractsTable } from "~/server/db/schema/contracts";
import { familienMitgliederTable, familienTable } from "~/server/db/schema/familien";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

export async function familyInventory(db: DBOrTx) {
  const [people, links, families, memberships, contracts] = await Promise.all([
    db
      .select({
        id: membersTable.id,
        name: sql<string>`concat_ws(' ',${membersTable.vorname},${membersTable.nachname})`,
        memberNo: membersTable.memberNo,
        birth: membersTable.geburtsdatum,
        guardianName: membersTable.vertreterName,
      })
      .from(membersTable)
      .where(isNull(membersTable.deletedAt)),
    db
      .select({
        id: relationshipsTable.id,
        from: relationshipsTable.fromMemberId,
        to: relationshipsTable.toMemberId,
        guardian: relationshipsTable.istVertreter,
      })
      .from(relationshipsTable)
      .where(
        sql`${relationshipsTable.datBis} is null or ${relationshipsTable.datBis}>current_date`,
      ),
    db.select().from(familienTable),
    db.select().from(familienMitgliederTable).where(isNull(familienMitgliederTable.bis)),
    db
      .select({
        id: contractsTable.id,
        memberId: contractsTable.memberId,
        payer: contractsTable.zahlerMemberId,
      })
      .from(contractsTable)
      .where(
        sql`${contractsTable.vertragEnde} is null or ${contractsTable.vertragEnde}>current_date`,
      ),
  ]);
  const parents = new Map(people.map((p) => [p.id, p.id]));
  const root = (id: string): string => {
    const parent = parents.get(id);
    return parent && parent !== id ? root(parent) : id;
  };
  const join = (a: string, b: string) => {
    if (parents.has(a) && parents.has(b)) parents.set(root(a), root(b));
  };
  for (const l of links) if (l.to) join(l.from, l.to);
  for (const c of contracts) if (c.payer) join(c.memberId, c.payer);
  for (const f of families) {
    const ids = memberships.filter((m) => m.familieId === f.id).map((m) => m.memberId);
    for (const id of ids.slice(1)) join(ids[0]!, id);
  }
  const components = new Map<string, typeof people>();
  for (const p of people) {
    const key = root(p.id);
    components.set(key, [...(components.get(key) ?? []), p]);
  }
  const proposals = [];
  for (const persons of components.values()) {
    const ids = persons.map((p) => p.id);
    const has = (id: string | null) => id != null && ids.includes(id);
    const sourceLinks = links.filter((l) => has(l.from));
    const assignments = memberships.filter((m) => has(m.memberId));
    const familyIds = [...new Set(assignments.map((m) => m.familieId))];
    const fam = families.find((f) => f.id === familyIds[0]);
    if (
      ids.length === 1 &&
      !sourceLinks.length &&
      !persons[0]?.guardianName &&
      !contracts.some((c) => has(c.memberId) && c.payer)
    )
      continue;
    const issues: string[] = [];
    if (familyIds.length > 1)
      issues.push("Mehrere bestehende Familien. Keine automatische Zusammenführung.");
    if (sourceLinks.some((l) => !l.to || !has(l.to)))
      issues.push("Nicht aufgelöste oder gelöschte Zielperson in Altbeziehung.");
    const payerIds = [
      ...new Set(
        [
          fam?.zahlerMemberId,
          ...contracts.filter((c) => has(c.memberId)).map((c) => c.payer),
        ].filter((p): p is string => !!p),
      ),
    ];
    let payer = payerIds.length === 1 ? payerIds[0] : null;
    if (payerIds.length > 1) issues.push("Widersprüchliche Zahlerzuordnungen.");
    const guardians = [...new Set(sourceLinks.filter((l) => l.guardian && l.to).map((l) => l.to!))];
    const guardian = fam?.guardianMemberId ?? (guardians.length === 1 ? guardians[0] : null);
    if (guardians.length > 1 && !fam?.guardianMemberId)
      issues.push("Mehrere Sorgeberechtigte. Hauptempfänger bitte festlegen.");
    if (!payer) {
      if (guardian) payer = guardian;
      else issues.push("Zahler nicht eindeutig.");
    }
    if (persons.some((p) => p.guardianName) && !guardian)
      issues.push("Freitext-Vertreter ohne eindeutige Familienperson.");
    if (
      fam &&
      !sourceLinks.length &&
      !contracts.some((c) => has(c.memberId) && c.payer) &&
      !issues.length
    )
      continue;
    for (const person of persons) {
      if (
        assignments.some((m) => m.memberId === person.id) ||
        person.id === payer ||
        guardians.includes(person.id)
      )
        continue;
      const isChild = sourceLinks.some((l) => l.from === person.id && l.guardian);
      if (!isChild) issues.push(`Familienrolle für ${person.name} ist nicht eindeutig.`);
    }
    proposals.push({
      id: ids.slice().sort()[0]!,
      name: fam?.name ?? `Familie ${persons[0]!.name}`,
      familyId: fam?.id ?? null,
      persons: persons.map((p) => ({
        id: p.id,
        name: p.name,
        role:
          assignments.find((m) => m.memberId === p.id)?.rolle ??
          (p.id === payer
            ? "zahler"
            : guardians.includes(p.id)
              ? "sorgeberechtigt"
              : sourceLinks.some((l) => l.from === p.id && l.guardian)
                ? "kind"
                : "partner"),
        isGuardian:
          guardians.includes(p.id) || assignments.some((m) => m.memberId === p.id && m.isGuardian),
      })),
      payer,
      guardian,
      issues,
      sourceIds: sourceLinks.map((l) => l.id),
    });
  }
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        people: people.slice().sort((a, b) => a.id.localeCompare(b.id)),
        links: links.slice().sort((a, b) => a.id.localeCompare(b.id)),
        families: families.slice().sort((a, b) => a.id.localeCompare(b.id)),
        memberships: memberships.slice().sort((a, b) => a.id.localeCompare(b.id)),
        contracts: contracts.slice().sort((a, b) => a.id.localeCompare(b.id)),
      }),
    )
    .digest("hex");
  return { hash, proposals };
}

export async function applyFamilyInventory(
  db: DBOrTx,
  expectedHash: string,
  actor: { id: string; email: string },
) {
  await db.execute(sql`select pg_advisory_xact_lock(7421002)`);
  await db.execute(
    sql`lock table members,contracts,relationships,familien,familien_mitglieder in share row exclusive mode`,
  );
  const inventory = await familyInventory(db);
  if (inventory.hash !== expectedHash)
    throw new ORPCError("CONFLICT", { message: "Bestand geändert. Vorschau neu laden." });
  let count = 0;
  for (const p of inventory.proposals) {
    if (p.issues.length || !p.payer) continue;
    let id = p.familyId;
    if (!id) {
      const [fam] = await db
        .insert(familienTable)
        .values({
          name: p.name,
          zahlerMemberId: p.payer,
          guardianMemberId: p.guardian,
          notiz: "Übernommen aus Altbeziehungen. Herkunft bleibt im Änderungsprotokoll erhalten.",
        })
        .returning({ id: familienTable.id });
      id = fam!.id;
    } else
      await db
        .update(familienTable)
        .set({ guardianMemberId: p.guardian, updatedAt: new Date() })
        .where(eq(familienTable.id, id));
    for (const person of p.persons) {
      const [existing] = await db
        .select()
        .from(familienMitgliederTable)
        .where(
          and(eq(familienMitgliederTable.memberId, person.id), isNull(familienMitgliederTable.bis)),
        );
      if (existing && existing.familieId !== id)
        throw new ORPCError("CONFLICT", { message: "Familie zwischenzeitlich geändert." });
      if (existing)
        await db
          .update(familienMitgliederTable)
          .set({ isGuardian: person.isGuardian })
          .where(eq(familienMitgliederTable.id, existing.id));
      else
        await db.insert(familienMitgliederTable).values({
          familieId: id,
          memberId: person.id,
          rolle: person.role,
          isGuardian: person.isGuardian,
          von: new Date().toISOString().slice(0, 10),
        });
    }
    const auditId = await appendAudit(db, {
      entityType: "familie",
      entityId: id,
      action: "update",
      source: "ui",
      actorId: actor.id,
      actorEmail: actor.email,
      changes: {
        migration: {
          before: null,
          after: JSON.stringify({ sources: p.sourceIds, people: p.persons.map((m) => m.id) }),
        },
      },
    });
    for (const person of p.persons)
      await db
        .update(contractsTable)
        .set({ zahlerMemberId: null })
        .where(eq(contractsTable.memberId, person.id));
    // Retain every original relationship as historical evidence.
    if (p.sourceIds.length)
      await db
        .update(relationshipsTable)
        .set({ datBis: new Date(), updatedAt: new Date() })
        .where(
          sql`${relationshipsTable.id} in (${sql.join(
            p.sourceIds.map((id) => sql`${id}`),
            sql`,`,
          )})`,
        );
    for (const person of p.persons)
      await takeMemberSnapshot(db, person.id, {
        trigger: "mutation",
        actorId: actor.id,
        actorEmail: actor.email,
        auditId,
      });
    count++;
  }
  return { applied: count, unresolved: inventory.proposals.filter((p) => p.issues.length).length };
}
