import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `reminders` (RX-133). Every method takes the transaction as its optional last argument. */
@Injectable()
export class ReminderRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a reminder of this user. */
  createReminder(
    userId: string,
    data: Omit<Prisma.ReminderUncheckedCreateInput, "userId">,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).reminder.create({
      data: { userId, ...data },
    });
  }
}
