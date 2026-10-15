import { z } from "zod";

/** An Enterprise bundle's own fields. Its amounts are on its versions. */
export const EnterpriseBundleDto = z.strictObject({
  name: z.string().min(1).max(100),
  active: z.boolean(),
});
export type EnterpriseBundleDto = z.infer<typeof EnterpriseBundleDto>;
