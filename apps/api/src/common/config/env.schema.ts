import { z } from "zod";

/** An unset or empty variable counts as not set, as in `.env.example` (`COOKIE_DOMAIN=`). */
const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);

const optionalInteger = (name: string): z.ZodType<number | undefined> =>
  z.preprocess(
    emptyToUndefined,
    z.string().regex(/^[1-9]\d*$/, { error: `${name} must be a positive integer` }).transform(Number).optional(),
  ) as z.ZodType<number | undefined>;

const optionalUrl = (name: string): z.ZodType<string | undefined> =>
  z.preprocess(emptyToUndefined, z.url({ error: `${name} must be a URL` }).optional()) as z.ZodType<string | undefined>;

const optionalBoolean = (name: string): z.ZodType<boolean | undefined> =>
  z.preprocess(
    emptyToUndefined,
    z.enum(["true", "false"], { error: `${name} must be "true" or "false"` }).transform((value) => value === "true").optional(),
  ) as z.ZodType<boolean | undefined>;

/**
 * RNX-43: the typed values of the API's environment (ports, numbers, URLs), parsed to their type; `parseEnv` runs it
 * together with `assertRequiredSecrets` (the nine required secrets, RX-110 helpers). Every message names the variable
 * and never its value.
 */
export const envSchema = z
  .object({
    PORT: optionalInteger("PORT"),
    SMTP_PORT: optionalInteger("SMTP_PORT"),
    SMTP_SECURE: optionalBoolean("SMTP_SECURE"),
    ANON_DAILY_IP_CAP: optionalInteger("ANON_DAILY_IP_CAP"),
    ANON_DAILY_GLOBAL_CAP: optionalInteger("ANON_DAILY_GLOBAL_CAP"),
    LLM_KEY_VERSION: optionalInteger("LLM_KEY_VERSION"),
    LLM_DEFAULT_MAX_TOKENS: optionalInteger("LLM_DEFAULT_MAX_TOKENS"),
    EMBEDDING_DIMENSIONS: optionalInteger("EMBEDDING_DIMENSIONS"),
    MCP_OAUTH_STATE_TTL_SECONDS: optionalInteger("MCP_OAUTH_STATE_TTL_SECONDS"),
    API_PUBLIC_URL: optionalUrl("API_PUBLIC_URL"),
    BETTER_AUTH_URL: optionalUrl("BETTER_AUTH_URL"),
    CHAT_APP_URL: optionalUrl("CHAT_APP_URL"),
    APP_BASE_URL: optionalUrl("APP_BASE_URL"),
    DASHBOARD_URL: optionalUrl("DASHBOARD_URL"),
    LLM_BASE_URL: optionalUrl("LLM_BASE_URL"),
    EMBEDDING_BASE_URL: optionalUrl("EMBEDDING_BASE_URL"),
    S3_ENDPOINT: optionalUrl("S3_ENDPOINT"),
    S3_CDN_DOMAIN: z.string().optional(),
  })
  .loose();
