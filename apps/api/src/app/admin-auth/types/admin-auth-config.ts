/**
 * The security values of the back-office sign-in (RX-94, D54, D61). Configuration with these defaults
 * (environment overrides allowed), never editable from the back office itself.
 */
export type AdminAuthConfig = {
  /** Minimum password length in characters (default 12; the breached list is cut at 12, so not lower). */
  readonly passwordMinLength: number;
  /** Argon2id memory cost in KiB (default 19456). */
  readonly argon2MemoryKib: number;
  /** Argon2id passes (default 2). */
  readonly argon2TimeCost: number;
  /** Argon2id lanes (default 1). */
  readonly argon2Parallelism: number;
  /** Failed sign-in attempts that lock the account (default 5). */
  readonly maxFailedAttempts: number;
  /** How long a locked account stays locked, in minutes (default 15). */
  readonly lockoutMinutes: number;
  /** Lifetime of the access token, in seconds (default 900). */
  readonly accessTokenSeconds: number;
  /** A session unused for this long ends, in minutes (default 30). */
  readonly idleMinutes: number;
  /** A session ends this long after sign-in whatever happens, in hours (default 12). */
  readonly absoluteHours: number;
  /** TOTP clock tolerance in seconds, either side (default 30: one step). */
  readonly totpToleranceSeconds: number;
  /** Recovery codes issued at enrolment (default 10). */
  readonly recoveryCodeCount: number;
};
