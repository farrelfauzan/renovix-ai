/** One API key as GET /auth/keys answers it (RNX-82). Decimals arrive as strings. */
export interface ApiKeyListItem {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  allowedTiers: string[];
  monthlyCreditCap: string | null;
  creditsLast30Days: string;
}

/** The body of POST /auth/keys. */
export interface CreateApiKeyInput {
  name: string;
  expiresIn: "30d" | "90d" | "1y" | "never";
  allowedTiers: string[];
  monthlyCreditCap?: number;
}

/** What POST /auth/keys answers: the key's fields and the full key, this once. */
export interface CreatedApiKey extends Omit<ApiKeyListItem, "creditsLast30Days"> {
  apiKey: string;
}

/** One model of GET /models (public list), the fields the quick start reads. */
export interface ListedModel {
  id: string;
  tier: string;
}
