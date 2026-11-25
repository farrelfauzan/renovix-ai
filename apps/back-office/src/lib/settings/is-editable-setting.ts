import type { PlatformSetting } from "./platform-setting";
import type { SettingDescription } from "./setting-description";

/** True for a number setting, the only kind the screen edits; boolean and list settings are read-only (RNX-315). */
export function isEditableSetting(description: SettingDescription, value: PlatformSetting["value"]): boolean {
  const isNumberUnit = description.unit !== "boolean" && description.unit !== "list";
  return isNumberUnit && (value === null || typeof value === "number");
}
