import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";
import { ApiKeyService } from "./service/api-key.service";
import { AuthService } from "./service/auth.service";
import { ApiKeyController } from "./controller/api-key.controller";
import { AuthController } from "./controller/auth.controller";
import { BetterAuthController } from "./controller/better-auth.controller";
import { JWT_LIFETIME_SECONDS } from "./utils/auth-cookie";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>("JWT_SECRET"),
        signOptions: { expiresIn: JWT_LIFETIME_SECONDS },
      }),
    }),
  ],
  controllers: [AuthController, ApiKeyController, BetterAuthController],
  providers: [AuthService, ApiKeyService],
  exports: [AuthService],
})
export class AuthModule {}
