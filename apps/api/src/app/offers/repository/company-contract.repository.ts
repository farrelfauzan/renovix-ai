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

  /** Whether this company has a contract: there is no company table, so a contract is what makes a company id known. */
  async hasContractForCompany(companyId: string, tx?: DbTransaction): Promise<boolean> {
    const contract = await (tx ?? this.prisma).companyContract.findFirst({ where: { companyId }, select: { id: true } });
    return contract !== null;
  }
}
