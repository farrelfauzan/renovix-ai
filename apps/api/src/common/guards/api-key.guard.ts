import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { API_KEY_FORMAT } from "../../app/auth/config/api-key-format";
import { ApiKeyService } from "../../app/auth/service/api-key.service";

/**
 * `Authorization: Bearer rnx_live_…` (RNX-18): the key is looked up by its prefix and its HMAC-SHA256 compared with
 * the stored hash in constant time (ApiKeyService.authenticate); a missing, malformed, unknown, wrong, revoked or
 * expired key is a 401. A valid key attaches its owner as `request.user` and records its last use.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException(
        "Missing or invalid Authorization header",
      );
    }

    const apiKey = authHeader.slice(7);

    if (!apiKey.startsWith(API_KEY_FORMAT.marker)) {
      throw new UnauthorizedException("Invalid API key format");
    }

    const owner = await this.apiKeys.authenticate(apiKey);
    if (!owner) {
      throw new UnauthorizedException("Invalid API key");
    }

    request.user = { id: owner.id, email: owner.email };
    return true;
  }
}
