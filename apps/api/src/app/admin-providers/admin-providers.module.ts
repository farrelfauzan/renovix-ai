import { Module } from "@nestjs/common";
import { ProvidersModule } from "../providers/providers.module";
import { AdminProviderModelsController } from "./controller/admin-provider-models.controller";
import { AdminProvidersController } from "./controller/admin-providers.controller";
import { AdminProviderModelsService } from "./service/admin-provider-models.service";
import { AdminProvidersService } from "./service/admin-providers.service";

/**
 * Provider records and their models through the admin API (RX-177, D148, D149): /admin/providers and
 * /admin/providers/:providerId/models. No screen yet (RX-102); providers and models are never seeded.
 * ProvidersModule gives ProviderRouter for the test request. The repositories (and the key crypto they
 * use) come from RepositoriesModule.
 */
@Module({
  imports: [ProvidersModule],
  controllers: [AdminProvidersController, AdminProviderModelsController],
  providers: [AdminProvidersService, AdminProviderModelsService],
})
export class AdminProvidersModule {}
