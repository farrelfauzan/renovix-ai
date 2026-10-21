import type { PlatformSettingName } from "../../offers/types/platform-setting-name";
import type { PlatformSettingValues } from "../../offers/types/platform-setting-values";

/** One platform setting as the admin API shows it (RNX-226): its registry name and its value, null when it is not set. */
export type SettingView = {
  readonly name: PlatformSettingName;
  readonly value: PlatformSettingValues[PlatformSettingName] | null;
};
