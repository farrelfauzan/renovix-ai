import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  ProviderAdapter,
  ChatRequest,
  ChatResponse,
} from "./provider.interface";
import { OpenRouterAdapter } from "./openrouter.adapter";
import { resolveLlmProvider } from "./llm-provider";

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
        `Provider ${provider} failed: ${error.message} status=${error.response?.status}`,
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
}
