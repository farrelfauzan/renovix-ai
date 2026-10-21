import { Injectable, NotFoundException } from "@nestjs/common";
import type { InvitationCode } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import type { CreateCodeDto } from "../../codes/dto/redeem-code.dto";
import { CodeRedemptionRepository } from "../../codes/repository/code-redemption.repository";
import { InvitationCodeRepository } from "../../codes/repository/invitation-code.repository";
import { CodesService } from "../../codes/service/codes.service";
import type { ListCodesQueryDto } from "../dto/list-codes-query.dto";
import type { Audited } from "../types/audited";

const NOT_FOUND = "Code not found";

/**
 * Invitation codes through the admin API (RNX-226, D33): create, list, deactivate, and see who redeemed one. Writes go
 * through CodesService on the route's audit transaction. The audit row names the code by id, never by its text: the
 * text is what a user redeems.
 */
@Injectable()
export class AdminCodesService {
  constructor(
    private readonly codesService: CodesService,
    private readonly codes: InvitationCodeRepository,
    private readonly redemptions: CodeRedemptionRepository,
  ) {}

  /** One page of codes, newest first, each with its plan and its number of redemptions, and the total. */
  list(query: ListCodesQueryDto) {
    return this.codesService.listCodes(query.page, query.limit);
  }

  /** Creates a code; its text is generated when the body gives none. `adminId` is stored as its creator. */
  async create(dto: CreateCodeDto, adminId: string, tx: DbTransaction): Promise<Audited<InvitationCode>> {
    const { code } = await this.codesService.createCode(dto, adminId, tx);
    const after = { codeId: code.id, type: code.type, maxRedemptions: code.maxRedemptions, isActive: code.isActive };
    return { result: code, change: { before: { codeId: code.id }, after } };
  }

  /** Deactivates the code: it can no longer be redeemed. 404 when it does not exist. */
  async deactivate(id: string, tx: DbTransaction): Promise<Audited<InvitationCode>> {
    const before = await this.codes.findCodeById(id, tx);
    if (!before) throw new NotFoundException(NOT_FOUND);
    const { code } = await this.codesService.updateCode(id, { isActive: false }, tx);
    return { result: code, change: { before: { codeId: id, isActive: before.isActive }, after: { codeId: id, isActive: code.isActive } } };
  }

  /** The code's redemptions, newest first: the user id, when, and what it granted. 404 when the code does not exist. */
  async listRedemptions(id: string) {
    if (!(await this.codes.findCodeById(id))) throw new NotFoundException(NOT_FOUND);
    return this.redemptions.findRedemptionsByCode(id);
  }
}
