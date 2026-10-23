import { z } from "zod";

const MAX_ID_LENGTH = 64;
/** USD as a decimal string: up to 12 integer digits and 6 decimals (a Decimal(18, 6) column), never a JSON number. */
const USD_AMOUNT = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/);

/**
 * POST /admin/reconciliation/entries (RNX-228): a provider record's portal balance at the end of one day (YYYY-MM-DD,
 * Asia/Jakarta) and the top-up bought on the portal that day, both in USD; the top-up is "0" when left out.
 */
export const ReconciliationEntryBodyDto = z.strictObject({
  providerId: z.string().trim().min(1).max(MAX_ID_LENGTH),
  day: z.iso.date(),
  portalBalanceUsd: USD_AMOUNT,
  topUpUsd: USD_AMOUNT.default("0"),
});
export type ReconciliationEntryBodyDto = z.infer<typeof ReconciliationEntryBodyDto>;
