import { Module } from "@nestjs/common";
import { OffersModule } from "../offers/offers.module";
import { ApiKeyRateLimitService } from "./service/api-key-rate-limit.service";
import { ApiKeyService } from "./service/api-key.service";
import { AuthService } from "./service/auth.service";
import { SignInSecurityService } from "./service/sign-in-security.service";
import { ApiKeyController } from "./controller/api-key.controller";
import { AuthController } from "./controller/auth.controller";
import { BetterAuthController } from "./controller/better-auth.controller";
import { SignInSecurityController } from "./controller/sign-in-security.controller";

@Module({
  // RNX-76 B2: key creation reads the package entitlement.
  imports: [OffersModule],
  controllers: [AuthController, ApiKeyController, BetterAuthController, SignInSecurityController],
  // RNX-82: this ApiKeyRateLimitService instance only reads the limit for GET /auth/keys/rate-limit; its request
  // windows stay empty. AccessModule's instance is the one the guard counts requests on.
  providers: [AuthService, ApiKeyService, ApiKeyRateLimitService, SignInSecurityService],
  exports: [AuthService],
})
export class AuthModule {}
