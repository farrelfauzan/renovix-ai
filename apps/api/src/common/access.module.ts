import { Module } from "@nestjs/common";
import { AdminSessionModule } from "../app/admin-auth/admin-session.module";
import { ApiKeyRateLimitService } from "../app/auth/service/api-key-rate-limit.service";
import { ApiKeyService } from "../app/auth/service/api-key.service";
import { EntitlementService } from "../app/offers/service/entitlement.service";
import { PlatformSettingsService } from "../app/offers/service/platform-settings.service";
import { PortalGuard } from "../app/portal/guard/portal.guard";
import { PortalUserService } from "../app/portal/service/portal-user.service";
import { ALLOWED_ORIGINS } from "./config/allowed-origins.token";
import { AccessGuard } from "./guards/access.guard";
import { AdminOriginGuard } from "./guards/admin-origin.guard";
import { ApiKeyGuard } from "./guards/api-key.guard";
import { CombinedAuthGuard } from "./guards/combined-auth.guard";
import { UserOriginGuard } from "./guards/user-origin.guard";
import { resolveCorsOrigins } from "./utils/resolve-cors-origins";

/**
 * `AccessGuard` and the checks behind its methods, `AdminOriginGuard` (RX-156) and `UserOriginGuard` (RNX-272) with
 * the allowed origins it reads (ALLOWED_ORIGINS: `resolveCorsOrigins(process.env)`, the list main.ts gives CORS).
 * The app and the test module both import it and register `AdminOriginGuard`, `UserOriginGuard`, then
 * `AccessGuard`, as APP_GUARDs.
 */
@Module({
  imports: [AdminSessionModule],
  providers: [
    AccessGuard,
    AdminOriginGuard,
    UserOriginGuard,
    { provide: ALLOWED_ORIGINS, useFactory: () => resolveCorsOrigins(process.env) },
    CombinedAuthGuard,
    ApiKeyGuard,
    ApiKeyService,
    // RNX-76 B2: ApiKeyService's dependency; its repositories come from the global RepositoriesModule.
    EntitlementService,
    ApiKeyRateLimitService,
    PlatformSettingsService,
    PortalGuard,
    PortalUserService,
  ],
  exports: [AccessGuard, AdminOriginGuard, UserOriginGuard],
})
export class AccessModule {}
