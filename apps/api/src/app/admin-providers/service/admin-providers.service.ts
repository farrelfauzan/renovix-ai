import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AdminAuditLogRepository } from "../../admin-auth/repository/admin-audit-log.repository";
import { AiModelRepository } from "../../config/repository/ai-model.repository";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { ProviderRouter } from "../../providers/provider-router";
import type { CreateProviderDto } from "../dto/create-provider.dto";
import type { UpdateProviderDto } from "../dto/update-provider.dto";
import { ProviderRepository } from "../repository/provider.repository";
import type { Audited } from "../types/audited";
import type { ProviderTestOutcome } from "../types/provider-test-outcome";
import type { ProviderView } from "../types/provider-view";
import { buildAuditChange } from "../utils/build-audit-change";
import { toAuditedProviderValues } from "../utils/to-audited-provider-values";
import { toProviderType } from "../utils/to-provider-type";
import { toProviderView } from "../utils/to-provider-view";

const NOT_FOUND = "Provider not found";
/** What a successful test stores in last_test_result (ProviderRepository.activate checks it). */
const TEST_SUCCESS = "success";

/**
 * Provider records (RX-177, D148, D149), managed through /admin/providers. A provider is created inactive,
 * tested with one minimal request, then activated; a new key or base URL clears the test, so activation
 * always follows a test of the current key and base URL. The key is write-only: sealed and opened only by
 * ProviderRepository. Each write returns the change its audit row records: changed fields only, the key
 * named (`apiKey`) and never valued.
 */
@Injectable()
export class AdminProvidersService {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly models: AiModelRepository,
    private readonly router: ProviderRouter,
    private readonly transactions: TransactionService,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  /** Every live provider with its model count. */
  async list(): Promise<ProviderView[]> {
    const records = await this.providers.findLive();
    return records.map(toProviderView);
  }

  /** One live provider; 404 when it does not exist or is deleted. */
  async get(id: string, tx?: DbTransaction): Promise<ProviderView> {
    const record = await this.providers.findLiveById(id, tx);
    if (!record) throw new NotFoundException(NOT_FOUND);
    return toProviderView(record);
  }

  /** Creates an inactive provider with its key sealed. */
  async create(adminId: string, dto: CreateProviderDto, tx: DbTransaction): Promise<Audited<ProviderView>> {
    const record = await this.providers.create({ ...dto, type: toProviderType(dto.type), adminId }, tx);
    const change = buildAuditChange({
      subject: { providerId: record.id },
      before: {},
      after: toAuditedProviderValues(record),
      changedSecrets: ["apiKey"],
    });
    return { result: toProviderView(record), change };
  }

  /** Changes a live provider: a key is rotated only when given; a new key or base URL clears the last test. */
  async update(adminId: string, id: string, dto: UpdateProviderDto, tx: DbTransaction): Promise<Audited<ProviderView>> {
    const before = await this.providers.findLiveById(id, tx);
    if (!before) throw new NotFoundException(NOT_FOUND);
    const after = await this.providers.update(id, { ...dto, adminId }, tx);
    const change = buildAuditChange({
      subject: { providerId: id },
      before: toAuditedProviderValues(before),
      after: toAuditedProviderValues(after),
      changedSecrets: dto.apiKey === undefined ? [] : ["apiKey"],
    });
    return { result: toProviderView(after), change };
  }

  /**
   * Sends one minimal request to the provider (no transaction is open during the call, no usage is metered,
   * no credit is reserved), then stores the result and writes the audit row itself in one short transaction
   * (the route is exempt from the audit hook, whose transaction would span the call). 409 when the provider
   * changed or was deleted while the request ran: the result is not stored.
   */
  async test(adminId: string, id: string, slug: string, requestId: string): Promise<ProviderTestOutcome> {
    const connection = await this.providers.findConnection(id);
    if (!connection) throw new NotFoundException(NOT_FOUND);
    const { isSuccessful, reason } = await this.router.testConnection({ baseUrl: connection.baseUrl, apiKey: connection.apiKey, slug });
    const testedAt = new Date();
    const result = isSuccessful ? TEST_SUCCESS : (reason ?? "The test failed");
    return this.transactions.run(async (tx) => {
      const stored = await this.providers.recordTest(id, { testedVersion: connection.updatedAt, testedAt, result }, tx);
      if (stored === 0) throw new ConflictException("The provider changed or was deleted during the test; test it again");
      const after = { providerId: id, changedFields: "lastTestedAt,lastTestResult" };
      await this.auditLog.create(
        { adminId, resource: "provider", action: "test", before: { providerId: id }, after, reason: "", requestId, effectiveAt: testedAt },
        tx,
      );
      return { isSuccessful, reason: isSuccessful ? null : result, testedAt };
    });
  }

  /** Activates a live provider; 409 unless its last test, run since the last key or base URL change, succeeded. */
  async activate(adminId: string, id: string, tx: DbTransaction): Promise<Audited<ProviderView>> {
    const before = await this.get(id, tx);
    const activated = await this.providers.activate(id, adminId, tx);
    if (activated === 0) {
      throw new ConflictException("The provider has no successful test since its key or base URL last changed; test it first");
    }
    const after = await this.get(id, tx);
    const change = buildAuditChange({ subject: { providerId: id }, before: { status: before.status }, after: { status: after.status } });
    return { result: after, change };
  }

  /** Soft-deletes a live provider; 409 while any of its models is active. */
  async remove(adminId: string, id: string, tx: DbTransaction): Promise<Audited<void>> {
    await this.get(id, tx);
    const activeModels = await this.models.countActiveOnProviderRecord(id, tx);
    if (activeModels > 0) throw new ConflictException(`The provider has ${activeModels} active models; deactivate them first`);
    await this.providers.softDelete(id, adminId, tx);
    const change = buildAuditChange({ subject: { providerId: id }, before: { deleted: false }, after: { deleted: true } });
    return { result: undefined, change };
  }
}
