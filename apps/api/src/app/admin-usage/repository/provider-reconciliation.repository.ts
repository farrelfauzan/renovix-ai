import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import type { ReconciliationEntryInput } from "../types/reconciliation-entry-input";

/** The queries on `provider_reconciliation_entries` (RNX-228): one portal balance per provider record and day. */
@Injectable()
export class ProviderReconciliationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The provider's entry of that day (YYYY-MM-DD), if any. */
  findOne(providerId: string, day: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).providerReconciliationEntry.findUnique({ where: { providerId_day: { providerId, day: new Date(day) } } });
  }

  /** Writes the provider's entry of that day, replacing an earlier one. */
  upsert({ providerId, day, portalBalanceUsd, topUpUsd, adminId }: ReconciliationEntryInput, tx: DbTransaction) {
    const values = { portalBalanceUsd, topUpUsd, enteredByAdminId: adminId };
    return tx.providerReconciliationEntry.upsert({
      where: { providerId_day: { providerId, day: new Date(day) } },
      create: { providerId, day: new Date(day), ...values },
      update: values,
    });
  }

  /** Every entry from `from` to `to` (YYYY-MM-DD, both included), by provider then day. */
  findBetween(from: string, to: string) {
    return this.prisma.providerReconciliationEntry.findMany({
      where: { day: { gte: new Date(from), lte: new Date(to) } },
      orderBy: [{ providerId: "asc" }, { day: "asc" }],
    });
  }
}
