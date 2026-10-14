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
}
