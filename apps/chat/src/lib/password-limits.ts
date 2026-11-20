/** RNX-78: the API's password limits (Better Auth emailAndPassword in lib/auth.ts, POST /auth/password). */
export const PASSWORD_LIMITS = { minLength: 8, maxLength: 128 } as const;
