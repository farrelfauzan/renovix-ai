import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ChatRequest,
  ChatResponse,
  ProviderAdapter,
} from "./provider.interface";
import { LlmEndpoint } from "./types/llm-endpoint";
import { ProviderHttpError } from "./errors/provider-http-error";
import { isOpenRouterUrl } from "./utils/is-open-router-url";
import { parseModelIdMap } from "./utils/parse-model-id-map";
import { parseRetryAfterMs } from "./utils/parse-retry-after-ms";
import { readPositiveInteger } from "../../common/utils/read-positive-integer";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MAX_TOKENS = 4096;
/** Statuses after which a request goes once to LLM_FALLBACK_BASE_URL (RX-160). */
const FALLBACK_STATUSES = [502, 503];
const CHAT_TIMEOUT_MS = 300000;
/** Time allowed until the stream's response headers arrive; the body itself is not cut off. */
const STREAM_CONNECT_TIMEOUT_MS = 120000;
/** RX-161: reasoning models spend max_tokens on hidden reasoning; below this they answer empty. */
const REASONING_MIN_MAX_TOKENS = 2000;

/** A 502/503 that names a Retry-After (RX-161): no back-off loop against the same provider. */
const isRetryAfterOutage = (err: unknown): err is ProviderHttpError & { retryAfterMs: number } =>
  err instanceof ProviderHttpError &&
  FALLBACK_STATUSES.includes(err.status) &&
  err.retryAfterMs !== undefined;

/** D156 (RX-161 AC-c, option B'): any 502 counts as an outage, with or without Retry-After. */
const isBadGateway = (err: unknown): boolean => err instanceof ProviderHttpError && err.status === 502;

/** The first choice of an SSE payload; undefined when the payload is not JSON. */
const readFirstChoice = (payload: string): any => {
  try {
    return JSON.parse(payload).choices?.[0];
  } catch {
    return undefined;
  }
};

