/** Fewest characters a secret may have outside development and test. */
const MIN_SECRET_LENGTH = 32;

/**
 * Values that ship in `.env.example` (today's explicit development values and the placeholders of
 * earlier versions) or were hard-coded fallbacks. Outside development and test they are refused.
 */
const KNOWN_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "change-me",
  "change-me-in-production",
  "random-secret-for-signing-change-me",
  "random-secret-change-me",
  "default-dev-key-32-bytes-long!!",
  "dev-only-jwt-secret-never-use-in-production",
  "dev-only-better-auth-secret-never-use-in-production",
  "dev-only-ip-hash-secret-never-use-in-production",
  "0000000000000000000000000000000000000000000000000000000000000001",
]);

/** True when NODE_ENV is development or test; anything else, unset included, is treated as production. */
const isRelaxedMode = (env: NodeJS.ProcessEnv): boolean =>
  env.NODE_ENV === "development" || env.NODE_ENV === "test";

/**
 * The value of a required secret (RX-110). Missing or empty is refused in every mode: there is no
 * fallback, not even in development. Outside development and test a known placeholder or a value
 * shorter than `minLength` is refused too. Errors name the variable, never its value.
 */
export function readRequiredSecret(
  env: NodeJS.ProcessEnv,
  name: string,
  minLength: number = MIN_SECRET_LENGTH,
): string {
  const value = env[name];
  if (!value?.trim()) throw new Error(`${name} is required and is not set`);
  if (isRelaxedMode(env)) return value;
  if (KNOWN_PLACEHOLDERS.has(value)) {
    throw new Error(`${name} is a placeholder value; set a real secret outside development and test`);
  }
  if (value.length < minLength) {
    throw new Error(`${name} must have at least ${minLength} characters outside development and test`);
  }
  return value;
}
