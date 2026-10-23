import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { CreateApiKeyDto } from "../dto/create-api-key.dto";
import { ApiKeyService } from "../service/api-key.service";
import type { ApiKeyView } from "../types/api-key-view";
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
  constructor(private readonly apiKeys: ApiKeyService) {}

  /**
   * Creates a key: `{ name, expiresIn: "30d" | "90d" | "1y" | "never", allowedTiers?, monthlyCreditCap? }` (RNX-232: tiers
   * the package does not allow are a 403); answers its fields and `apiKey`, once.
   */
  @Post()
  @Access({ auth: ["jwt", "session"] })
  async create(@Req() req: SignedInUserRequest, @Body() body: unknown): Promise<CreatedApiKey> {
    const parsed = CreateApiKeyDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    return this.apiKeys.create(req.user.userId, parsed.data);
  }

  /**
   * The user's keys, newest first: id, name, prefix, createdAt, lastUsedAt, revokedAt, expiresAt, allowedTiers,
   * monthlyCreditCap.
   */
  @Get()
  @Access({ auth: ["jwt", "session"] })
  list(@Req() req: SignedInUserRequest): Promise<ApiKeyView[]> {
    return this.apiKeys.list(req.user.userId);
  }

  /** Revokes one of the user's keys (204); another user's key or an unknown id is a 404. */
  @Delete(":id")
  @Access({ auth: ["jwt", "session"] })
  @HttpCode(204)
  async revoke(@Req() req: SignedInUserRequest, @Param("id") id: string): Promise<void> {
    await this.apiKeys.revoke(req.user.userId, id);
  }

  /** Compatibility route until RX-82: a new key that never expires, the user's other keys revoked; `{ apiKey, apiKeyWarning }`. */
  @Post("regenerate")
  @Access({ auth: ["jwt", "session"] })
  @HttpCode(200)
  regenerate(@Req() req: SignedInUserRequest): Promise<RegeneratedApiKey> {
    return this.apiKeys.regenerate(req.user.userId);
  }
}
