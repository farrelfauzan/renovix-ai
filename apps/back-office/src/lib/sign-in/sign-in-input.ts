/** The body of `POST /api/v1/admin/auth/sign-in` (RX-94): a TOTP code or a recovery code once TOTP is enrolled, neither before. */
export type SignInInput = {
  readonly email: string;
  readonly password: string;
  readonly totp?: string;
  readonly recoveryCode?: string;
};
