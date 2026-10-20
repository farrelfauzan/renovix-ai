import type { SignInInput } from "./sign-in-input";

/** The second factor sent with the password: a TOTP code, a recovery code, or none (an admin without TOTP yet). */
export type SecondFactor = Pick<SignInInput, "totp" | "recoveryCode">;
