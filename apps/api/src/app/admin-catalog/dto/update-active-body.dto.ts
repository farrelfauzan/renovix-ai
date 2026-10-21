import { z } from "zod";
import { ChangeReasonDto } from "./change-reason.dto";

/** PATCH /admin/top-up-packs/:id and /admin/enterprise-bundles/:id (RNX-226): the active flag, and why. The name cannot change. */
export const UpdateActiveBodyDto = z.strictObject({ active: z.boolean(), reason: ChangeReasonDto });
export type UpdateActiveBodyDto = z.infer<typeof UpdateActiveBodyDto>;
