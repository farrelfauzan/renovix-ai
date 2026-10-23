import { Module } from "@nestjs/common";
import { ApiKeyService } from "./service/api-key.service";
import { AuthService } from "./service/auth.service";
import { ApiKeyController } from "./controller/api-key.controller";
import { AuthController } from "./controller/auth.controller";
import { BetterAuthController } from "./controller/better-auth.controller";

@Module({
  controllers: [AuthController, ApiKeyController, BetterAuthController],
  providers: [AuthService, ApiKeyService],
  exports: [AuthService],
})
export class AuthModule {}
