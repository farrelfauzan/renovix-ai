import { z } from "zod";

/** Longest base URL accepted. */
const MAX_BASE_URL_LENGTH = 500;

/** A provider's OpenAI-compatible base URL (RX-177), e.g. "https://openrouter.ai/api/v1": http(s), no trailing slash. */
export const ProviderBaseUrlDto = z
  .url({ protocol: /^https?$/ })
  .max(MAX_BASE_URL_LENGTH)
  .refine((value) => !value.endsWith("/"), { message: "baseUrl must not end with a slash" });
