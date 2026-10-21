/** The user a valid API key belongs to, as ApiKeyGuard attaches it to the request (RNX-18). */
export interface ApiKeyOwner {
  readonly id: string;
  readonly email: string;
}
