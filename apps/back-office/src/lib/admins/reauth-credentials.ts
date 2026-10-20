/** What `POST /admin/auth/reauth` takes: the password and a fresh TOTP code. Never logged or stored. */
export type ReauthCredentials = {
  readonly password: string;
  readonly totp: string;
};
