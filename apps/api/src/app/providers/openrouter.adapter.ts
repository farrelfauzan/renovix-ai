import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import {
  ChatRequest,
  ChatResponse,
  ProviderAdapter,
} from "./provider.interface";
import { LlmEndpoint } from "./types/llm-endpoint";
import { isOpenRouterUrl } from "./utils/is-open-router-url";
import { parseModelIdMap } from "./utils/parse-model-id-map";
import { readPositiveInteger } from "../../common/utils/read-positive-integer";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MAX_TOKENS = 4096;
/** Statuses after which a request goes once to LLM_FALLBACK_BASE_URL (RX-160). */
const FALLBACK_STATUSES = [502, 503];

@Injectable()
export class OpenRouterAdapter implements ProviderAdapter {
  private readonly logger = new Logger(OpenRouterAdapter.name);
  private readonly appTitle: string;
  private readonly appUrl: string;
  private readonly primary: LlmEndpoint;
  private readonly fallback?: LlmEndpoint;
  private readonly defaultMaxTokens: number;
  private readonly modelIdMap: ReadonlyMap<string, string>;

  // Models that support reasoning_effort parameter
  private readonly modelsWithReasoningSupport = [
    "deepseek/deepseek-v4-pro",
    "qwen/qwen3.7-max",
    "qwen/qwen3.5-397b",
    "x-ai/grok-4.3",
    "anthropic/claude-sonnet-4.6",
    "anthropic/claude-opus-4.7",
    "anthropic/claude-opus-4.8",
    "anthropic/claude-opus-5.5",
  ];

  constructor(private readonly configService: ConfigService) {
    // RX-160: LLM_API_KEY falls back to OPENROUTER_API_KEY; with neither, getOrThrow fails as before.
    this.primary = {
      label: "primary",
      baseUrl: this.configService.get<string>("LLM_BASE_URL") || OPENROUTER_BASE_URL,
      apiKey:
        this.configService.get<string>("LLM_API_KEY") ||
        this.configService.getOrThrow<string>("OPENROUTER_API_KEY"),
    };
    const fallbackBaseUrl = this.configService.get<string>("LLM_FALLBACK_BASE_URL");
    this.fallback = fallbackBaseUrl
      ? {
          label: "fallback",
          baseUrl: fallbackBaseUrl,
          apiKey: this.configService.getOrThrow<string>("LLM_FALLBACK_API_KEY"),
        }
      : undefined;
    this.defaultMaxTokens = readPositiveInteger({
      name: "LLM_DEFAULT_MAX_TOKENS",
      value: this.configService.get<string>("LLM_DEFAULT_MAX_TOKENS"),
      fallback: DEFAULT_MAX_TOKENS,
    });
    this.modelIdMap = parseModelIdMap(this.configService.get<string>("LLM_MODEL_ID_MAP"));
    this.appTitle =
      this.configService.get<string>("OPENROUTER_APP_TITLE") || "Renovix AI";
    this.appUrl =
      this.configService.get<string>("OPENROUTER_APP_URL") ||
      "https://chat.renovix.id";
  }

  private supportsReasoning(modelId: string): boolean {
    return this.modelsWithReasoningSupport.some((model) =>
      modelId.includes(model.split("/")[1] || model),
    );
  }

  /** The id the provider expects (LLM_MODEL_ID_MAP); only the outgoing body uses it. */
  private toProviderModelId(providerId: string): string {
    return this.modelIdMap.get(providerId) ?? providerId;
  }

  /** OpenRouter's attribution headers go only to OpenRouter's base URL. */
  private buildHeaders(endpoint: LlmEndpoint): Record<string, string> {
    const headers = {
      Authorization: `Bearer ${endpoint.apiKey}`,
      "Content-Type": "application/json",
    };
    if (!isOpenRouterUrl(endpoint.baseUrl)) return headers;
    return { ...headers, "HTTP-Referer": this.appUrl, "X-Title": this.appTitle };
  }

  /**
   * After the primary answered 502 or 503 (chat: once its retries are used up), the request
   * goes once to the fallback, if one is configured. Any other error is rethrown as is.
   */
  private sendToFallback<T>(
    err: unknown,
    send: (endpoint: LlmEndpoint) => Promise<T>,
  ): Promise<T> {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    if (!this.fallback || !status || !FALLBACK_STATUSES.includes(status)) throw err;
    this.logger.warn(
      `[LLM] primary (${new URL(this.primary.baseUrl).host}) answered ${status}; sending the request once to the fallback (${new URL(this.fallback.baseUrl).host})`,
    );
    return send(this.fallback);
  }

  private async postChat(endpoint: LlmEndpoint, body: Record<string, unknown>): Promise<any> {
    const response = await axios.post(`${endpoint.baseUrl}/chat/completions`, body, {
      headers: this.buildHeaders(endpoint),
      timeout: 300000,
    });
    return response.data;
  }

  async chat(params: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.toProviderModelId(params.providerId),
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? this.defaultMaxTokens,
    };

