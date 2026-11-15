import { Module } from "@nestjs/common";
import { OffersModule } from "../offers/offers.module";
import { ApiKeyRateLimitService } from "./service/api-key-rate-limit.service";
import { ApiKeyService } from "./service/api-key.service";
import { AuthService } from "./service/auth.service";
import { ApiKeyController } from "./controller/api-key.controller";
import { AuthController } from "./controller/auth.controller";
import { BetterAuthController } from "./controller/better-auth.controller";

@Module({
  // RNX-76 B2: key creation reads the package entitlement.
  imports: [OffersModule],
  controllers: [AuthController, ApiKeyController, BetterAuthController],
  // RNX-82: this ApiKeyRateLimitService instance only reads the limit for GET /auth/keys/rate-limit; its request
  // windows stay empty. AccessModule's instance is the one the guard counts requests on.
  providers: [AuthService, ApiKeyService, ApiKeyRateLimitService],
  exports: [AuthService],
})
export class AuthModule {}
