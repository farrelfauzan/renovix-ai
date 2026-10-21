import { createHash } from "node:crypto";

const keySuffix = "k9Zq";
const sha256 = createHash("sha256").update("sk-rnx190-fake-key-not-real-k9Zq").digest("hex");

/**
 * RNX-190: a provider 401 body that echoes the API key's last characters and its SHA-256, as SumoPod's does
 * (RX-174). Both values are obviously fake. `isFoundIn` is the planted-value search.
 */
export const plantedProviderSecret = {
  keySuffix,
  sha256,
  body: {
    error: {
      message: `Incorrect API key provided: sk-...${keySuffix}. Received API Key hash = ${sha256}`,
      type: "invalid_request_error",
      code: 401,
    },
  },
  isFoundIn: (text: string): boolean => text.includes(keySuffix) || text.includes(sha256),
} as const;
