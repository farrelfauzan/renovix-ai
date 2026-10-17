import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `messages`, the messages of a conversation (RX-136). Every method takes the transaction as its optional last argument. */
@Injectable()
export class MessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Stores these messages. */
  createMessages(data: Prisma.MessageCreateManyInput[], tx?: DbTransaction) {
    return (tx ?? this.prisma).message.createMany({ data });
  }
}
