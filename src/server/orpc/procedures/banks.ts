import * as v from "valibot";
import { authedProc } from "~/server/orpc/base";
import { lookupBankByIban } from "~/server/lib/blz";

export const banksRouter = {
  lookupByIban: authedProc
    .input(v.object({ iban: v.string() }))
    .handler(async ({ input }) => {
      const hit = lookupBankByIban(input.iban);
      if (!hit) return { found: false as const };
      return { found: true as const, name: hit.name, bic: hit.bic };
    }),
};
