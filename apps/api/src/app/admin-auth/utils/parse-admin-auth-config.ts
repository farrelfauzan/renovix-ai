import type { AdminAuthConfig } from "../types/admin-auth-config";

/** Each value: its environment variable and its default (RX-94, D54, D61). */
const SOURCES: Record<keyof AdminAuthConfig, readonly [string, number]> = {
  passwordMinLength: ["ADMIN_AUTH_PASSWORD_MIN_LENGTH", 12],
  argon2MemoryKib: ["ADMIN_AUTH_ARGON2_MEMORY_KIB", 19456],
  argon2TimeCost: ["ADMIN_AUTH_ARGON2_TIME_COST", 2],
  argon2Parallelism: ["ADMIN_AUTH_ARGON2_PARALLELISM", 1],
  maxFailedAttempts: ["ADMIN_AUTH_MAX_FAILED_ATTEMPTS", 5],
  lockoutMinutes: ["ADMIN_AUTH_LOCKOUT_MINUTES", 15],
  accessTokenSeconds: ["ADMIN_AUTH_ACCESS_TOKEN_SECONDS", 900],
  idleMinutes: ["ADMIN_AUTH_IDLE_MINUTES", 30],
  absoluteHours: ["ADMIN_AUTH_ABSOLUTE_HOURS", 12],
  reauthWindowMinutes: ["ADMIN_AUTH_REAUTH_WINDOW_MINUTES", 5],
  totpToleranceSeconds: ["ADMIN_AUTH_TOTP_TOLERANCE_SECONDS", 30],
  recoveryCodeCount: ["ADMIN_AUTH_RECOVERY_CODE_COUNT", 10],
};
/** The breached-password list is cut at this length (scripts/build-breached-password-list.ts). */
const LIST_MIN_LENGTH = 12;

/**
 * The back-office security values: each from its environment variable when set, else the default.
 * Throws on a value that is not a positive integer, and on a password minimum below the list's cut.
 */
export function parseAdminAuthConfig(read: (name: string) => string | undefined): AdminAuthConfig {
  const entries = Object.entries(SOURCES).map(([key, [name, fallback]]) => {
    const raw = read(name);
    const value = raw === undefined || raw === "" ? fallback : Number(raw);
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer, got "${raw}"`);
    return [key, value];
  });
  const config = Object.fromEntries(entries) as AdminAuthConfig;
  if (config.passwordMinLength < LIST_MIN_LENGTH) {
    throw new Error(`ADMIN_AUTH_PASSWORD_MIN_LENGTH must be at least ${LIST_MIN_LENGTH} (the breached-password list is cut there)`);
  }
  return config;
}
