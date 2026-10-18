import { Global, Module } from "@nestjs/common";
import { ModelRegistryService } from "./model-registry.service";
import { ProviderPriceRefreshService } from "./service/provider-price-refresh.service";
import { ProviderPriceRefreshScheduler } from "./scheduler/provider-price-refresh.scheduler";
import { ProvidersModule } from "../providers/providers.module";

@Global()
@Module({
  // ProvidersModule for the price-refresh scheduler's ProviderRouter (RX-21); ProvidersModule
  // imports nothing of this app's own modules, so no cycle.
  imports: [ProvidersModule],
  providers: [ModelRegistryService, ProviderPriceRefreshService, ProviderPriceRefreshScheduler],
  exports: [ModelRegistryService],
})
export class ConfigRegistryModule {}
