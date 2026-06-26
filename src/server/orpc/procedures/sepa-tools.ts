import * as v from "valibot";
import { adminProc } from "~/server/orpc/base";
import { validatePain008 } from "~/server/sepa/validate-pain008";

/**
 * Admin tools around SEPA files. `validateXml` reads a pasted/uploaded pain.008
 * and runs the bank-grade checks (sums, IBAN/BIC/creditor-id, mandate dates,
 * collection date, charset), returning a full breakdown of what would be
 * debited. Read-only: it never touches the database.
 */
export const sepaToolsRouter = {
  validateXml: adminProc
    .input(
      v.object({
        xml: v.pipe(v.string(), v.minLength(1), v.maxLength(5_000_000)),
        filename: v.optional(v.nullable(v.string())),
      }),
    )
    .handler(async ({ input }) => {
      const today = new Date().toISOString().slice(0, 10);
      return { filename: input.filename ?? null, ...validatePain008(input.xml, today) };
    }),
};
