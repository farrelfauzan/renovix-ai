import type { PLATFORM_SETTINGS } from "../config/platform-settings";

/** The name of a platform setting: a key of the registry. */
export type PlatformSettingName = keyof typeof PLATFORM_SETTINGS;
