import { z } from "zod";

/** Body of POST /billing/checkout (RNX-28): the top-up amount in dollars, 5 when left out (the minimum is checked in the handler). */
export const CreateCheckoutSchema = z.object({
  amount: z.number().optional(),
});
