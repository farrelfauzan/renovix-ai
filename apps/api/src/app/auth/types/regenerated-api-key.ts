/** The answer of POST /auth/keys/regenerate (RNX-18), the shape the chat profile page reads: the new key, once. */
export interface RegeneratedApiKey {
  readonly apiKey: string;
  readonly apiKeyWarning: string;
}
