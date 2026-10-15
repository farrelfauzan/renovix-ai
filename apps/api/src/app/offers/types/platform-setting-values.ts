import type { z } from "zod";
import type { PLATFORM_SETTINGS } from "../config/platform-settings";
import type { PlatformSettingName } from "./platform-setting-name";

/** Each platform setting's value type, as its registry schema gives it. */
export type PlatformSettingValues = { [K in PlatformSettingName]: z.infer<(typeof PLATFORM_SETTINGS)[K]> };
