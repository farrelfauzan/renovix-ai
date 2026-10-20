import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

const NAME_TAKEN = "A role with this name already exists";

/** True for a Prisma error with this code (P2002 unique, P2003 foreign key). */
const hasPrismaCode = (err: unknown, code: string): boolean => err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

/** The queries on `admin_roles` (RX-96). Every method takes the transaction as its last argument. */
@Injectable()
export class AdminRoleRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The role with this name. */
  findByName(name: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).adminRole.findUnique({ where: { name } });
  }

  /** Every role (RNX-187), by name. */
  list(tx?: DbTransaction) {
    return (tx ?? this.prisma).adminRole.findMany({ select: { name: true, permissions: true }, orderBy: { name: "asc" } });
  }

  /** Creates a custom role (RNX-187). 409 when a role has this name already. */
  async create(data: { name: string; permissions: string[] }, tx: DbTransaction): Promise<void> {
    try {
      await tx.adminRole.create({ data: { ...data, builtIn: false } });
    } catch (err) {
      if (hasPrismaCode(err, "P2002")) throw new ConflictException(NAME_TAKEN);
      throw err;
    }
  }

  /**
   * Renames the role and/or replaces its permissions (RNX-187); the admins and invitations holding it follow
   * a rename (ON UPDATE CASCADE). 409 when another role has the new name.
   */
  async update(name: string, data: { name?: string; permissions?: string[] }, tx: DbTransaction): Promise<void> {
    try {
      await tx.adminRole.update({ where: { name }, data });
    } catch (err) {
      if (hasPrismaCode(err, "P2002")) throw new ConflictException(NAME_TAKEN);
      throw err;
    }
  }

  /** Deletes the role (RNX-187). Returns 0 (no such role) or 1; 409 while an admin or an invitation holds it (ON DELETE RESTRICT). */
  async delete(name: string, tx: DbTransaction): Promise<number> {
    try {
      const { count } = await tx.adminRole.deleteMany({ where: { name } });
      return count;
    } catch (err) {
      if (hasPrismaCode(err, "P2003")) throw new ConflictException("The role is held by an admin or an invitation");
      throw err;
    }
  }
}
