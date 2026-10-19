import { z } from "zod";

/** Shortest key accepted: the stored hint shows the last 4 characters, never most of the key. */
const MIN_API_KEY_LENGTH = 8;
const MAX_API_KEY_LENGTH = 1000;

/** A provider API key (RX-177): write-only, stored encrypted; no whitespace. */
export const ProviderApiKeyDto = z.string().min(MIN_API_KEY_LENGTH).max(MAX_API_KEY_LENGTH).regex(/^\S+$/, "apiKey must not contain whitespace");
