import type { PlatformSettingValues } from "../../offers/types/platform-setting-values";

/**
 * A setting's value as an audit row can hold it (flat values only, RX-97): a list (RNX-35's paymentsAllowedUserIds)
 * becomes its JSON text; every other value is kept as it is.
 */
export function toAuditSettingValue(value: PlatformSettingValues[keyof PlatformSettingValues] | null): string | number | boolean | null {
  return Array.isArray(value) ? JSON.stringify(value) : value;
}
