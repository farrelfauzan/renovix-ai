import { PLATFORM_SETTINGS } from "../config/platform-settings";
import type { PlatformSettingName } from "../types/platform-setting-name";

/** True when `name` is a setting of the registry. */
export function isPlatformSettingName(name: string): name is PlatformSettingName {
  return Object.hasOwn(PLATFORM_SETTINGS, name);
}
