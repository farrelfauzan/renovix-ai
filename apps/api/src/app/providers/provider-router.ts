import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  ProviderAdapter,
  ChatRequest,
  ChatResponse,
  ProviderModelPrice,
} from "./provider.interface";
import { OpenRouterAdapter } from "./openrouter.adapter";
import { resolveLlmProvider } from "./llm-provider";
import type { ProviderTestResult } from "./types/provider-test-result";
import type { ProviderTestTarget } from "./types/provider-test-target";
import type { ModelConnection } from "./types/model-connection";
import type { CallHooks } from "./types/call-hooks";
import { ProviderCircuitBreaker } from "./provider-circuit-breaker";
import { ProviderHttpError } from "./errors/provider-http-error";
import { isFailoverError } from "./utils/is-failover-error";
import { isProviderFailure } from "./utils/is-provider-failure";

/**
 * RNX-179: variables of the env fallback that RX-178 removed (D199-4). Nothing reads them; at boot a warning names
 * each one that is set (never its value). LLM_BASE_URL and LLM_API_KEY stay: the price refresh reads them.
 */
const REMOVED_LLM_VARIABLES = ["LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_API_KEY", "LLM_MODEL_ID_MAP"] as const;
/** RNX-179: what a call gets when the breaker of every candidate provider is open. */
const ALL_OPEN_STATUS = 503;

@Injectable()
export class ProviderRouter {
  private readonly logger = new Logger(ProviderRouter.name);
  private readonly adapters: Record<string, ProviderAdapter>;
  /** LLM_PROVIDER=fake (RX-88): every provider name routes to the fake. */
  private readonly fakeAdapter?: ProviderAdapter;
  /** RNX-179: one breaker per provider record, in this process's memory (each Cloud Run instance has its own). */
  private readonly breaker = new ProviderCircuitBreaker();

  constructor(
    @Inject(OpenRouterAdapter) private readonly openRouterAdapter: ProviderAdapter,
  ) {
    this.adapters = {
      openrouter: this.openRouterAdapter,
    };
    if (resolveLlmProvider(process.env) === "fake") {
      this.fakeAdapter = this.openRouterAdapter;
    }
    for (const name of REMOVED_LLM_VARIABLES.filter((variable) => process.env[variable])) {
      this.logger.warn(`${name} is set but has no effect: chat fallbacks are per-model fallback models now (RNX-179); remove it`);
    }
  }

  /**
   * RX-178: one chat call to the request's connection (its provider record), through the OpenAI-compatible
   * adapter (the fake in LLM_PROVIDER=fake mode). RNX-179: a 502 or 503 moves the call to the connection's next
   * fallback model (its own provider and slug); any other error ends it. A provider record whose breaker is open is
   * skipped. The response names the model and provider that answered (`servedBy`); `hooks` report each attempt.
   */
  async chat(params: ChatRequest, hooks: CallHooks = {}): Promise<ChatResponse> {
    const adapter = this.fakeAdapter ?? this.openRouterAdapter;
    const candidates = this.candidatesOf(params.connection);
    for (const [index, connection] of candidates.entries()) {
      const hasFallback = index < candidates.length - 1;
      const attempt = { slug: connection.slug, providerName: connection.providerName };
      hooks.onAttempt?.(attempt);
      this.logger.log(
        `[chat] provider=${connection.providerName} model=${connection.slug} messages=${params.messages?.length} tools=${params.tools?.length ?? 0}`,
      );
      try {
        const response = await adapter.chat({ ...params, connection, ...(hasFallback && { hasFallback }) });
        this.recordOutcome(connection);
        return { ...response, servedBy: attempt };
      } catch (error: any) {
        this.recordOutcome(connection, error);
        this.logger.error(
          `Provider ${connection.providerName} failed: ${error.message} status=${error.status}`,
          error.stack,
        );
        if (!hasFallback || !isFailoverError(error)) throw error;
        this.logger.warn(`[chat] ${connection.slug} answered ${error.status}; falling back to ${candidates[index + 1].slug}`);
        await hooks.onAttemptFailed?.(attempt, error);
      }
    }
    throw this.allOpenError(params.connection);
  }

