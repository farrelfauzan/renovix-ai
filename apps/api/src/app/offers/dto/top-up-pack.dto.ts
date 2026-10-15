import { z } from "zod";

/** A top-up pack's own fields. Its terms are on its versions. */
export const TopUpPackDto = z.strictObject({
  name: z.string().min(1).max(100),
  active: z.boolean(),
});
export type TopUpPackDto = z.infer<typeof TopUpPackDto>;
