import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The fields of an invitation a response may show: never the token hash. */
const INVITATION_VIEW = {
  id: true,
  email: true,
  role: true,
  invitedByAdminId: true,
  expiresAt: true,
  usedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

/**
 * The queries on `admin_invitations` (RX-95). Every method takes the transaction as its last argument.
 * Pending = not used and not revoked; the partial unique index `admin_invitations_pending_email_key`
 * allows one pending invitation per email.
 */
@Injectable()
export class AdminInvitationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a pending invitation. 409 when the email has a pending one already, 400 for an unknown role. */
  async create(
    data: { email: string; role: string; tokenHash: string; invitedByAdminId: string; expiresAt: Date },
    tx: DbTransaction,
  ) {
    try {
      return await tx.adminInvitation.create({ data, select: INVITATION_VIEW });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("This email has a pending invitation: resend or revoke it");
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        throw new BadRequestException("Unknown role");
      }
      throw err;
    }
  }

  /** The invitation with this id, without its token hash. */
  findById(id: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).adminInvitation.findUnique({ where: { id }, select: INVITATION_VIEW });
  }

  /** The invitation whose token has this hash, with the name and email of the admin who invited. */
  findByTokenHash(tokenHash: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).adminInvitation.findUnique({
      where: { tokenHash },
      select: { ...INVITATION_VIEW, invitedBy: { select: { name: true, email: true } } },
    });
  }

  /** The pending invitations (expired ones included), oldest first, without token hashes. */
  listPending(tx?: DbTransaction) {
    return (tx ?? this.prisma).adminInvitation.findMany({
      where: { usedAt: null, revokedAt: null },
      select: INVITATION_VIEW,
      orderBy: { createdAt: "asc" },
    });
  }

  /** Marks the invitation used, if it is pending and not expired at `now` (one conditional UPDATE). Returns 0 or 1. */
  async claim(id: string, now: Date, tx: DbTransaction): Promise<number> {
    const { count } = await tx.adminInvitation.updateMany({
      where: { id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    return count;
  }

  /** Revokes the invitation, if it is pending (one conditional UPDATE). Returns 0 or 1. */
  async revokePending(id: string, now: Date, tx: DbTransaction): Promise<number> {
    const { count } = await tx.adminInvitation.updateMany({
      where: { id, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    return count;
  }
}
