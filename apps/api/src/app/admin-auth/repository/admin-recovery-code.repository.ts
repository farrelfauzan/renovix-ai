import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `admin_recovery_codes` (RX-94). Every method takes the transaction as its last argument. */
@Injectable()
export class AdminRecoveryCodeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Replaces all of this admin's recovery codes by these hashes. Only inside a transaction. */
  async replaceAll(adminId: string, codeHashes: readonly string[], tx: DbTransaction): Promise<void> {
    await tx.adminRecoveryCode.deleteMany({ where: { adminId } });
    await tx.adminRecoveryCode.createMany({ data: codeHashes.map((codeHash) => ({ adminId, codeHash })) });
  }

  /** Removes all of this admin's recovery codes (RX-95, MFA reset). Returns how many. */
  async deleteAll(adminId: string, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).adminRecoveryCode.deleteMany({ where: { adminId } });
    return count;
  }

  /** Marks this admin's unused code with this hash as used (one conditional UPDATE). Returns 1 when it was unused, else 0. */
  async useCode(adminId: string, codeHash: string, now: Date, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).adminRecoveryCode.updateMany({
      where: { adminId, codeHash, usedAt: null },
      data: { usedAt: now },
    });
    return count;
  }
}
