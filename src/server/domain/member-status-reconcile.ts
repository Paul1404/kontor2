import { and, inArray, isNull, ne, sql } from "drizzle-orm";
import type { DBOrTx } from "~/server/db/client";
import { membersTable } from "~/server/db/schema/members";

export type ReconcileResult = {
  /** Rows flipped to `ausgetreten` because their leave date arrived. */
  exited: number;
  /** Rows flipped to `verstorben` because their death date arrived. */
  deceased: number;
};

/**
 * Bring stored member status in line with the calendar. `deriveStatus` keeps a
 * member aktiv/passiv while their Austritt (or, defensively, death) date is
 * still in the future; this flips them to the terminal status once that day has
 * arrived. Forward-only — it never resurrects a member — so it is safe to run
 * repeatedly (nightly, and once on boot to catch dates that passed while the
 * process was down). Returns how many rows changed.
 */
export async function reconcileMemberStatuses(db: DBOrTx): Promise<ReconcileResult> {
  const now = new Date();

  // Deaths first: a death that has occurred wins over any exit state.
  const deceased = await db
    .update(membersTable)
    .set({ status: "verstorben", updatedAt: now })
    .where(
      and(
        isNull(membersTable.deletedAt),
        ne(membersTable.status, "verstorben"),
        sql`${membersTable.verstorbenAm} is not null and ${membersTable.verstorbenAm}::date <= current_date`,
      ),
    )
    .returning({ id: membersTable.id });

  const exited = await db
    .update(membersTable)
    .set({ status: "ausgetreten", updatedAt: now })
    .where(
      and(
        isNull(membersTable.deletedAt),
        inArray(membersTable.status, ["aktiv", "passiv"]),
        isNull(membersTable.verstorbenAm),
        sql`${membersTable.austritt} is not null and ${membersTable.austritt}::date <= current_date`,
      ),
    )
    .returning({ id: membersTable.id });

  return { exited: exited.length, deceased: deceased.length };
}
