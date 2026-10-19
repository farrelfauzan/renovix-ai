import type { ProviderType } from "@generated/prisma/client.js";

/**
 * The API name of each stored provider type (RX-177, D148): a 9Router gateway entry or a plain
 * OpenAI-compatible entry. Prisma cannot name an enum value "9router", so the column stores it through
 * `@map` and the API speaks these names.
 */
export const PROVIDER_TYPE_NAMES = {
  nine_router: "9router",
  openai_compatible: "openai_compatible",
} as const satisfies Record<ProviderType, string>;
