import { z } from "zod";

/** PATCH /admin/codes/:id (RNX-226, D33): deactivates the code. Nothing else about a code can change here. */
export const DeactivateCodeBodyDto = z.strictObject({ isActive: z.literal(false) });
export type DeactivateCodeBodyDto = z.infer<typeof DeactivateCodeBodyDto>;
