import type { ProviderTestResult } from "./types/provider-test-result";
import type { ProviderTestTarget } from "./types/provider-test-target";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface JsonSchemaResponseFormat {
  type: "json_schema";
  json_schema: {
    name: string;
    schema: Record<string, unknown>;
  };
}

export interface RegexResponseFormat {
  type: "regex";
  pattern: string;
}

export interface JsonObjectResponseFormat {
  type: "json_object";
}

export type ResponseFormat =
  | JsonSchemaResponseFormat
  | RegexResponseFormat
  | JsonObjectResponseFormat;

export interface ChatRequest {
  model: string;
  providerId: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: ResponseFormat;
  reasoning_effort?: "low" | "medium" | "high";
  tools?: any[];
  tool_choice?: string;
  /** chatStream only (RX-161): aborts the upstream request, e.g. when the client disconnects. Never sent. */
  signal?: AbortSignal;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Input tokens served from the provider's prompt cache (`prompt_tokens_details.cached_tokens`), part of prompt_tokens (RX-22). */
  cachedTokens?: number;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

export interface ChatResponse {
  id: string;
  model: string;
  choices: ChatChoice[];
  usage: ChatUsage;
}

/** One model of the provider's GET /models list (RX-21). Prices are USD per token. */
export interface ProviderModelPrice {
  /** The provider's model id (OpenRouter: "vendor/model"). */
  providerId: string;
  /** USD per token as a decimal string, e.g. "0.000003"; null when the provider reports no price. */
  inputPrice: string | null;
  outputPrice: string | null;
  /** The provider's cached-input price; null when the provider reports none (no cached price yet). */
  cachedInputPrice: string | null;
}

export interface ProviderAdapter {
  chat(params: ChatRequest): Promise<ChatResponse>;
  chatStream?(params: ChatRequest): AsyncGenerator<string, void, unknown>;
  /** The max_tokens this adapter sends for these params (RX-22: the estimate uses the same value). */
  resolveMaxTokens(params: Pick<ChatRequest, "providerId" | "max_tokens">): number;
  /** Lists the provider's models with their current prices (GET /models); optional (RX-21). */
  listModels?(): Promise<ProviderModelPrice[]>;

  /**
   * RX-177: one minimal chat request to a provider record's own base URL and key (not the env endpoints),
   * a single attempt with a short timeout; resolves with the outcome and never rejects. Optional.
   */
  testConnection?(target: ProviderTestTarget): Promise<ProviderTestResult>;
}
