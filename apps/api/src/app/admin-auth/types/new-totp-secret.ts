/** A TOTP secret made at enrolment: shown once (secret, otpauth URI for the QR code), stored encrypted. */
export type NewTotpSecret = {
  readonly secret: string;
  readonly otpauthUri: string;
  readonly encrypted: string;
};
