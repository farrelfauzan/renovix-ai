import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `admin_notifications` (RX-94). Every method takes the transaction as its last argument. */
@Injectable()
export class AdminNotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Records an in-app notification about `subjectAdminId` for the admins of `recipientRole`. */
  create(recipientRole: string, kind: string, subjectAdminId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).adminNotification.create({
      data: { recipientRole, kind, subjectAdminId },
    });
  }

  /** Records an in-app platform alert, about no admin, for the admins of `recipientRole` (RNX-53). */
  createPlatformAlert(recipientRole: string, kind: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).adminNotification.create({
      data: { recipientRole, kind, subjectAdminId: null },
    });
  }

  /** An unread notification of this kind, if any: a repeating alert keeps one unread row (RNX-53). */
  findUnreadByKind(kind: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).adminNotification.findFirst({ where: { kind, readAt: null }, select: { id: true } });
  }
}
