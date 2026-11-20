/** RNX-78: a session request as CombinedAuthGuard leaves it, with the raw headers Better Auth reads the cookie from. */
export interface SessionRequest {
  readonly user: { readonly userId: string };
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}
