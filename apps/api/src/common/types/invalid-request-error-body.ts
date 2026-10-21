/**
 * RNX-28: the one 400 body every API route answers when a request body fails its Zod schema. It is the shape the
 * public API (`POST /chat/completions`, the portal) already used: `error.message` is always "Invalid request body",
 * `error.details` maps each field to its messages (Zod's flattened field errors).
 */
export type InvalidRequestErrorBody = {
  readonly error: {
    readonly message: string;
    readonly type: "invalid_request_error";
    readonly details: Readonly<Record<string, readonly string[] | undefined>>;
  };
};
