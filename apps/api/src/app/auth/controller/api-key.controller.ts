import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { CreateApiKeyDto } from "../dto/create-api-key.dto";
import { ApiKeyRateLimitService } from "../service/api-key-rate-limit.service";
import { ApiKeyService } from "../service/api-key.service";
import type { ApiKeyRateLimitView } from "../types/api-key-rate-limit-view";
import type { ListedApiKey } from "../types/listed-api-key";
import type { CreatedApiKey } from "../types/created-api-key";
import type { RegeneratedApiKey } from "../types/regenerated-api-key";
import type { SignedInUserRequest } from "../types/signed-in-user-request";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

/**
 * The signed-in user's API keys (RNX-18), under /api/v1/auth/keys, for the login token or the session (an API key
 * cannot manage keys). The plaintext key is answered once, by create and regenerate; nothing answers the hash.
 */
@Controller("auth/keys")
export class ApiKeyController {
  constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly rateLimit: ApiKeyRateLimitService,
  ) {}

  /**
   * Creates a key: `{ name, expiresIn: "30d" | "90d" | "1y" | "never", allowedTiers?, monthlyCreditCap? }` (RNX-76 B2:
   * no package API access, or tiers the packages do not allow, are a 400 PACKAGE_LIMIT_REACHED); answers its fields
   * and `apiKey`, once.
   */
  @Post()
  @Access({ auth: ["session"] })
  async create(@Req() req: SignedInUserRequest, @Body() body: unknown): Promise<CreatedApiKey> {
    const parsed = CreateApiKeyDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    return this.apiKeys.create(req.user.userId, parsed.data);
  }

  /**
   * The user's keys, newest first: id, name, prefix, createdAt, lastUsedAt, revokedAt, expiresAt, allowedTiers,
   * monthlyCreditCap, creditsLast30Days (RNX-82: credits its calls charged in the last 30 days).
   */
  @Get()
  @Access({ auth: ["session"] })
  list(@Req() req: SignedInUserRequest): Promise<ListedApiKey[]> {
    return this.apiKeys.list(req.user.userId);
  }

  /** The per-key rate limit for the quick start (RNX-82): `{ requestsPerMinute }`, the value the limiter enforces. */
  @Get("rate-limit")
  @Access({ auth: ["session"] })
  async getRateLimit(): Promise<ApiKeyRateLimitView> {
    return { requestsPerMinute: await this.rateLimit.getRequestsPerMinute() };
  }

  /** Revokes one of the user's keys (204); another user's key or an unknown id is a 404. */
  @Delete(":id")
  @Access({ auth: ["session"] })
  @HttpCode(204)
  async revoke(@Req() req: SignedInUserRequest, @Param("id") id: string): Promise<void> {
    await this.apiKeys.revoke(req.user.userId, id);
  }

  /** Compatibility route until RX-82: a new key that never expires, the user's other keys revoked; `{ apiKey, apiKeyWarning }`. */
  @Post("regenerate")
  @Access({ auth: ["session"] })
  @HttpCode(200)
  regenerate(@Req() req: SignedInUserRequest): Promise<RegeneratedApiKey> {
    return this.apiKeys.regenerate(req.user.userId);
  }
}
