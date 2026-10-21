import { z } from "zod";

/** One legacy subscription plan row (`subscription_plans`) of the seed file, written by slug (RNX-91). */
export const SubscriptionPlanSeedDto = z.strictObject({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  maxAgents: z.number().int().nonnegative(),
  maxIntegrations: z.number().int().nonnegative(),
  maxWorkspaceUsers: z.number().int().nonnegative(),
  maxTokensPerMonth: z.number().int().nonnegative(),
  allowedChannels: z.array(z.string().min(1)),
  priceMonthly: z.number().nonnegative(),
  priceCurrency: z.string().length(3),
  displayOrder: z.number().int(),
});
export type SubscriptionPlanSeedDto = z.infer<typeof SubscriptionPlanSeedDto>;
