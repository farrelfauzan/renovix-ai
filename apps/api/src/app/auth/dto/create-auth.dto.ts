import { z } from "zod";
import { MODEL_TIERS } from "../../offers/config/model-tiers";
import { ISO_COUNTRY_CODES } from "../config/iso-country-codes";
import { PROFILE_LANGUAGES } from "../config/profile-languages";
import { isIanaTimeZone } from "../utils/is-iana-time-zone";

/**
 * PATCH /auth/me. Strict (RNX-77a): an unknown key is refused. The language, country and timezone are checked as in
 * the RNX-33 profile step; the default model tier is also checked against the account's packages by the service.
 */
export const UpdateProfileDto = z.strictObject({
  name: z.string().max(100).optional(),
  firstName: z.string().max(50).optional(),
  lastName: z.string().max(50).optional(),
  phone: z.string().max(20).optional(),
  company: z.string().max(100).optional(),
  role: z.string().trim().min(1).max(100).optional(),
  jobTitle: z.string().max(100).optional(),
  signupGoal: z.string().trim().min(1).max(500).optional(),
  // RNX-33: the saved zone is the reminder default, so only an IANA zone is accepted (offsets refused)
  timezone: z.string().max(50).refine(isIanaTimeZone, { message: "Must be an IANA time zone" }).optional(),
  // The interface and agent language (one setting, as in the profile step)
  locale: z.enum(PROFILE_LANGUAGES).optional(),
  country: z.enum(ISO_COUNTRY_CODES).optional(),
  defaultModelTier: z.enum(MODEL_TIERS).optional(),
});
export type UpdateProfileDto = z.infer<typeof UpdateProfileDto>;
