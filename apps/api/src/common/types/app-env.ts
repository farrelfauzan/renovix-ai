import type { z } from "zod";
import type { envSchema } from "../config/env.schema";

/** The API's environment after `parseEnv`: the typed values parsed, the rest left as read. */
export type AppEnv = z.infer<typeof envSchema>;
