import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `admin_roles` (RX-96). Every method takes the transaction as its last argument. */
@Injectable()
export class AdminRoleRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The role with this name. */
  findByName(name: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).adminRole.findUnique({ where: { name } });
  }
}
