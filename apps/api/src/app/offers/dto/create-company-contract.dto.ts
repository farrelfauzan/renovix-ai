import { z } from "zod";
import { CREDIT_AMOUNT } from "../config/credit-amount";
import { MODEL_TIERS } from "../config/model-tiers";

/**
 * A company's Enterprise contract. graceDays (D27), capPolicy (D2) and topUpRoles (D18) are open decisions:
 * each must be given, and may be null; none has a default. The seat limit is checked against the seat
 * ceiling setting (D7) by the service.
 */
export const CreateCompanyContractDto = z.strictObject({
  companyId: z.string().min(1),
  bundleVersionId: z.uuid(),
  seatLimit: z.int32().positive(),
  defaultMemberShareCredits: CREDIT_AMOUNT.nullable(),
  allowedTiers: z.array(z.enum(MODEL_TIERS)).min(1),
  graceDays: z.int32().nonnegative().nullable(),
  whatsappEnabled: z.boolean(),
  capPolicy: z.string().min(1).nullable(),
  topUpRoles: z.array(z.string().min(1)).nullable(),
});
export type CreateCompanyContractDto = z.infer<typeof CreateCompanyContractDto>;
