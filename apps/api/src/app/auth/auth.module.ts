import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { BetterAuthController } from "./better-auth.controller";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { JWT_LIFETIME_SECONDS } from "./auth-cookie";

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
  controllers: [AuthController, BetterAuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
