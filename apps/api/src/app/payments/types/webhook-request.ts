/** A webhook call as received (RNX-35): the raw body bytes, exactly as signed, and the request headers. */
export type WebhookRequest = {
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
};
