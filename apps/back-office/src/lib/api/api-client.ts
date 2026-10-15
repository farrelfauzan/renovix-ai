export type ApiClient = {
  /** Sends a request with the admin cookies; throws SignedOutError when the session is over. */
  readonly request: (path: string, init?: RequestInit) => Promise<Response>;
};
