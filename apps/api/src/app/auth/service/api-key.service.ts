import { Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { readRequiredSecret } from "../../../common/utils/read-required-secret";
import type { DbTransaction } from "../../prisma/db-transaction";
import { CreditLedgerEntryRepository } from "../../billing/repository/credit-ledger-entry.repository";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { API_KEY_FORMAT } from "../config/api-key-format";
import type { CreateApiKeyDto } from "../dto/create-api-key.dto";
import { ApiKeyRepository } from "../repository/api-key.repository";
import type { ApiKeyOwner } from "../types/api-key-owner";
import type { CreatedApiKey } from "../types/created-api-key";
import type { ListedApiKey } from "../types/listed-api-key";
import { hashApiKey } from "../utils/hash-api-key";
import { matchesApiKeyHash } from "../utils/matches-api-key-hash";
import { parseApiKeyPrefix } from "../utils/parse-api-key-prefix";
import { toApiKeyExpiry } from "../utils/to-api-key-expiry";

const HASH_SECRET_NAME = "API_KEY_HASH_SECRET";
const USAGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** The user status whose keys no longer authenticate (RNX-100, D427). */
const SUSPENDED = "suspended";

/**
 * A user's API keys (RNX-18, D49, D50): several per user, each shown once at creation and stored only as its prefix
 * and its HMAC-SHA256 under API_KEY_HASH_SECRET. A revoked or expired key no longer authenticates.
 */
@Injectable()
export class ApiKeyService {
  constructor(
    private readonly keys: ApiKeyRepository,
    private readonly entitlements: EntitlementService,
    private readonly ledger: CreditLedgerEntryRepository,
  ) {}

  /**
   * Creates a key for this user; the plaintext is in the answer only. RNX-76 B2: one of the user's packages must grant
   * API access, and the key's tiers must be tiers the user's packages allow (400 PACKAGE_LIMIT_REACHED otherwise,
   * nothing written); without a list it gets all of them (RNX-232). Its cap is optional.
   */
  async create(userId: string, dto: CreateApiKeyDto, tx?: DbTransaction): Promise<CreatedApiKey> {
    const entitlement = await this.entitlements.requireApiAccess(userId, tx);
    const packageTiers = await this.entitlements.requireTiers(entitlement, dto.allowedTiers ?? [], tx);
    const allowedTiers = dto.allowedTiers ?? packageTiers;
    const randomHex = randomBytes(API_KEY_FORMAT.randomBytes).toString("hex");
    const apiKey = `${API_KEY_FORMAT.marker}${randomHex}`;
    const view = await this.keys.createKey(
      {
        userId,
        name: dto.name,
        prefix: randomHex.slice(0, API_KEY_FORMAT.prefixLength),
        keyHash: hashApiKey(apiKey, readRequiredSecret(process.env, HASH_SECRET_NAME)),
        expiresAt: toApiKeyExpiry(dto.expiresIn, new Date()),
        allowedTiers: [...allowedTiers],
        monthlyCreditCap: dto.monthlyCreditCap ?? null,
      },
      tx,
    );
    return { ...view, apiKey };
  }

  /**
   * This user's keys, newest first, without hash or plaintext, each with the credits its calls charged in the last 30
   * days (RNX-82: one grouped query for all the user's keys, only their ids are counted).
   */
  async list(userId: string): Promise<ListedApiKey[]> {
    const keys = await this.keys.listKeys(userId);
    const spent = await this.ledger.sumKeysUsageSince(keys.map((key) => key.id), new Date(Date.now() - USAGE_WINDOW_MS));
    return keys.map((key) => ({ ...key, creditsLast30Days: spent.get(key.id)?.toString() ?? "0" }));
  }

  /** Revokes this user's key; a key that is already revoked stays as it is; another user's key or none is a 404. */
  async revoke(userId: string, keyId: string): Promise<void> {
    if ((await this.keys.revokeKey(userId, keyId, new Date())) > 0) return;
    if (!(await this.keys.findKey(userId, keyId))) throw new NotFoundException("API key not found");
  }

  /**
   * The owner of a presented key, or null when the key is malformed, unknown, does not match its stored hash
   * (constant-time compare), is revoked or has expired, or (RNX-100, D427) its owner is suspended: the status comes
   * with the key's own lookup, no extra query. A valid key's last use is set to now. RNX-232: with the key's id and
   * allowed tiers.
   */
  async authenticate(presented: string): Promise<ApiKeyOwner | null> {
    const prefix = parseApiKeyPrefix(presented);
    if (!prefix) return null;
    const key = await this.keys.findKeyByPrefix(prefix);
    const secret = readRequiredSecret(process.env, HASH_SECRET_NAME);
    if (!key || !matchesApiKeyHash(presented, key.keyHash, secret)) return null;
    const now = new Date();
    if (key.revokedAt || (key.expiresAt && key.expiresAt <= now) || key.user.status === SUSPENDED) return null;
    await this.keys.touchLastUsed(key.id, now);
    return { id: key.user.id, email: key.user.email, apiKeyId: key.id, allowedTiers: key.allowedTiers };
  }
}
