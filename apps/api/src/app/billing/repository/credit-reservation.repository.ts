import { Injectable } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import type { CreditReservation, CreditReservationStatus } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries on `credit_reservations` (RX-22, docs/credits.md section 3). A reservation's status and consumed credits
 * change only while its account row is locked, so the methods that change them take the transaction, required.
 */
@Injectable()
export class CreditReservationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Inserts an open reservation. */
  createReservation(data: Prisma.CreditReservationUncheckedCreateInput, tx: DbTransaction): Promise<CreditReservation> {
    return tx.creditReservation.create({ data });
  }

  /**
   * RNX-58a: the parts of the hold with this id, in the order they are charged and locked: the reservation itself (the
   * weekly_free part of a two-wallet hold), then its paid part when it has one (through the partOfId index). Throws
   * when there is no reservation with this id.
   */
  async findParts(id: string, tx?: DbTransaction): Promise<CreditReservation[]> {
    const { parts, ...reservation } = await (tx ?? this.prisma).creditReservation.findUniqueOrThrow({
      where: { id },
      include: { parts: true },
    });
    return [reservation, ...parts];
  }

  /**
   * RNX-232: what this API key's open reservations still hold (amountHeld - consumed, summed; 0 without any), through
   * the (apiKeyId, status) index.
   */
  async sumOpenKeyHolds(apiKeyId: string, tx?: DbTransaction): Promise<Prisma.Decimal> {
    const { _sum } = await (tx ?? this.prisma).creditReservation.aggregate({
      where: { apiKeyId, status: "open" },
      _sum: { amountHeld: true, consumed: true },
    });
    return (_sum.amountHeld ?? new Prisma.Decimal(0)).minus(_sum.consumed ?? 0);
  }

  /** Adds `amount` to the credits charged against the hold of an open reservation (I4 keeps it at most amountHeld). */
  async addConsumed(id: string, amount: Prisma.Decimal, tx: DbTransaction): Promise<void> {
    await tx.creditReservation.update({ where: { id }, data: { consumed: { increment: amount } } });
  }

  /**
   * Closes the reservation in one conditional update, only while it is open: sets `status` (settled, released or
   * expired) and returns its remaining hold (amountHeld - consumed). Null when it was not open any more (already
   * closed, for example by a concurrent sweep): nothing is changed.
   */
  async closeReservation(id: string, status: CreditReservationStatus, tx: DbTransaction): Promise<Prisma.Decimal | null> {
    const rows = await tx.$queryRaw<{ remaining: Prisma.Decimal }[]>`
      UPDATE "credit_reservations" SET "status" = ${status}::"CreditReservationStatus", "updated_at" = now()
      WHERE "id" = ${id} AND "status" = 'open'
      RETURNING "amount_held" - "consumed" AS "remaining"`;
    return rows[0] ? new Prisma.Decimal(rows[0].remaining) : null;
  }

  /** Up to `limit` open reservations whose expiresAt is before `now`, oldest first, through the (status, expiresAt) index. */
  findExpiredOpenReservations(now: Date, limit: number, tx?: DbTransaction): Promise<Pick<CreditReservation, "id" | "accountId">[]> {
    return (tx ?? this.prisma).creditReservation.findMany({
      where: { status: "open", expiresAt: { lt: now } },
      orderBy: { expiresAt: "asc" },
      take: limit,
      select: { id: true, accountId: true },
    });
  }
}
