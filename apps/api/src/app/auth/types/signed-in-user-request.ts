/** A request signed in with the login token or the session, as CombinedAuthGuard leaves it (`req.user.userId`). */
export interface SignedInUserRequest {
  readonly user: { readonly userId: string };
}
