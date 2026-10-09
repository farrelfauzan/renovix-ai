import { Logger, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OpenRouterAdapter } from "./openrouter.adapter";
import { ProviderRouter } from "./provider-router";
import { ProviderAdapter } from "./provider.interface";
import { FakeProviderAdapter } from "./fake.adapter";
import { FAKE_LLM_WARNING, resolveLlmProvider } from "./llm-provider";

@Module({
  providers: [
    {
      // LLM_PROVIDER=fake (RX-88): the canned fake takes this token and the
      // real adapter (which needs OPENROUTER_API_KEY) is never built.
      provide: OpenRouterAdapter,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): ProviderAdapter => {
        if (resolveLlmProvider(process.env) === "fake") {
          new Logger("ProvidersModule").warn(FAKE_LLM_WARNING);
          return new FakeProviderAdapter([], { canned: true });
        }
        return new OpenRouterAdapter(configService);
      },
    },
    ProviderRouter,
  ],
  exports: [ProviderRouter],
})
export class ProvidersModule {}
