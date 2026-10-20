import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { BUILT_IN_ROLES } from "../config/built-in-roles";
import type { CreateRoleDto } from "../dto/create-role.dto";
import type { UpdateRoleDto } from "../dto/update-role.dto";
import { AdminRoleRepository } from "../repository/admin-role.repository";
import { AdminUserRepository } from "../repository/admin-user.repository";
import type { AdminAuditChange } from "../types/admin-audit-change";
import type { AdminRoleView } from "../types/admin-role-view";
import { isBuiltInRole } from "../utils/is-built-in-role";

const BUILT_IN_FIXED = "Built-in roles cannot be renamed, edited or deleted";

/**
 * Back-office roles (RX-96, RNX-187, PRD 09 F3/F5): the role list, custom roles and role assignment. The five
 * built-in roles are fixed in code: never renamed (D123), edited or deleted. At least one active owner must
 * remain (RX-95: suspended owners do not count): the active owners' rows are locked first, so two parallel
 * demotions or suspensions cannot both pass. No admin changes their own role (RX-95). Every change applies
 * on the admins' next request (permissions are read per request, D60 A4). The writes run in the caller's
 * audit transaction and return their audit change.
 */
@Injectable()
export class AdminRoleService {
  constructor(
    private readonly admins: AdminUserRepository,
    private readonly roles: AdminRoleRepository,
    private readonly transactions: TransactionService,
  ) {}

  /** Every role with its permissions. */
  async list(): Promise<AdminRoleView[]> {
    const rows = await this.roles.list();
    return rows.map((row) => ({ name: row.name, builtIn: isBuiltInRole(row.name), permissions: row.permissions }));
  }

  /** Creates a custom role. 409 when the name is taken (the built-in names always are). */
  async create(body: CreateRoleDto, tx: DbTransaction): Promise<AdminAuditChange> {
    await this.roles.create({ name: body.name, permissions: body.permissions }, tx);
    return { before: { name: null, permissions: null }, after: { name: body.name, permissions: body.permissions.join(",") } };
  }

  /** Renames a custom role and/or replaces its permissions. 403 for a built-in role, 404 unknown, 409 name taken. */
  async update(name: string, body: UpdateRoleDto, tx: DbTransaction): Promise<AdminAuditChange> {
    if (isBuiltInRole(name)) throw new ForbiddenException(BUILT_IN_FIXED);
    const role = await this.roles.findByName(name, tx);
    if (!role) throw new NotFoundException();
    await this.roles.update(name, { name: body.name, permissions: body.permissions }, tx);
    return {
      before: { name, permissions: role.permissions.join(",") },
      after: { name: body.name ?? name, permissions: (body.permissions ?? role.permissions).join(",") },
    };
  }

  /** Deletes a custom role. 403 for a built-in role, 404 unknown, 409 while an admin or an invitation holds it. */
  async delete(name: string, tx: DbTransaction): Promise<AdminAuditChange> {
    if (isBuiltInRole(name)) throw new ForbiddenException(BUILT_IN_FIXED);
    const role = await this.roles.findByName(name, tx);
    if (!role || (await this.roles.delete(name, tx)) === 0) throw new NotFoundException();
    return { before: { name, permissions: role.permissions.join(",") }, after: { name: null, permissions: null } };
  }

  /**
   * `actorAdminId` gives the admin `adminId` the role `roleName`. 403 when they are the same admin, 409
   * when that would leave no active owner, 404 for an unknown admin, 400 for an unknown role. The change
   * applies on the admin's next request (D60 A4). Joins `tx` when given, else opens its own transaction.
   */
  async assignRole(adminId: string, roleName: string, actorAdminId: string, tx?: DbTransaction): Promise<AdminAuditChange> {
    if (actorAdminId === adminId) throw new ForbiddenException("You cannot change your own role");
    return this.transactions.run(
      async (work) => {
        const owners = await this.admins.lockActiveIdsWithRole(BUILT_IN_ROLES.owner, work);
        const removesLastOwner = roleName !== BUILT_IN_ROLES.owner && owners.length === 1 && owners[0] === adminId;
        if (removesLastOwner) throw new ConflictException("At least one active owner must remain");
        const admin = await this.admins.findById(adminId, work);
        if (!admin || (await this.admins.updateRole(adminId, roleName, work)) === 0) throw new NotFoundException();
        return { before: { adminId, role: admin.role }, after: { adminId, role: roleName } };
      },
      undefined,
      tx,
    );
  }
}
