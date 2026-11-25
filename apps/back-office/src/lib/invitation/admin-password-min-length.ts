/**
 * The minimum length of a back-office password, in characters: the API's default for ADMIN_AUTH_PASSWORD_MIN_LENGTH
 * (apps/api admin-auth `parse-admin-auth-config.ts`), which it refuses to set lower. Live feedback only (RNX-333):
 * the API checks the password at accept and stays the source of truth.
 */
export const ADMIN_PASSWORD_MIN_LENGTH = 12;
