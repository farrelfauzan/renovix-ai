import { BadRequestException, Injectable } from "@nestjs/common";
import type { CompanyContract } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { CreateCompanyContractDto } from "../dto/create-company-contract.dto";
import { CatalogChangeRepository } from "../repository/catalog-change.repository";
import { CompanyContractRepository } from "../repository/company-contract.repository";
import type { ContractChange } from "../types/contract-change";
import { buildCatalogChange } from "../utils/build-catalog-change";
import { parseOrRefuse } from "../utils/parse-or-refuse";
import { PlatformSettingsService } from "./platform-settings.service";

/**
 * Enterprise company contracts (RX-86, docs/credits.md section 9), filled when a proposal is accepted
 * (RX-32, RX-101). The seat limit may not exceed the seat ceiling setting (D7). The fields of the open
 * decisions D2, D18 and D27 are stored as given, null included; nothing defaults them.
 */
@Injectable()
export class CompanyContractService {
  constructor(
    private readonly contracts: CompanyContractRepository,
    private readonly settings: PlatformSettingsService,
    private readonly changes: CatalogChangeRepository,
    private readonly transactions: TransactionService,
  ) {}

  /** Creates the contract and its change record. 400 when the seat limit is above the seat ceiling or the ceiling is not set. */
  async createContract(change: ContractChange, tx?: DbTransaction): Promise<CompanyContract> {
    const { topUpRoles, ...fields } = parseOrRefuse(CreateCompanyContractDto, change.contract, "Company contract");
    return this.transactions.run(async (db) => {
      const ceiling = await this.settings.getSetting("seatCeiling", db);
      if (ceiling === null) throw new BadRequestException("Company contract refused: the seatCeiling setting is not set");
      if (fields.seatLimit > ceiling) throw new BadRequestException(`Company contract refused: seat limit ${fields.seatLimit} is above the seat ceiling ${ceiling}`);
      const after = await this.contracts.create({ ...fields, ...(topUpRoles && { topUpRoles }) }, db);
      await this.changes.create(buildCatalogChange({ entity: "company_contract", entityId: after.id, before: null, after, author: change.author }), db);
      return after;
    }, undefined, tx);
  }
}
