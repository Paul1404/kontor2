import { isNull } from "drizzle-orm";
import { membersTable } from "~/server/db/schema/members";

/**
 * The canonical "this member is not soft-deleted" condition.
 *
 * The legacy Linear `geloscht` flag is folded into the app's single `deletedAt`
 * (at import and via a one-time backfill), so checking `deletedAt` alone is
 * authoritative. Use this everywhere instead of hand-writing the old dual
 * filter (`deletedAt IS NULL AND coalesce(geloscht,false)=false`); when the
 * legacy column is finally dropped, nothing here needs to change.
 */
export function memberNotDeleted() {
  return isNull(membersTable.deletedAt);
}
