import * as v from "valibot";
import {
  ContractSwitchInput,
  executeContractSwitch,
  planContractSwitch,
} from "~/server/domain/contract-switch";
import { vorstandProc } from "~/server/orpc/base";
export const contractSwitchRouter = {
  preview: vorstandProc.input(ContractSwitchInput).handler(async ({ context, input }) => {
    const p = await planContractSwitch(context.db, input);
    return {
      oldName: p.old.artName,
      oldAmount: p.old.betrag,
      newName: p.tariff.bezeichnung,
      newAmount: p.tariff.betrag1,
      effectiveDate: input.effectiveDate,
      postings: p.postings,
      revision: p.revision,
    };
  }),
  commit: vorstandProc
    .input(
      v.object({ ...ContractSwitchInput.entries, revision: v.string(), confirm: v.literal(true) }),
    )
    .handler(({ context, input }) =>
      executeContractSwitch(context.db, input, {
        id: context.session!.user.id,
        email: context.session!.user.email,
        requestId: context.requestId,
      }),
    ),
};
