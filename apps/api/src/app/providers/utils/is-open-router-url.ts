/** True when a base URL points at OpenRouter, the only provider that takes HTTP-Referer / X-Title (RX-160). */
export const isOpenRouterUrl = (baseUrl: string): boolean => new URL(baseUrl).hostname === "openrouter.ai";
