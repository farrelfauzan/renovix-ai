import { z } from "zod";

/** A package's own fields (Starter, Pro, Enterprise are rows, D46). Its terms are on its versions. */
export const PackageDto = z.strictObject({
  name: z.string().min(1).max(100),
  displayOrder: z.int32().nonnegative(),
  active: z.boolean(),
  visible: z.boolean(),
});
export type PackageDto = z.infer<typeof PackageDto>;
