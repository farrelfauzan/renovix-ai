import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { readRequiredSecret } from "../../../common/utils/read-required-secret";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { MODEL_TIERS } from "../../offers/config/model-tiers";
import { PurchaseSnapshotRepository } from "../../offers/repository/purchase-snapshot.repository";
import { API_KEY_FORMAT } from "../config/api-key-format";
import type { CreateApiKeyDto } from "../dto/create-api-key.dto";
import { ApiKeyRepository } from "../repository/api-key.repository";
import type { ApiKeyOwner } from "../types/api-key-owner";
import type { ApiKeyView } from "../types/api-key-view";
import type { CreatedApiKey } from "../types/created-api-key";
import type { RegeneratedApiKey } from "../types/regenerated-api-key";
import { hashApiKey } from "../utils/hash-api-key";
import { matchesApiKeyHash } from "../utils/matches-api-key-hash";
import { parseApiKeyPrefix } from "../utils/parse-api-key-prefix";
import { toApiKeyExpiry } from "../utils/to-api-key-expiry";

const HASH_SECRET_NAME = "API_KEY_HASH_SECRET";
const REGENERATED_KEY_NAME = "Regenerated key";
const KEY_WARNING = "Store this key securely. It will not be shown again in full.";
/** D111: a user without a package may use the cheapest tier only. */
const NO_PACKAGE_TIERS: string[] = [MODEL_TIERS[0]];

/**
 * A user's API keys (RNX-18, D49, D50): several per user, each shown once at creation and stored only as its prefix
 * and its HMAC-SHA256 under API_KEY_HASH_SECRET. A revoked or expired key no longer authenticates.
 */
@Injectable()
export class ApiKeyService {
  constructor(
    private readonly keys: ApiKeyRepository,
    private readonly transactions: TransactionService,
    private readonly snapshots: PurchaseSnapshotRepository,
  ) {}

  /**
   * Creates a key for this user; the plaintext is in the answer only. RNX-232: its tiers must be tiers the user's
   * newest package allows (403 otherwise, nothing written); without a list it gets all of them. Its cap is optional.
   */
  async create(userId: string, dto: CreateApiKeyDto, tx?: DbTransaction): Promise<CreatedApiKey> {
    const packageTiers = (await this.snapshots.findLatestPackageTiers(userId, tx))?.allowedTiers ?? NO_PACKAGE_TIERS;
    const allowedTiers = dto.allowedTiers ?? packageTiers;
    const refused = allowedTiers.filter((tier) => !packageTiers.includes(tier));
    if (refused.length > 0) throw new ForbiddenException(`Your package does not allow the tier(s): ${refused.join(", ")}`);
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

  /** This user's keys, newest first, without hash or plaintext. */
  list(userId: string): Promise<ApiKeyView[]> {
    return this.keys.listKeys(userId);
  }

  /** Revokes this user's key; a key that is already revoked stays as it is; another user's key or none is a 404. */
  async revoke(userId: string, keyId: string): Promise<void> {
    if ((await this.keys.revokeKey(userId, keyId, new Date())) > 0) return;
    if (!(await this.keys.findKey(userId, keyId))) throw new NotFoundException("API key not found");
  }

  /**
   * The compatibility route (until RX-82): creates a key that never expires and revokes the user's other keys, in
   * one transaction (a failed revoke leaves no new key and the old keys working). The new key is answered once.
   * RNX-232: it gets the defaults, every tier the package allows and no cap.
   */
  async regenerate(userId: string): Promise<RegeneratedApiKey> {
    const created = await this.transactions.run(async (tx) => {
      const key = await this.create(userId, { name: REGENERATED_KEY_NAME, expiresIn: "never" }, tx);
      await this.keys.revokeOtherKeys(userId, key.id, key.createdAt, tx);
      return key;
    });
    return { apiKey: created.apiKey, apiKeyWarning: KEY_WARNING };
  }

  /**
   * The owner of a presented key, or null when the key is malformed, unknown, does not match its stored hash
   * (constant-time compare), is revoked or has expired. A valid key's last use is set to now. RNX-232: with the key's
   * id and allowed tiers.
   */
  async authenticate(presented: string): Promise<ApiKeyOwner | null> {
    const prefix = parseApiKeyPrefix(presented);
    if (!prefix) return null;
    const key = await this.keys.findKeyByPrefix(prefix);
    const secret = readRequiredSecret(process.env, HASH_SECRET_NAME);
    if (!key || !matchesApiKeyHash(presented, key.keyHash, secret)) return null;
    const now = new Date();
    if (key.revokedAt || (key.expiresAt && key.expiresAt <= now)) return null;
    await this.keys.touchLastUsed(key.id, now);
    return { id: key.user.id, email: key.user.email, apiKeyId: key.id, allowedTiers: key.allowedTiers };
  }
}
