import { z } from "zod";

/**
 * The envelope every AutoGoPay answer carries (RNX-273, the official API docs): `{ success, message, data }`. Only
 * `success` and `data` are read; `data` is parsed by the call's own dto. `message` is never read nor logged.
 */
export const AutoGoPayEnvelopeDto = z.object({
  success: z.boolean(),
  data: z.unknown(),
});
export type AutoGoPayEnvelopeDto = z.infer<typeof AutoGoPayEnvelopeDto>;
