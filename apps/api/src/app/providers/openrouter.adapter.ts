import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Decimal } from "@prisma/client/runtime/client";
import {
  ChatRequest,
  ChatResponse,
  ProviderAdapter,
  ProviderModelPrice,
} from "./provider.interface";
import { LlmEndpoint } from "./types/llm-endpoint";
import { ProviderHttpError } from "./errors/provider-http-error";
import { ProviderTimeoutError } from "./errors/provider-timeout-error";
import { isOpenRouterUrl } from "./utils/is-open-router-url";
import { normalizeModelId } from "./utils/normalize-model-id";
import { readProviderHttpError } from "./utils/read-provider-http-error";
import { readProviderJson } from "./utils/read-provider-json";
import { describeTestFailure } from "./utils/describe-test-failure";
import { ProviderTestResult } from "./types/provider-test-result";
import { ProviderTestTarget } from "./types/provider-test-target";
import { readUsage } from "./utils/read-usage";
import { readPositiveInteger } from "../../common/utils/read-positive-integer";
import { toProviderErrorText } from "../../common/utils/to-provider-error-text";
import { errorName } from "../../common/utils/error-name";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MAX_TOKENS = 4096;
/**
 * Outage statuses whose Retry-After the adapter honours once (RX-161). RNX-179: when a fallback model remains
 * (`hasFallback`), they end the call at once instead, and ProviderRouter moves on to the fallback.
 */
const OUTAGE_STATUSES = [502, 503];
const CHAT_TIMEOUT_MS = 300000;
/** Time allowed until the stream's response headers arrive; the body itself is not cut off. */
const STREAM_CONNECT_TIMEOUT_MS = 120000;
/** RX-161: reasoning models spend max_tokens on hidden reasoning; below this they answer empty. */
const REASONING_MIN_MAX_TOKENS = 2000;
/** RX-177: a provider test is one attempt that gives up after this long. */
const TEST_TIMEOUT_MS = 15000;
/** RX-177: the test request asks for this few output tokens. */
const TEST_MAX_TOKENS = 16;

/** A 502/503 that names a Retry-After (RX-161): no back-off loop against the same provider. */
const isRetryAfterOutage = (err: unknown): err is ProviderHttpError & { retryAfterMs: number } =>
  err instanceof ProviderHttpError &&
  OUTAGE_STATUSES.includes(err.status) &&
  err.retryAfterMs !== undefined;

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

/** A provider price field as a decimal string per token; null when the provider reports none. */
const readPrice = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const price = new Decimal(value as string);
  return price.isFinite() && price.greaterThanOrEqualTo(0) ? price.toFixed() : null;
};

@Injectable()
export class OpenRouterAdapter implements ProviderAdapter {
  private readonly logger = new Logger(OpenRouterAdapter.name);
  private readonly appTitle: string;
  private readonly appUrl: string;
  /** GET /models for the price refresh only (RX-21); chat calls go to the request's connection (RX-178). */
  private readonly modelListEndpoint: LlmEndpoint;
  private readonly defaultMaxTokens: number;

