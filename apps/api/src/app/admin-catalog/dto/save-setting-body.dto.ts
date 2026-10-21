import { z } from "zod";
import { ChangeReasonDto } from "./change-reason.dto";

/** PUT /admin/settings/:name (RNX-226): the new value, checked against the setting's schema in the registry, and why. */
export const SaveSettingBodyDto = z.strictObject({ value: z.unknown(), reason: ChangeReasonDto });
export type SaveSettingBodyDto = z.infer<typeof SaveSettingBodyDto>;
