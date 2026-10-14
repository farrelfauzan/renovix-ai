import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AdminSessionModule } from "../app/admin-auth/admin-session.module";
import { PortalGuard } from "../app/portal/guard/portal.guard";
import { AccessGuard } from "./guards/access.guard";
import { ApiKeyGuard } from "./guards/api-key.guard";
import { CombinedAuthGuard } from "./guards/combined-auth.guard";

/**
 * `AccessGuard` and the checks behind its methods. The app and the test
 * module both import it and register `AccessGuard` as an APP_GUARD.
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
  providers: [AccessGuard, CombinedAuthGuard, ApiKeyGuard, PortalGuard],
  exports: [AccessGuard],
})
export class AccessModule {}
