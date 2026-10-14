import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ADMIN_AUTH_CONFIG } from "./config/admin-auth-config.token";
import { ADMIN_ORIGIN } from "./config/admin-origin.token";
import { AdminSessionRepository } from "./repository/admin-session.repository";
import { AdminSessionService } from "./service/admin-session.service";
import { parseAdminAuthConfig } from "./utils/parse-admin-auth-config";
import { parseAdminOrigin } from "./utils/parse-admin-origin";

/**
 * Back-office sessions and the security values (RX-94), without routes: AccessModule imports it for the
 * `staff` method of AccessGuard, AdminAuthModule for sign-in. Needs ADMIN_JWT_SECRET (no fallback).
 * Also the back-office origin for AdminOriginGuard (RX-156): ADMIN_ORIGIN, no fallback.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: ADMIN_AUTH_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => parseAdminAuthConfig((name) => config.get<string>(name)),
    },
    {
      provide: ADMIN_ORIGIN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => parseAdminOrigin(config.get<string>("ADMIN_ORIGIN")),
    },
    AdminSessionRepository,
    AdminSessionService,
  ],
  exports: [ADMIN_AUTH_CONFIG, ADMIN_ORIGIN, AdminSessionService],
})
export class AdminSessionModule {}
