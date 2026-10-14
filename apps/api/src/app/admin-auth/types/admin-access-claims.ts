/** The claims of a back-office access token that the session check reads: session id and admin id. */
export type AdminAccessClaims = {
  readonly sid: string;
  readonly sub: string;
};
