/** The answer of `POST /api/v1/admin/auth/totp/enrol` (RX-94): the new TOTP secret, as base32 text and as an otpauth URI. */
export type TotpEnrolment = {
  readonly secret: string;
  readonly otpauthUri: string;
};