/** RX-161: an empty answer cut off by max_tokens is an error, never an empty reply. */
const emptyAnswerError = (providerId: string, maxTokens: unknown): Error =>
  new Error(
    `Model ${providerId} returned an empty answer: max_tokens (${maxTokens}) ran out before any content (finish_reason "length")`,
  );

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

  /** The caller's max_tokens (or the default), raised to the floor for reasoning models (RX-161). */
  private resolveMaxTokens(params: ChatRequest): number {
    const maxTokens = params.max_tokens ?? this.defaultMaxTokens;
    if (!this.supportsReasoning(params.providerId)) return maxTokens;
    return Math.max(maxTokens, REASONING_MIN_MAX_TOKENS);
  }

  /** OpenRouter's attribution headers go only to OpenRouter's base URL. */
  private buildHeaders(endpoint: LlmEndpoint): Record<string, string> {
    const headers = {
      Authorization: `Bearer ${endpoint.apiKey}`,
      Accept: "application/json",
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
    const status = err instanceof ProviderHttpError ? err.status : undefined;
    if (!this.fallback || !status || !FALLBACK_STATUSES.includes(status)) throw err;
    this.logger.warn(
      `[LLM] primary (${new URL(this.primary.baseUrl).host}) answered ${status}; sending the request once to the fallback (${new URL(this.fallback.baseUrl).host})`,
    );
    return send(this.fallback);
  }

  /**
   * RX-161: a 502/503 with Retry-After goes straight on to the fallback when one is
   * configured (rethrown here); without one, the primary is retried once after the stated wait.
   * RX-183: when `signal` fires during the wait, the timer is cleared, the wait rejects with the
   * signal's reason (as an aborted fetch does) and the primary is not called again; chat passes no
   * signal and waits the full time exactly as before.
   */
  private async retryOnceAfter<T>(
    err: unknown,
    send: (endpoint: LlmEndpoint) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!isRetryAfterOutage(err) || this.fallback) throw err;
    this.logger.warn(
      `[LLM] primary (${new URL(this.primary.baseUrl).host}) answered ${err.status} with Retry-After; retrying once in ${err.retryAfterMs}ms`,
    );
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, err.retryAfterMs);
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    return send(this.primary);
  }

  /** POST /chat/completions with Node's fetch; a non-2xx answer becomes a ProviderHttpError. */
  private async post(
    endpoint: LlmEndpoint,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Response> {
    const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(endpoint),
      body: JSON.stringify(body),
      signal,
    });
    if (response.ok) return response;
    throw new ProviderHttpError({
      message: `Request failed with status code ${response.status}`,
      status: response.status,
      bodyText: await response.text(),
      retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
    });
  }

  private async postChat(endpoint: LlmEndpoint, body: Record<string, unknown>): Promise<any> {
    const response = await this.post(endpoint, body, AbortSignal.timeout(CHAT_TIMEOUT_MS));
    return response.json();
  }

  async chat(params: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.toProviderModelId(params.providerId),
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: this.resolveMaxTokens(params),
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

    const send = (endpoint: LlmEndpoint) => this.postChat(endpoint, body);
    const data = await this.postChatWithRetries(body)
      .catch((err) => this.retryOnceAfter(err, send))
      .catch((err) => this.sendToFallback(err, send));

    if (params.max_tokens && params.max_tokens <= 50) {
      this.logger.log(
        `[debug] raw choice: ${JSON.stringify(data.choices?.[0]?.message)}`,
      );
    }

    const first = data.choices?.[0];
    if (!first?.message?.content && !first?.message?.tool_calls && first?.finish_reason === "length") {
      throw emptyAnswerError(params.providerId, body.max_tokens);
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

  /**
   * Today's retries (6 attempts on timeout, 500, 502, 503, 429), against the primary.
   * A 502/503 with Retry-After leaves the loop at once (RX-161, see retryOnceAfter), and so
   * does any 502 when a fallback is configured (D156); without one, a 502 lacking Retry-After
   * keeps this back-off.
   */
  private async postChatWithRetries(body: Record<string, unknown>): Promise<any> {
    const maxRetries = 6;
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.postChat(this.primary, body);
      } catch (err: any) {
        lastError = err;
        if (isRetryAfterOutage(err) || (this.fallback && isBadGateway(err))) throw err;
        const status = err instanceof ProviderHttpError ? err.status : undefined;
        const isTimeout = err?.name === "TimeoutError";

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
      max_tokens: this.resolveMaxTokens(params),
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

    // RX-161: the upstream request is aborted when the caller's signal fires (client gone).
    // RX-183: a consumer that stops iterating closes the upstream by leaving the for await.
    const { signal } = params;
    const send = (endpoint: LlmEndpoint) => this.openStream(endpoint, body, signal);
    // No retries on a stream (today's behaviour); a 502/503 goes once to the fallback.
    const response = await this.openStream(this.primary, body, signal)
      .catch((err) => this.retryOnceAfter(err, send, signal))
      .catch((err) => this.sendToFallback(err, send));

    const decoder = new TextDecoder();
    let buffer = "";
    let chunkCount = 0;
    let isDone = false;
    // RX-161: payloads are held back until the first content or tool call, so an empty
    // answer cut off by max_tokens is never streamed.
    const held: string[] = [];
    let hasAnswer = false;
    let finishReason: string | undefined;

    this.logger.log(
      `[OpenRouter chatStream] Stream connected, waiting for data...`,
    );

    try {
      for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
        chunkCount++;
        if (chunkCount === 1) {
          this.logger.log(
            `[OpenRouter chatStream] First chunk received (${chunk.byteLength} bytes)`,
          );
        }
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") {
            isDone = true;
            break;
          }
          const choice = readFirstChoice(payload);
          finishReason = choice?.finish_reason ?? finishReason;
          hasAnswer ||= Boolean(choice?.delta?.content || choice?.delta?.tool_calls);
          held.push(payload);
          if (hasAnswer) yield* held.splice(0);
        }
        if (isDone) break;
      }
    } catch (err: any) {
      if (params.signal?.aborted) {
        this.logger.warn(
          `[OpenRouter chatStream] Stream aborted after ${chunkCount} chunks (client disconnected)`,
        );
        return;
      }
      throw err;
    }

    if (!hasAnswer && finishReason === "length") {
      throw emptyAnswerError(params.providerId, body.max_tokens);
    }
    yield* held;
    this.logger.log(
      isDone
        ? `[OpenRouter chatStream] Stream complete (${chunkCount} chunks)`
        : `[OpenRouter chatStream] Stream ended without [DONE] (${chunkCount} chunks)`,
    );
  }

  /** Opens the stream; its timeout covers the wait for the response headers, never the body. The optional caller signal aborts it too. */
  private async openStream(
    endpoint: LlmEndpoint,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const connect = new AbortController();
    const timer = setTimeout(
      () => connect.abort(new DOMException("Stream connect timed out", "TimeoutError")),
      STREAM_CONNECT_TIMEOUT_MS,
    );
    try {
      return await this.post(endpoint, body, AbortSignal.any(signal ? [signal, connect.signal] : [connect.signal]));
    } catch (err: any) {
      // RX-169: callers get the status and the body text (ProviderHttpError), never a stream.
      this.logger.error(
        `OpenRouter stream error (${endpoint.label}, ${err.status}): ${err.bodyText ?? err.message}`,
      );
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
