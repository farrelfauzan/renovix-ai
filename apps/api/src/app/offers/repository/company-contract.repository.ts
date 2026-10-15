import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `company_contracts` (RX-86). */
@Injectable()
export class CompanyContractRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a company contract. */
  create(data: Prisma.CompanyContractUncheckedCreateInput, tx?: DbTransaction) {
    return (tx ?? this.prisma).companyContract.create({ data });
  }
}
