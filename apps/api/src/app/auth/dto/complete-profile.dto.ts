import { z } from "zod";
import { ISO_COUNTRY_CODES } from "../config/iso-country-codes";
import { PROFILE_LANGUAGES } from "../config/profile-languages";
import { isIanaTimeZone } from "../utils/is-iana-time-zone";

/** RNX-33: the profile step after first sign-in. Strict: an unknown key (a user id among them) is refused. */
export const CompleteProfileDto = z.strictObject({
  name: z.string().trim().min(1).max(100),
  role: z.string().trim().min(1).max(100),
  country: z.enum(ISO_COUNTRY_CODES),
  timezone: z.string().max(64).refine(isIanaTimeZone, { message: "Must be an IANA time zone" }),
  language: z.enum(PROFILE_LANGUAGES),
  goal: z.string().trim().min(1).max(500),
});
export type CompleteProfileDto = z.infer<typeof CompleteProfileDto>;
