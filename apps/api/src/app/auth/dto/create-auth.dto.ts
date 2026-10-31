import { z } from "zod";
import { isIanaTimeZone } from "../utils/is-iana-time-zone";

export const UpdateProfileDto = z.object({
  name: z.string().max(100).optional(),
  firstName: z.string().max(50).optional(),
  lastName: z.string().max(50).optional(),
  phone: z.string().max(20).optional(),
  company: z.string().max(100).optional(),
  jobTitle: z.string().max(100).optional(),
  // RNX-33: the saved zone is the reminder default, so only an IANA zone is accepted (offsets refused)
  timezone: z.string().max(50).refine(isIanaTimeZone, { message: "Must be an IANA time zone" }).optional(),
  locale: z.string().max(10).optional(),
});
export type UpdateProfileDto = z.infer<typeof UpdateProfileDto>;
