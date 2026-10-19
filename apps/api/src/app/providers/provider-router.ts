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

@Injectable()
export class ProviderRouter {
  private readonly logger = new Logger(ProviderRouter.name);
  private readonly adapters: Record<string, ProviderAdapter>;
  /** LLM_PROVIDER=fake (RX-88): every provider name routes to the fake. */
  private readonly fakeAdapter?: ProviderAdapter;

  constructor(
    @Inject(OpenRouterAdapter) private readonly openRouterAdapter: ProviderAdapter,
  ) {
    this.adapters = {
      openrouter: this.openRouterAdapter,
    };
    if (resolveLlmProvider(process.env) === "fake") {
      this.fakeAdapter = this.openRouterAdapter;
    }
  }

  async chat(provider: string, params: ChatRequest): Promise<ChatResponse> {
    const adapter = this.fakeAdapter ?? this.adapters[provider];
    if (!adapter) {
      throw new Error(`No adapter found for provider: ${provider}`);
    }

    this.logger.log(
      `[chat] provider=${provider} model=${params.providerId} messages=${params.messages?.length} tools=${params.tools?.length ?? 0}`,
    );

    try {
      return await adapter.chat(params);
    } catch (error: any) {
      this.logger.error(
        `Provider ${provider} failed: ${error.message} status=${error.status}`,
        error.stack,
      );

      // TODO: Add fallback provider logic here (e.g. try another provider if the primary fails)
      throw error;
    }
  }

  async *chatStream(
    provider: string,
    params: ChatRequest,
  ): AsyncGenerator<string, void, unknown> {
    const adapter = this.fakeAdapter ?? this.adapters[provider];
    if (!adapter) {
      throw new Error(`No adapter found for provider: ${provider}`);
    }

    if (!adapter.chatStream) {
      throw new Error(`Provider ${provider} does not support streaming`);
    }

    this.logger.log(
      `[chatStream] provider=${provider} model=${params.providerId} messages=${params.messages?.length} tools=${params.tools?.length ?? 0} tool_choice=${JSON.stringify(params.tool_choice)} toolNames=[${(params.tools || []).map((t: any) => t.function?.name).join(",")}]`,
    );

    yield* adapter.chatStream(params);
  }

  /** The max_tokens the provider's adapter sends for these params (RX-22: the credit estimate's M). */
  resolveMaxTokens(provider: string, params: Pick<ChatRequest, "providerId" | "max_tokens">): number {
    const adapter = this.fakeAdapter ?? this.adapters[provider];
    if (!adapter) {
      throw new Error(`No adapter found for provider: ${provider}`);
    }
    return adapter.resolveMaxTokens(params);
  }

  /** Lists the provider's models with their current prices (RX-21); undefined when the adapter cannot. */
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
