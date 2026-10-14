import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AdminSessionModule } from "../app/admin-auth/admin-session.module";
import { PortalGuard } from "../app/portal/guard/portal.guard";
import { AccessGuard } from "./guards/access.guard";
import { AdminOriginGuard } from "./guards/admin-origin.guard";
import { ApiKeyGuard } from "./guards/api-key.guard";
import { CombinedAuthGuard } from "./guards/combined-auth.guard";

/**
 * `AccessGuard` and the checks behind its methods, and `AdminOriginGuard` (RX-156). The app and the test
 * module both import it and register `AdminOriginGuard`, then `AccessGuard`, as APP_GUARDs.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>("JWT_SECRET"),
        signOptions: { expiresIn: "7d" },
      }),
    }),
    AdminSessionModule,
  ],
  providers: [AccessGuard, AdminOriginGuard, CombinedAuthGuard, ApiKeyGuard, PortalGuard],
  exports: [AccessGuard, AdminOriginGuard],
})
export class AccessModule {}
