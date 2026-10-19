import { z } from "zod";
import { CreateProviderModelDto } from "./create-provider-model.dto";

/** PATCH /admin/providers/:id/models/:modelId (RX-177): any field but `slug`, which cannot change (refused with 400). */
export const UpdateProviderModelDto = CreateProviderModelDto.omit({ slug: true }).partial();
export type UpdateProviderModelDto = z.infer<typeof UpdateProviderModelDto>;
