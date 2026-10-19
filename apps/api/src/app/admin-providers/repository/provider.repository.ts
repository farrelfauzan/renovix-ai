import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import { ProviderKeyCryptoService } from "../service/provider-key-crypto.service";
import type { NewProvider } from "../types/new-provider";
import type { ProviderChanges } from "../types/provider-changes";
import type { ProviderConnection } from "../types/provider-connection";
import type { ProviderRecord } from "../types/provider-record";
import { toApiKeyHint } from "../utils/to-api-key-hint";

/** The columns a provider read returns: never the ciphertext. `_count` needs no deletedAt (models are not soft-deleted). */
const PROVIDER_FIELDS = {
  id: true,
  type: true,
  name: true,
  baseUrl: true,
  apiKeyHint: true,
  status: true,
  lastTestedAt: true,
  lastTestResult: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { models: true } },
} as const;
const NAME_TAKEN = "A provider with this name already exists";
/** What a successful test stores in last_test_result. */
const TEST_SUCCESS = "success";

/**
 * The queries on `providers` (RX-177). Live rows only: PrismaService hides soft-deleted providers from
 * top-level reads (VISIBLE_ONLY); every write below names `deletedAt: null` itself. The key is sealed
 * and opened here only (ProviderKeyCryptoService) and never leaves except to `findConnection`.
 */
@Injectable()
export class ProviderRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: ProviderKeyCryptoService,
  ) {}

  /** Every live provider, oldest first, with its model count. */
  findLive(tx?: DbTransaction): Promise<ProviderRecord[]> {
    return (tx ?? this.prisma).provider.findMany({ select: PROVIDER_FIELDS, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  }

  /** One live provider, or null. */
  findLiveById(id: string, tx?: DbTransaction): Promise<ProviderRecord | null> {
    return (tx ?? this.prisma).provider.findFirst({ where: { id }, select: PROVIDER_FIELDS });
  }

  /** A live provider's base URL and decrypted key, for one test request; null when there is none. */
  async findConnection(id: string, tx?: DbTransaction): Promise<ProviderConnection | null> {
    const row = await (tx ?? this.prisma).provider.findFirst({ where: { id }, select: { baseUrl: true, apiKeyCiphertext: true, updatedAt: true } });
    if (!row) return null;
    return { baseUrl: row.baseUrl, apiKey: this.crypto.reveal(row.apiKeyCiphertext), updatedAt: row.updatedAt };
  }

  /** Creates an inactive provider with its key sealed; a live provider of the same name is a 409. */
  async create({ type, name, baseUrl, apiKey, adminId }: NewProvider, tx?: DbTransaction): Promise<ProviderRecord> {
    const sealed = this.crypto.seal(apiKey);
    const data = {
      type,
      name,
      baseUrl,
      apiKeyCiphertext: sealed.ciphertext,
      apiKeyHint: toApiKeyHint(apiKey),
      credentialKeyVersion: sealed.keyVersion,
      createdByAdminId: adminId,
      updatedByAdminId: adminId,
    };
    return this.refuseTakenName(() => (tx ?? this.prisma).provider.create({ data, select: PROVIDER_FIELDS }));
  }

  /**
   * Applies a change to a live provider; a new key is sealed. A new key or base URL clears the last test and sets
   * the provider inactive (D195): it must be tested and activated again.
   */
  async update(id: string, { apiKey, adminId, ...fields }: ProviderChanges, tx?: DbTransaction): Promise<ProviderRecord> {
    const sealed = apiKey === undefined ? undefined : this.crypto.seal(apiKey);
    const isRetestNeeded = apiKey !== undefined || fields.baseUrl !== undefined;
    const data = {
      ...fields,
      updatedByAdminId: adminId,
      ...(sealed && { apiKeyCiphertext: sealed.ciphertext, apiKeyHint: toApiKeyHint(apiKey as string), credentialKeyVersion: sealed.keyVersion }),
      ...(isRetestNeeded && { lastTestedAt: null, lastTestResult: null, status: "inactive" as const }),
    };
    return this.refuseTakenName(() => (tx ?? this.prisma).provider.update({ where: { id, deletedAt: null }, data, select: PROVIDER_FIELDS }));
  }

  /**
   * Stores a test result, only if the row is still live and unchanged since `testedVersion` (its updatedAt
   * when the test read it), with `result` "success" or the failure reason: a test never vouches for a key or base URL it did not use. Returns the rows written (0 or 1).
   */
  async recordTest(
    id: string,
    { testedVersion, testedAt, result }: { readonly testedVersion: Date; readonly testedAt: Date; readonly result: string },
    tx?: DbTransaction,
  ): Promise<number> {
    const { count } = await (tx ?? this.prisma).provider.updateMany({
      where: { id, deletedAt: null, updatedAt: testedVersion },
      data: { lastTestedAt: testedAt, lastTestResult: result },
    });
    return count;
  }

  /** Activates a live provider whose last test succeeded (cleared by any key or base URL change). Returns the rows written. */
  async activate(id: string, adminId: string, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).provider.updateMany({
      where: { id, deletedAt: null, lastTestResult: TEST_SUCCESS },
      data: { status: "active", updatedByAdminId: adminId },
    });
    return count;
  }

  /** Soft-deletes a live provider (deletedAt, status inactive). Returns the rows written. */
  async softDelete(id: string, adminId: string, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).provider.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date(), status: "inactive", updatedByAdminId: adminId },
    });
    return count;
  }

  /** Runs a write; the partial unique index on live names (P2002) becomes a 409. */
  private async refuseTakenName<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new ConflictException(NAME_TAKEN);
      throw err;
    }
  }
}
