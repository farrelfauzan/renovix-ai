import { Module } from "@nestjs/common";
import { AdminSessionModule } from "../app/admin-auth/admin-session.module";
import { ApiKeyRateLimitService } from "../app/auth/service/api-key-rate-limit.service";
import { ApiKeyService } from "../app/auth/service/api-key.service";
import { PlatformSettingsService } from "../app/offers/service/platform-settings.service";
import { PortalGuard } from "../app/portal/guard/portal.guard";
import { PortalUserService } from "../app/portal/service/portal-user.service";
import { AccessGuard } from "./guards/access.guard";
import { AdminOriginGuard } from "./guards/admin-origin.guard";
import { ApiKeyGuard } from "./guards/api-key.guard";
import { CombinedAuthGuard } from "./guards/combined-auth.guard";

/**
 * `AccessGuard` and the checks behind its methods, and `AdminOriginGuard` (RX-156). The app and the test
 * module both import it and register `AdminOriginGuard`, then `AccessGuard`, as APP_GUARDs.
 */
@Module({
  imports: [AdminSessionModule],
  providers: [
    AccessGuard,
    AdminOriginGuard,
    CombinedAuthGuard,
    ApiKeyGuard,
    ApiKeyService,
    ApiKeyRateLimitService,
    PlatformSettingsService,
    PortalGuard,
    PortalUserService,
  ],
  exports: [AccessGuard, AdminOriginGuard],
})
export class AccessModule {}