    if (this.supportsReasoning(params.providerId) && params.reasoning_effort) {
      body.reasoning_effort = params.reasoning_effort;
    }

    if (params.response_format) {
      body.response_format = params.response_format;
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
      body.tool_choice = params.tool_choice ?? "auto";
    }

    const data = await this.postChatWithRetries(body).catch((err) =>
      this.sendToFallback(err, (endpoint) => this.postChat(endpoint, body)),
    );

    if (params.max_tokens && params.max_tokens <= 50) {
      this.logger.log(
        `[debug] raw choice: ${JSON.stringify(data.choices?.[0]?.message)}`,
      );
    }

    return {
      id: data.id,
      model: params.model,
      choices: data.choices.map((c: any, i: number) => ({
        index: i,
        message: {
          role: c.message.role,
          content: c.message.content,
          ...(c.message.tool_calls && { tool_calls: c.message.tool_calls }),
        },
        finish_reason: c.finish_reason,
      })),
      usage: {
        prompt_tokens: data.usage.prompt_tokens,
        completion_tokens: data.usage.completion_tokens,
        total_tokens: data.usage.total_tokens,
      },
    };
  }

  /** Today's retries (6 attempts on timeout, 500, 502, 503, 429), against the primary. */
  private async postChatWithRetries(body: Record<string, unknown>): Promise<any> {
    const maxRetries = 6;
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.postChat(this.primary, body);
      } catch (err: any) {
        lastError = err;
        const status = err.response?.status;
        const isTimeout =
          err.code === "ECONNABORTED" || err.message?.includes("timeout");

        if (isTimeout || (status && [500, 502, 503, 429].includes(status))) {
          const delay =
            status === 429
              ? Math.min(5000 * 2 ** attempt, 60000)
              : Math.min(2000 * 2 ** attempt, 15000);
          this.logger.warn(
            `[OpenRouter chat] Attempt ${attempt + 1}/${maxRetries} failed (${isTimeout ? "timeout" : status}). Retrying in ${delay}ms...`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        throw err;
      }
    }

    throw lastError;
  }

  async *chatStream(
    params: ChatRequest,
  ): AsyncGenerator<string, void, unknown> {
    const body: Record<string, unknown> = {
      model: this.toProviderModelId(params.providerId),
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? this.defaultMaxTokens,
      stream: true,
    };

    if (this.supportsReasoning(params.providerId) && params.reasoning_effort) {
      body.reasoning_effort = params.reasoning_effort;
    }

    if (params.response_format) {
      body.response_format = params.response_format;
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
      body.tool_choice = params.tool_choice ?? "auto";
    }

    this.logger.log(
      `[OpenRouter chatStream] model=${params.providerId} tool_choice=${JSON.stringify(body.tool_choice)} tools=${(params.tools || []).length}`,
    );

    // No retries on a stream (today's behaviour); a 502/503 goes once to the fallback.
    const response = await this.openStream(this.primary, body).catch((err) =>
      this.sendToFallback(err, (endpoint) => this.openStream(endpoint, body)),
    );

    const stream = response.data as NodeJS.ReadableStream;
    let buffer = "";
    let chunkCount = 0;
    let completed = false;

    this.logger.log(
      `[OpenRouter chatStream] Stream connected, waiting for data...`,
    );

    stream.on("error", (err: any) => {
      if (completed) return;
      this.logger.warn(
        `[OpenRouter chatStream] Stream error event: ${err.message}`,
      );
    });

    try {
      for await (const chunk of stream) {
        chunkCount++;
        if (chunkCount === 1) {
          this.logger.log(
            `[OpenRouter chatStream] First chunk received (${chunk.toString().length} bytes)`,
          );
        }
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") {
            this.logger.log(
              `[OpenRouter chatStream] Stream complete (${chunkCount} chunks)`,
            );
            completed = true;
            return;
          }
          yield payload;
        }
      }
    } catch (err: any) {
      if (err.message === "aborted" || err.code === "ECONNRESET") {
        completed = true;
        this.logger.warn(
          `[OpenRouter chatStream] Stream aborted after ${chunkCount} chunks (client likely disconnected)`,
        );
        return;
      }
      throw err;
    }

    this.logger.log(
      `[OpenRouter chatStream] Stream ended without [DONE] (${chunkCount} chunks)`,
    );
  }

  private async openStream(endpoint: LlmEndpoint, body: Record<string, unknown>) {
    try {
      return await axios.post(`${endpoint.baseUrl}/chat/completions`, body, {
        headers: this.buildHeaders(endpoint),
        timeout: 120000,
        responseType: "stream",
      });
    } catch (err: any) {
      const errBody = err.response?.data
        ? await this.drainStream(err.response.data)
        : err.message;
      this.logger.error(
        `OpenRouter stream error (${endpoint.label}, ${err.response?.status}): ${errBody}`,
      );
      throw err;
    }
  }

  private async drainStream(stream: NodeJS.ReadableStream): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf-8");
  }
}
