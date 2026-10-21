import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import type { NewApiKeyRow } from "../types/new-api-key-row";

/** The fields of a key a route may answer with (RNX-18): never the hash. */
const VIEW_FIELDS = {
  id: true,
  name: true,
  prefix: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
  expiresAt: true,
} as const;

/** The queries on `api_keys` (RNX-18). Every method takes the transaction as its last argument, optional. */
@Injectable()
export class ApiKeyRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Stores a key (prefix and hash only) and returns its view fields. */
  createKey(data: NewApiKeyRow, tx?: DbTransaction) {
    return (tx ?? this.prisma).apiKey.create({ data, select: VIEW_FIELDS });
  }

  /** This user's keys, revoked and expired ones included, newest first. */
  listKeys(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: VIEW_FIELDS,
    });
  }

  /** The key with this prefix, with its hash, state and owner, for the API key check. */
  findKeyByPrefix(prefix: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).apiKey.findUnique({
      where: { prefix },
      select: { id: true, keyHash: true, revokedAt: true, expiresAt: true, user: { select: { id: true, email: true } } },
    });
  }

  /** The id of this user's key with this id, if there is one. */
  findKey(userId: string, keyId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).apiKey.findFirst({ where: { id: keyId, userId }, select: { id: true } });
  }

  /** Revokes this user's key if it is not revoked yet; returns how many rows changed (0 or 1). */
  async revokeKey(userId: string, keyId: string, now: Date, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).apiKey.updateMany({
      where: { id: keyId, userId, revokedAt: null },
      data: { revokedAt: now },
    });
    return count;
  }

  /** Revokes every key of this user that is not revoked yet, except `keptKeyId`; returns how many changed. */
  async revokeOtherKeys(userId: string, keptKeyId: string, now: Date, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).apiKey.updateMany({
      where: { userId, revokedAt: null, id: { not: keptKeyId } },
      data: { revokedAt: now },
    });
    return count;
  }

  /** Sets the key's last use to `now`. */
  async touchLastUsed(keyId: string, now: Date, tx?: DbTransaction): Promise<void> {
    await (tx ?? this.prisma).apiKey.update({ where: { id: keyId }, data: { lastUsedAt: now } });
  }
}