  /**
   * RX-178: streams one chat call from the request's connection (see chat). RNX-179: a 502 or 503 before the first
   * payload moves the call to the next fallback model; once a payload has been yielded there is no fallback, and an
   * error reaches the caller (who ends its stream with an error event). `hooks` report each attempt; the last
   * `onAttempt` before the first payload names the model and provider that answered.
   */
  async *chatStream(params: ChatRequest, hooks: CallHooks = {}): AsyncGenerator<string, void, unknown> {
    const adapter = this.fakeAdapter ?? this.openRouterAdapter;
    if (!adapter.chatStream) {
      throw new Error(`Provider ${params.connection.providerName} does not support streaming`);
    }
    const candidates = this.candidatesOf(params.connection);
    for (const [index, connection] of candidates.entries()) {
      const hasFallback = index < candidates.length - 1;
      const attempt = { slug: connection.slug, providerName: connection.providerName };
      hooks.onAttempt?.(attempt);
      this.logger.log(
        `[chatStream] provider=${connection.providerName} model=${connection.slug} messages=${params.messages?.length} tools=${params.tools?.length ?? 0} tool_choice=${JSON.stringify(params.tool_choice)} toolNames=[${(params.tools || []).map((t: any) => t.function?.name).join(",")}]`,
      );
      const stream = adapter.chatStream({ ...params, connection, ...(hasFallback && { hasFallback }) });
      let first: IteratorResult<string, void>;
      try {
        first = await stream.next();
      } catch (error: any) {
        this.recordOutcome(connection, error);
        if (!hasFallback || !isFailoverError(error)) throw error;
        this.logger.warn(`[chatStream] ${connection.slug} answered ${error.status}; falling back to ${candidates[index + 1].slug}`);
        await hooks.onAttemptFailed?.(attempt, error);
        continue;
      }
      this.recordOutcome(connection);
      if (first.done) return;
      try {
        yield first.value;
        yield* stream;
      } finally {
        await stream.return(undefined);
      }
      return;
    }
    throw this.allOpenError(params.connection);
  }

  /** RNX-179: the connection and its fallbacks, in order, without those whose provider's breaker is open (logged). */
  private candidatesOf(connection: ModelConnection): ModelConnection[] {
    return [connection, ...(connection.fallbacks ?? [])].filter((candidate) => {
      const isOpen = candidate.providerRecordId !== undefined && this.breaker.isOpen(candidate.providerRecordId);
      if (isOpen) this.logger.warn(`[circuit] provider ${candidate.providerName} is open; skipping ${candidate.slug}`);
      return !isOpen;
    });
  }

  /** RNX-179: feeds the provider record's breaker: a success closes it; a transport failure counts (a 4xx does not). */
  private recordOutcome(connection: ModelConnection, error?: unknown): void {
    if (connection.providerRecordId === undefined) return;
    if (error === undefined) return this.breaker.recordSuccess(connection.providerRecordId);
    if (!isProviderFailure(error)) return;
    if (this.breaker.recordFailure(connection.providerRecordId)) {
      this.logger.warn(`[circuit] provider ${connection.providerName} failed repeatedly; its breaker is open`);
    }
  }

  /** RNX-179: every candidate's provider breaker is open: the typed 503, so callers charge 0 and show the fixed text. */
  private allOpenError(connection: ModelConnection): ProviderHttpError {
    this.logger.error(`[circuit] no provider available for ${connection.slug}: every candidate's breaker is open`);
    return new ProviderHttpError({ status: ALL_OPEN_STATUS, kind: "unavailable" });
  }

  /** The max_tokens the adapter sends for these params (RX-22: the credit estimate's M; RX-178: the same reasoning detection). */
  resolveMaxTokens(params: Pick<ChatRequest, "connection" | "max_tokens">): number {
    const adapter = this.fakeAdapter ?? this.openRouterAdapter;
    return adapter.resolveMaxTokens(params);
  }

  /** Lists the provider's models with their current prices (RX-21, the env endpoint); undefined when the adapter cannot. */
  async listModels(
    provider: string,
  ): Promise<ProviderModelPrice[] | undefined> {
    const adapter = this.fakeAdapter ?? this.adapters[provider];
    if (!adapter?.listModels) return undefined;
    return adapter.listModels();
  }

  /**
   * RX-177: tests a provider record's connection with one minimal request through the OpenAI-compatible
   * adapter (the fake in LLM_PROVIDER=fake mode, so nothing leaves the machine). Outside the credit path:
   * no usage is metered here.
   */
  async testConnection(target: ProviderTestTarget): Promise<ProviderTestResult> {
    const adapter = this.fakeAdapter ?? this.openRouterAdapter;
    if (!adapter.testConnection) throw new Error("The provider adapter cannot test a connection");
    const result = await adapter.testConnection(target);
    this.logger.log(`[testConnection] host=${new URL(target.baseUrl).host} model=${target.slug} isSuccessful=${result.isSuccessful}`);
    return result;
  }
}
