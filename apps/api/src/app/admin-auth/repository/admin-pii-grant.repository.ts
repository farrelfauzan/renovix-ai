import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `admin_pii_grants` (RX-96, D56). Every method takes the transaction as its last argument. */
@Injectable()
export class AdminPiiGrantRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Counts this admin's grants for this user that expire after `now`. */
  countActive(adminId: string, subjectUserId: string, now: Date, tx?: DbTransaction): Promise<number> {
    return (tx ?? this.prisma).adminPiiGrant.count({
      where: { adminId, subjectUserId, expiresAt: { gt: now } },
    });
  }
}
