/** When the current back-office session ends (RNX-312a), as ISO 8601 strings. */
export type AdminSessionExpiry = {
  /** The session's last activity plus the idle limit (ADMIN_AUTH_IDLE_MINUTES): unused until then, it ends. */
  readonly idleExpiresAt: string;
  /** The session ends then whatever happens (ADMIN_AUTH_ABSOLUTE_HOURS after sign-in). */
  readonly absoluteExpiresAt: string;
};
