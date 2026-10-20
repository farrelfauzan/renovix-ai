import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual, createHash } from "crypto";
import { PrismaService } from "../../app/prisma/prisma.service";

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException(
        "Missing or invalid Authorization header",
      );
    }

    const apiKey = authHeader.slice(7);

    if (!apiKey.startsWith("sk_live_")) {
      throw new UnauthorizedException("Invalid API key format");
    }

    const user = await this.prisma.user.findUnique({
      where: { apiKey },
      select: { id: true, email: true, apiKey: true },
    });

    if (!user) {
      throw new UnauthorizedException("Invalid API key");
    }

    // Constant-time comparison to prevent timing attacks
    const incomingHash = Buffer.from(hashApiKey(apiKey));
    const storedHash = Buffer.from(hashApiKey(user.apiKey));
    if (!timingSafeEqual(incomingHash, storedHash)) {
      throw new UnauthorizedException("Invalid API key");
    }

    request.user = { id: user.id, email: user.email };
    return true;
  }
}
