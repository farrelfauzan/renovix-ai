import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { TransactionService } from "../../prisma/transaction.service";
import { BUILT_IN_ROLES } from "../config/built-in-roles";
import { AdminUserRepository } from "../repository/admin-user.repository";

/**
 * Role assignment of back-office admins (RX-96, PRD 09 F3/F5). No route yet: RX-95 adds it. At least one
 * owner must remain: the owners' rows are locked first, so two parallel demotions cannot both pass.
 */
@Injectable()
export class AdminRoleService {
  constructor(
    private readonly admins: AdminUserRepository,
    private readonly transactions: TransactionService,
  ) {}

  /**
   * Gives the admin the role `roleName`. 409 when that would leave no owner, 404 for an unknown admin,
   * 400 for an unknown role. The change applies on the admin's next request (D60 A4).
   */
  async assignRole(adminId: string, roleName: string): Promise<void> {
    await this.transactions.run(async (tx) => {
      const owners = await this.admins.lockIdsWithRole(BUILT_IN_ROLES.owner, tx);
      const removesLastOwner = roleName !== BUILT_IN_ROLES.owner && owners.length === 1 && owners[0] === adminId;
      if (removesLastOwner) throw new ConflictException("At least one owner must remain");
      if ((await this.admins.updateRole(adminId, roleName, tx)) === 0) throw new NotFoundException();
    });
  }
}
