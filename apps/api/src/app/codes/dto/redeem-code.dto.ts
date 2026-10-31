import { z } from "zod";

export const RedeemCodeDto = z.object({
  code: z
    .string()
    .min(1)
    .max(50)
    .transform((v) => v.trim().toUpperCase()),
});
export type RedeemCodeDto = z.infer<typeof RedeemCodeDto>;

export const CreateCodeDto = z.object({
  code: z
    .string()
    .min(4)
    .max(50)
    .transform((v) => v.trim().toUpperCase())
    .optional(),
  type: z.enum(["topup", "subscription", "both"]),
  creditAmount: z.number().positive().optional(),
  /** RNX-251: the package version a "subscription" or "both" code grants (D37: permanent, so no duration). */
  packageVersionId: z.string().uuid().optional(),
  maxRedemptions: z.number().int().positive().default(1),
});
export type CreateCodeDto = z.infer<typeof CreateCodeDto>;

export const UpdateCodeDto = z.object({
  isActive: z.boolean().optional(),
  maxRedemptions: z.number().int().positive().optional(),
});
export type UpdateCodeDto = z.infer<typeof UpdateCodeDto>;
