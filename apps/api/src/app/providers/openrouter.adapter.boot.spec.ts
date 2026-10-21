import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import { EmbeddingService } from "../knowledge/service/embedding.service";
import { assertRequiredSecrets } from "../../common/utils/assert-required-secrets";
import { OpenRouterAdapter } from "./openrouter.adapter";

// RNX-192: no env chat key is needed to boot (chat uses provider records, RX-178). The embedding key still is:
// EMBEDDING_API_KEY, falling back to OPENROUTER_API_KEY.
const ENV_KEYS = ["NODE_ENV", "LLM_PROVIDER", "LLM_API_KEY", "OPENROUTER_API_KEY", "EMBEDDING_API_KEY"] as const;
const savedEnv = ENV_KEYS.map((k) => process.env[k]);

const productionEnv = (extra: Record<string, string>): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  JWT_SECRET: randomBytes(48).toString("base64"),
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64"),
  IP_HASH_SECRET: randomBytes(48).toString("base64"),
  MCP_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  MCP_OAUTH_STATE_SECRET: randomBytes(48).toString("base64"),
  LLM_KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  API_KEY_HASH_SECRET: randomBytes(48).toString("base64"),
  ...extra,
});

const useEnv = (env: Record<string, string>): void => {
  ENV_KEYS.forEach((k) => delete process.env[k]);
  Object.assign(process.env, env);
};

describe("RNX-192: boot without an env chat key", () => {
  afterEach(() => {
    ENV_KEYS.forEach((k, i) => (savedEnv[i] === undefined ? delete process.env[k] : (process.env[k] = savedEnv[i])));
  });

  it("production with no chat key but EMBEDDING_API_KEY set: the secrets check passes and the adapter and embeddings construct", () => {
    useEnv({ NODE_ENV: "production", EMBEDDING_API_KEY: "rnx192-marker-embedding-key" });

    expect(() => assertRequiredSecrets(productionEnv({ EMBEDDING_API_KEY: "rnx192-marker-embedding-key" }))).not.toThrow();
    expect(() => new OpenRouterAdapter(new ConfigService())).not.toThrow();
    expect(() => new EmbeddingService(new ConfigService())).not.toThrow();
  });

  it("control: production with neither EMBEDDING_API_KEY nor OPENROUTER_API_KEY still refuses to start", () => {
    useEnv({ NODE_ENV: "production" });

    expect(() => new EmbeddingService(new ConfigService())).toThrow("OPENROUTER_API_KEY");
  });

  it("listModels with no key returns undefined without calling the network", async () => {
    useEnv({ NODE_ENV: "production" });
    const fetchSpy = jest.spyOn(global, "fetch");
    try {
      const adapter = new OpenRouterAdapter(new ConfigService());

      expect(await adapter.listModels()).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("the price refresh with no key skips with one log line (no key value) and does not throw", async () => {
    useEnv({ NODE_ENV: "production" });
    const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    try {
      const { ProviderPriceRefreshService } = await import("../config/service/provider-price-refresh.service");
      const refresh = new ProviderPriceRefreshService(null as never, null as never, null as never, null as never, null as never);
      const adapter = new OpenRouterAdapter(new ConfigService());
      refresh.setListModeler(async () => adapter.listModels());

      const actualResult = await refresh.checkProviderPrices("openrouter");

      expect(actualResult).toEqual({ checked: 0, updated: 0, alerted: 0 });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("price refresh skipped");
    } finally {
      warnSpy.mockRestore();
    }
  });
});
