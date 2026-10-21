import { z } from "zod";
import { PackageDto } from "../../offers/dto/package.dto";
import { ChangeReasonDto } from "./change-reason.dto";

/** PATCH /admin/packages/:id (RNX-226): display order and the active and visible flags (at least one), and why. The name cannot change. */
export const UpdatePackageBodyDto = PackageDto.omit({ name: true })
  .partial()
  .extend({ reason: ChangeReasonDto })
  .refine((body) => body.displayOrder !== undefined || body.active !== undefined || body.visible !== undefined, {
    message: "give displayOrder, active or visible",
  });
export type UpdatePackageBodyDto = z.infer<typeof UpdatePackageBodyDto>;
