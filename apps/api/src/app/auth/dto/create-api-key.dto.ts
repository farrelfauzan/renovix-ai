import { z } from "zod";

const MAX_NAME_LENGTH = 100;

/** POST /auth/keys (RNX-18): a name for the key and how long it lives ("never": no expiry). */
export const CreateApiKeyDto = z.strictObject({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  expiresIn: z.enum(["30d", "90d", "1y", "never"]),
});
export type CreateApiKeyDto = z.infer<typeof CreateApiKeyDto>;
