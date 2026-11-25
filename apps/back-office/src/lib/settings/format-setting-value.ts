import type { PlatformSetting } from "./platform-setting";

/** How a setting's value reads on the screen: "not set" without a value, "on" or "off", a list comma separated. */
export function formatSettingValue(value: PlatformSetting["value"]): string {
  if (value === null) return "not set";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return String(value);
  return value.length === 0 ? "empty" : value.join(", ");
}
