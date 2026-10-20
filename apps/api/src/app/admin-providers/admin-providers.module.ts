import { Module } from "@nestjs/common";
import { ConfigRegistryModule } from "../config/config-registry.module";
import { ProvidersModule } from "../providers/providers.module";
import { AdminProviderModelsController } from "./controller/admin-provider-models.controller";
import { AdminProvidersController } from "./controller/admin-providers.controller";
import { AdminProviderModelsService } from "./service/admin-provider-models.service";
import { AdminProvidersService } from "./service/admin-providers.service";

/**
 * Provider records and their models through the admin API (RX-177, D148, D149): /admin/providers and
 * /admin/providers/:providerId/models. No screen yet (RX-102); providers and models are never seeded.
 * ProvidersModule gives ProviderRouter for the test request. ConfigRegistryModule gives ModelRegistryService,
 * whose cache a provider write clears (RX-178); the registry depends on no part of this module (it opens keys
 * through ProviderRepository, from RepositoriesModule), so the direction is one way. The repositories (and the
 * key crypto they use) come from RepositoriesModule.
 */
@Module({
  imports: [ProvidersModule, ConfigRegistryModule],
  controllers: [AdminProvidersController, AdminProviderModelsController],
  providers: [AdminProvidersService, AdminProviderModelsService],
})
export class AdminProvidersModule {}
