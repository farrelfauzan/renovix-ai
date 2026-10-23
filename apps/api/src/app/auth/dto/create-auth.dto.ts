import { z } from "zod";

export const UpdateProfileDto = z.object({
  name: z.string().max(100).optional(),
  firstName: z.string().max(50).optional(),
  lastName: z.string().max(50).optional(),
  phone: z.string().max(20).optional(),
  company: z.string().max(100).optional(),
  jobTitle: z.string().max(100).optional(),
  timezone: z.string().max(50).optional(),
  locale: z.string().max(10).optional(),
});
export type UpdateProfileDto = z.infer<typeof UpdateProfileDto>;
