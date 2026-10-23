import { z } from "zod";

const MAX_ID_LENGTH = 64;
const ID = z.string().trim().min(1).max(MAX_ID_LENGTH);

/**
 * POST /payments/checkout (RNX-35): what to buy, by the offer's id from the catalog: a package (Starter or Pro, bought
 * once, D23) or a top-up pack (only with a package, D36). The price is the catalog's, never the caller's.
 */
export const CheckoutBodyDto = z.discriminatedUnion("offer", [
  z.strictObject({ offer: z.literal("package"), packageId: ID }),
  z.strictObject({ offer: z.literal("top_up_pack"), packId: ID }),
]);
export type CheckoutBodyDto = z.infer<typeof CheckoutBodyDto>;