  // Models that support reasoning_effort parameter (matched in the dashed form, normalizeModelId)
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
    // RX-160: LLM_API_KEY falls back to OPENROUTER_API_KEY; with neither the key is empty and the price refresh
    // skips (RNX-192): chat uses provider records, so boot needs no env chat key.
    this.modelListEndpoint = {
      baseUrl: this.configService.get<string>("LLM_BASE_URL") || OPENROUTER_BASE_URL,
      apiKey:
        this.configService.get<string>("LLM_API_KEY") ||
        this.configService.get<string>("OPENROUTER_API_KEY") ||
        "",
    };
    this.defaultMaxTokens = readPositiveInteger({
      name: "LLM_DEFAULT_MAX_TOKENS",
      value: this.configService.get<string>("LLM_DEFAULT_MAX_TOKENS"),
      fallback: DEFAULT_MAX_TOKENS,
    });
    this.appTitle =
      this.configService.get<string>("OPENROUTER_APP_TITLE") || "Renovix AI";
    this.appUrl =
      this.configService.get<string>("OPENROUTER_APP_URL") ||
      "https://chat.renovix.id";
  }

  /** RX-178: compared in the dashed form, so "x/model-5-5" and "model-5.5" are the same model. */
  private supportsReasoning(modelId: string): boolean {
    const id = normalizeModelId(modelId);
    return this.modelsWithReasoningSupport.some((model) =>
      id.includes(normalizeModelId(model.split("/")[1] || model)),
    );
  }

  /** The caller's max_tokens (or the default), raised to the floor for reasoning models (RX-161). */
  resolveMaxTokens(params: Pick<ChatRequest, "connection" | "max_tokens">): number {
    const maxTokens = params.max_tokens ?? this.defaultMaxTokens;
    if (!this.supportsReasoning(params.connection.slug)) return maxTokens;
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
   * RX-161: a 502/503 with Retry-After is retried once against the same connection after the stated
   * wait, unless a fallback model remains (RNX-179: ProviderRouter moves on instead, no wait).
   * RX-183: when `signal` fires during the wait, the timer is cleared, the wait rejects with the
   * signal's reason (as an aborted fetch does) and the provider is not called again; chat passes no
   * signal and waits the full time exactly as before.
   */
  private async retryOnceAfter<T>(
    err: unknown,
    connection: LlmEndpoint,
    send: (endpoint: LlmEndpoint) => Promise<T>,
    { signal, hasFallback }: Pick<ChatRequest, "signal" | "hasFallback">,
  ): Promise<T> {
    if (!isRetryAfterOutage(err) || hasFallback) throw err;
    this.logger.warn(
      `[LLM] provider (${new URL(connection.baseUrl).host}) answered ${err.status} with Retry-After; retrying once in ${err.retryAfterMs}ms`,
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
    return send(connection);
  }

  /** POST /chat/completions with Node's fetch; a non-2xx answer becomes a typed ProviderHttpError, without its body (RNX-190). */
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
    throw await readProviderHttpError(response);
  }

  private async postChat(endpoint: LlmEndpoint, body: Record<string, unknown>): Promise<any> {
    const response = await this.post(endpoint, body, AbortSignal.timeout(CHAT_TIMEOUT_MS));
    return readProviderJson(response);
  }

  /**
   * Lists the provider's models with their current prices (RX-21): GET /models on the env endpoint
   * (LLM_BASE_URL, LLM_API_KEY or OPENROUTER_API_KEY; RX-178 leaves it there), the OpenAI-compatible shape the adapter already speaks
   * ({ data: [{ id, pricing: { prompt, completion, input_cache_read? } }] }).
   * Undefined when no env key is configured (RNX-192): the price refresh then skips.
   */
  async listModels(): Promise<ProviderModelPrice[] | undefined> {
    if (!this.modelListEndpoint.apiKey) return undefined;
    const response = await fetch(`${this.modelListEndpoint.baseUrl}/models`, {
      headers: this.buildHeaders(this.modelListEndpoint),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    if (!response.ok) throw await readProviderHttpError(response);
    const body = (await readProviderJson(response)) as {
      data?: Array<{
        id?: unknown;
        pricing?: Record<string, unknown>;
      }>;
    };
    return (body.data ?? []).map((model) => ({
      providerId: typeof model.id === "string" ? model.id : "",
      inputPrice: readPrice(model.pricing?.prompt),
      outputPrice: readPrice(model.pricing?.completion),
      cachedInputPrice: readPrice(
        model.pricing?.input_cache_read ?? model.pricing?.cached_input,
      ),
    }));
  }

  async chat(params: ChatRequest): Promise<ChatResponse> {
    const { connection } = params;
    const body: Record<string, unknown> = {
      model: connection.slug,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: this.resolveMaxTokens(params),
    };

    if (this.supportsReasoning(connection.slug) && params.reasoning_effort) {
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
    const data = await this.postChatWithRetries(connection, body, params.hasFallback).catch((err) =>
      this.retryOnceAfter(err, connection, send, params),
    );

    if (params.max_tokens && params.max_tokens <= 50) {
      this.logger.log(
        `[debug] raw choice: ${JSON.stringify(data.choices?.[0]?.message)}`,
      );
    }

    const first = data.choices?.[0];
    if (!first?.message?.content && !first?.message?.tool_calls && first?.finish_reason === "length") {
      throw emptyAnswerError(connection.slug, body.max_tokens);
    }
    const usage = readUsage(data.usage);
    if (!usage) throw new Error(`Model ${connection.slug} returned no usage`);

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
      usage,
    };
  }

  /**
   * Today's retries (6 attempts on timeout, 500, 502, 503, 429), against the request's connection.
   * A 502/503 with Retry-After leaves the loop at once (RX-161, see retryOnceAfter); a 502 or 503
   * without one keeps this back-off when no fallback model remains; with one (`hasFallback`, RNX-179) a 502 or 503
   * leaves at once so ProviderRouter can move on. RNX-190 (D199): timeouts on every attempt end in the typed
   * ProviderTimeoutError.
   */
  private async postChatWithRetries(connection: LlmEndpoint, body: Record<string, unknown>, hasFallback = false): Promise<any> {
    const maxRetries = 6;
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.postChat(connection, body);
      } catch (err: any) {
        lastError = err;
        if (isRetryAfterOutage(err)) throw err;
        const status = err instanceof ProviderHttpError ? err.status : undefined;
        if (hasFallback && status && OUTAGE_STATUSES.includes(status)) throw err;
        const isTimeout = err?.name === "TimeoutError";

        if (isTimeout || (status && [500, 502, 503, 429].includes(status))) {
          if (attempt === maxRetries - 1) throw isTimeout ? new ProviderTimeoutError() : err;
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
    const { connection } = params;
    const body: Record<string, unknown> = {
      model: connection.slug,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: this.resolveMaxTokens(params),
      stream: true,
      // RX-178 (D205 b): any OpenAI-compatible provider then ends the stream with the usage chunk billing reads.
      stream_options: { include_usage: true },
    };

    if (this.supportsReasoning(connection.slug) && params.reasoning_effort) {
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
      `[OpenRouter chatStream] model=${connection.slug} tool_choice=${JSON.stringify(body.tool_choice)} tools=${(params.tools || []).length}`,
    );

    // RX-161: the upstream request is aborted when the caller's signal fires (client gone).
    // RX-183: a consumer that stops iterating closes the upstream by leaving the for await.
    const { signal } = params;
    const send = (endpoint: LlmEndpoint) => this.openStream(endpoint, body, signal);
    // No retries on a stream (today's behaviour) beyond one Retry-After wait; none with a fallback left (RNX-179).
    const response = await this.openStream(connection, body, signal).catch((err) =>
      this.retryOnceAfter(err, connection, send, params),
    );

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
      throw emptyAnswerError(connection.slug, body.max_tokens);
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
      // RX-169: callers get the typed error (ProviderHttpError: status and kind, RNX-190), never a stream.
      // RNX-208 (D197, D208): the log names the host and the status only, never the body or an error message.
      this.logger.error(
        `OpenRouter stream error (${new URL(endpoint.baseUrl).host}, ${err.status}): ${err instanceof ProviderHttpError ? toProviderErrorText(err.status).logText : errorName(err)}`,
      );
      // RNX-190 (D199): the connect timeout is the typed timeout error.
      throw err?.name === "TimeoutError" ? new ProviderTimeoutError() : err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * RX-177: one minimal chat request to a provider record's base URL with its key: a single attempt,
   * TEST_TIMEOUT_MS, no retries (the slug is the provider's id, D149). A 2xx answer with a `choices` list is a success; anything else resolves with a readable
   * reason in which the key never appears. Never rejects.
   */
  async testConnection({ baseUrl, apiKey, slug }: ProviderTestTarget): Promise<ProviderTestResult> {
    const body = { model: slug, messages: [{ role: "user", content: "ping" }], max_tokens: TEST_MAX_TOKENS };
    try {
      const response = await this.post({ baseUrl, apiKey }, body, AbortSignal.timeout(TEST_TIMEOUT_MS));
      // A non-JSON answer must not reach the reason: the parse error quotes the body's first characters (D197).
      const answer = (await response.json().catch(() => undefined)) as { choices?: unknown } | undefined;
      if (answer === undefined) return { isSuccessful: false, reason: "The provider answered with something other than JSON" };
      if (Array.isArray(answer.choices)) return { isSuccessful: true, reason: null };
      return { isSuccessful: false, reason: "The provider answered without a chat completion (no choices)" };
    } catch (err) {
      return { isSuccessful: false, reason: describeTestFailure(err, TEST_TIMEOUT_MS) };
    }
  }
}
