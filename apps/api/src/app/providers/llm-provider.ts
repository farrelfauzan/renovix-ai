export type LlmProvider = "openrouter" | "fake";

/** Variables that hold a real provider key; fake mode refuses to start while one is set (RX-88, RX-160). */
const REAL_KEY_VARIABLES = ["OPENROUTER_API_KEY", "LLM_API_KEY", "EMBEDDING_API_KEY"] as const;

export const FAKE_LLM_WARNING =
  "LLM provider: FAKE — no real model calls. Never use in production.";

/**
 * Which LLM provider this process uses, from LLM_PROVIDER (RX-88). Unset or
 * "openrouter": the real provider. "fake": the canned FakeProviderAdapter,
 * refused in production and when a real key (OPENROUTER_API_KEY, LLM_API_KEY or
 * EMBEDDING_API_KEY) is set (D78A).
 * Only the environment selects it, never a request.
 */
export function resolveLlmProvider(env: NodeJS.ProcessEnv): LlmProvider {
  const value = env.LLM_PROVIDER;
  if (!value || value === "openrouter") return "openrouter";
  if (value !== "fake") {
    throw new Error(
      `LLM_PROVIDER must be "openrouter" or "fake" (got "${value}")`,
    );
  }
  if (env.NODE_ENV === "production") {
    throw new Error("LLM_PROVIDER=fake is not allowed in production");
  }
  const keyVariable = REAL_KEY_VARIABLES.find((name) => env[name]);
  if (keyVariable) {
    throw new Error(
      `LLM_PROVIDER=fake refuses to start while ${keyVariable} is set; unset it to use the fake provider`,
    );
  }
  return "fake";
}
