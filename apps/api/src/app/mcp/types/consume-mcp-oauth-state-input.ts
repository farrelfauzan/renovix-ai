/** What the OAuth callback presents to use a stored flow once (RX-151): every field must match, and it must not have expired at `now`. */
export type ConsumeMcpOAuthStateInput = {
  readonly nonce: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly provider: string;
  readonly now: Date;
};
