import type { CreateApiKeyDto } from "../dto/create-api-key.dto";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LIFETIME_DAYS = { "30d": 30, "90d": 90, "1y": 365 } as const;

/** RNX-18: when a key created at `now` with this lifetime expires; null for "never". */
export function toApiKeyExpiry(expiresIn: CreateApiKeyDto["expiresIn"], now: Date): Date | null {
  if (expiresIn === "never") return null;
  return new Date(now.getTime() + LIFETIME_DAYS[expiresIn] * MS_PER_DAY);
}
