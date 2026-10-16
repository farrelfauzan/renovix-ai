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

export interface ProviderAdapter {
  chat(params: ChatRequest): Promise<ChatResponse>;
  chatStream?(params: ChatRequest): AsyncGenerator<string, void, unknown>;
}
