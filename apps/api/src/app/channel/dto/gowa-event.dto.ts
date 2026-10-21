import { z } from "zod";

/**
 * The envelope every signed GOWA call carries (RNX-28): its event name and the number it was sent to. Events other
 * than "message.received" (acks, status updates) have no `from` or `message` and are skipped with 200, as before.
 */
export const GowaEventSchema = z.object({
  event: z.string(),
  to: z.string(),
});
