import { z } from "zod";

/**
 * Body of POST /webhooks/gowa (RNX-28): the fields of a GOWA inbound message the handler reads. `event` and
 * `message.type` are any string: the handler skips other events and non-text messages.
 */
export const GowaInboundMessageSchema = z.object({
  event: z.string(),
  from: z.string(),
  to: z.string(),
  message: z.object({
    id: z.string(),
    type: z.string(),
    text: z.object({ body: z.string() }).optional(),
  }),
});
