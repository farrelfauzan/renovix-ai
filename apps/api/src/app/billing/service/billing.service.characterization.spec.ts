import { BadRequestException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { Prisma } from "@generated/prisma/client.js";
import type { TestingModule } from "@nestjs/testing";
import { BillingService } from "./billing.service";
import { CreditLedgerService } from "./credit-ledger.service";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import type { PrismaService } from "../../prisma/prisma.service";

// RX-14: characterization tests. These pin TODAY's behaviour of the credit
// reservation SQL and the ledger rows it writes, so the rewrite (RX-19/20/22)
// shows as a diff. Surprises are recorded on the ticket, not fixed here.
// `users.balance` and `transactions.amount` are numeric(12,6): every Decimal
// the service passes to $executeRaw is rounded to 6 decimal places by
// Postgres on the way in, and the pending row's amount is rounded the same
// way when the ledger row is created.

describe("RX-14: BillingService credit reservation and ledger (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: BillingService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [BillingService, CreditLedgerService] }));
    service = moduleRef.get(BillingService);
  });
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => moduleRef?.close());

  const userWithBalance = (balance: string) =>
    createUser(prisma, { balance: new Decimal(balance) });

  const balanceOf = async (userId: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } })).balance;

  const rows = (userId: string) =>
    prisma.transaction.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

  describe("reserveCredits", () => {
    it("reserves from balance 1.0: returns the amount, balance 0.5, one pending deduction row of -0.5", async () => {
      const user = await userWithBalance("1.0");

      const reserved = await service.reserveCredits(user.id, new Decimal("0.5"));

      expect(reserved.toFixed(6)).toBe("0.500000");
      expect((await balanceOf(user.id)).toFixed(6)).toBe("0.500000");
      const ledger = await rows(user.id);
      expect(ledger).toHaveLength(1);
      expect(ledger[0].amount.toFixed(6)).toBe("-0.500000");
      expect(ledger[0].type).toBe("deduction");
      expect(ledger[0].status).toBe("pending");
    });

    it("reserves exactly the whole balance (balance >= cost is inclusive): balance 0, still one pending row", async () => {
      const user = await userWithBalance("1.0");

      await service.reserveCredits(user.id, new Decimal("1.0"));

      expect((await balanceOf(user.id)).toFixed(6)).toBe("0.000000");
      expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(1);
    });

    it("refuses a larger amount: BadRequestException, balance unchanged, NO ledger row (the UPDATE throws before the write)", async () => {
      const user = await userWithBalance("0.1");

      await expect(service.reserveCredits(user.id, new Decimal("0.5"))).rejects.toThrow(
        new BadRequestException("Insufficient balance"),
      );

      expect((await balanceOf(user.id)).toFixed(6)).toBe("0.100000");
      expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(0);
    });

    it("refuses when the balance is 0: same refusal, no ledger row", async () => {
      const user = await userWithBalance("0");

      await expect(service.reserveCredits(user.id, new Decimal("0.5"))).rejects.toThrow(
        new BadRequestException("Insufficient balance"),
      );

      expect((await balanceOf(user.id)).toFixed(6)).toBe("0.000000");
      expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(0);
    });
  });

  describe("adjustBalance (never touches the pending row: it writes a NEW success row)", () => {
    it("actual cheaper than the estimate (1.0 -0.5 reserved, actual 0.3): balance 0.7, success row -0.3, pending row STAYS pending", async () => {
      const user = await userWithBalance("1.0");
      await service.reserveCredits(user.id, new Decimal("0.5"));

      await service.adjustBalance(user.id, new Decimal("0.5"), new Decimal("0.3"));

      expect((await balanceOf(user.id)).toFixed(6)).toBe("0.700000");
      const ledger = await rows(user.id);
      expect(ledger).toHaveLength(2);
      // the reservation row is untouched: still pending, still -0.5
      expect(ledger[0].status).toBe("pending");
      expect(ledger[0].amount.toFixed(6)).toBe("-0.500000");
      // a NEW success row carries the actual cost
      expect(ledger[1].status).toBe("success");
      expect(ledger[1].amount.toFixed(6)).toBe("-0.300000");
      expect(ledger[1].type).toBe("deduction");
    });

    it("actual dearer than the estimate (estimate 0.3, actual 0.5): balance loses the extra 0.2, success row -0.5", async () => {
      const user = await userWithBalance("1.0");
      await service.reserveCredits(user.id, new Decimal("0.3"));

      await service.adjustBalance(user.id, new Decimal("0.3"), new Decimal("0.5"));

      expect((await balanceOf(user.id)).toFixed(6)).toBe("0.500000");
      const ledger = await rows(user.id);
      expect(ledger).toHaveLength(2);
      expect(ledger[1].status).toBe("success");
      expect(ledger[1].amount.toFixed(6)).toBe("-0.500000");
    });

    it("actual equal to the estimate: no balance change, success row with -actual", async () => {
      const user = await userWithBalance("1.0");
      await service.reserveCredits(user.id, new Decimal("0.4"));

      await service.adjustBalance(user.id, new Decimal("0.4"), new Decimal("0.4"));

      expect((await balanceOf(user.id)).toFixed(6)).toBe("0.600000");
      const ledger = await rows(user.id);
      expect(ledger).toHaveLength(2);
      expect(ledger[1].status).toBe("success");
      expect(ledger[1].amount.toFixed(6)).toBe("-0.400000");
    });
  });

  describe("refundReservation and addBalance", () => {
    it("refundReservation restores the balance and writes a positive refund/success row", async () => {
      const user = await userWithBalance("1.0");

      await service.refundReservation(user.id, new Decimal("0.25"));

      expect((await balanceOf(user.id)).toFixed(6)).toBe("1.250000");
      const ledger = await rows(user.id);
      expect(ledger).toHaveLength(1);
      expect(ledger[0].type).toBe("refund");
      expect(ledger[0].status).toBe("success");
      expect(ledger[0].amount.toFixed(6)).toBe("0.250000");
    });

    // RX-22 (D190, D202-1): a top-up is one top_up entry on the credit ledger; User.balance and the Transaction
    // table are no longer written. Was: balance 2.000000 and one topup/success Transaction row with the reference.
    it("addBalance writes one top_up ledger entry with the reference; User.balance and transactions untouched; a replay writes nothing", async () => {
      const user = await userWithBalance("0");

      await service.addBalance(user.id, new Decimal("2.0"), "ref-1");
      await service.addBalance(user.id, new Decimal("2.0"), "ref-1");

      expect((await balanceOf(user.id)).toFixed(6)).toBe("0.000000");
      expect(await rows(user.id)).toHaveLength(0);
      const entries = await prisma.creditLedgerEntry.findMany({ where: { memberUserId: user.id } });
      expect(entries.map((e) => [e.type, e.amount.toFixed(6), e.reference, e.idempotencyKey])).toEqual([
        ["top_up", "2.000000", "ref-1", "top_up:ref-1"],
      ]);
      const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId: user.id, wallet: "paid" } } });
      expect(account.balance.toFixed(6)).toBe("2.000000");
      await assertCreditLedgerInvariants(prisma);
    });

    // D186: a grant of 0 credits writes no ledger entry (the sign CHECK refuses amount 0 for top_up).
    it("addBalance with 0 credits writes no entry and no account", async () => {
      const user = await userWithBalance("0");

      await service.addBalance(user.id, new Decimal("0"), "ref-zero");

      expect(await prisma.creditLedgerEntry.count({ where: { memberUserId: user.id } })).toBe(0);
      expect(await prisma.creditAccount.count({ where: { userId: user.id } })).toBe(0);
    });
  });

  describe("concurrent reservations against one balance (the atomic UPDATE is the only guard)", () => {
    it("balance 1.0, five concurrent reserves of 0.3: exactly 3 win, 2 refused, balance 0.1, never negative, 3 pending rows", async () => {
      const user = await userWithBalance("1.0");

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => service.reserveCredits(user.id, new Decimal("0.3"))),
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(3);
      expect(rejected).toHaveLength(2);
      for (const r of rejected) {
        expect(r.reason).toBeInstanceOf(BadRequestException);
        expect(r.reason.message).toBe("Insufficient balance");
      }
      const balance = await balanceOf(user.id);
      expect(balance.toFixed(6)).toBe("0.100000");
      expect(balance.greaterThanOrEqualTo(0)).toBe(true);
      expect(await prisma.transaction.count({ where: { userId: user.id, status: "pending" } })).toBe(3);
    });

    it("tighter race: balance 0.6, six concurrent reserves of 0.1 (an exact fit) all win, balance 0.0", async () => {
      const user = await userWithBalance("0.6");

      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => service.reserveCredits(user.id, new Decimal("0.1"))),
      );

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(6);
      const balance = await balanceOf(user.id);
      expect(balance.toFixed(6)).toBe("0.000000");
      expect(balance.greaterThanOrEqualTo(0)).toBe(true);
      expect(await prisma.transaction.count({ where: { userId: user.id, status: "pending" } })).toBe(6);
    });
  });

  describe("RED CONTROL (the ticket's AC: the assertions above fail when the guard is broken)", () => {
    // The probe plants the fault RX-19/20/22 must not reintroduce: a
    // reservation UPDATE without the `AND balance >= cost` guard. It is a
    // subclass whose reserveCredits runs the same writes with the guard
    // dropped from the WHERE clause (nothing else differs: same ledger row,
    // same return value). Like the probe in app.module.access.spec.ts, it
    // stays in the committed spec and needs no production change to run.
    class GuardlessBillingService extends BillingService {
      constructor(private readonly db: PrismaService) {
        super(db, {} as CreditLedgerService);
      }

      override async reserveCredits(userId: string, estimatedCost: Decimal): Promise<Decimal> {
        await this.db.$executeRaw(
          Prisma.sql`UPDATE "users" SET balance = balance - ${estimatedCost} WHERE id = ${userId}`,
        );
        await this.db.transaction.create({
          data: {
            userId,
            amount: estimatedCost.negated(),
            type: "deduction",
            status: "pending",
            reference: null,
          },
        });
        return estimatedCost;
      }
    }

    it("without the guard the insufficient-balance case does NOT throw and the balance goes negative — the pinned assertions catch exactly this", async () => {
      const broken = new GuardlessBillingService(prisma);
      const user = await userWithBalance("0.1");

      // today's code throws here; the broken code does not. The probe asserts
      // the difference, so a green suite means the guard is what makes the
      // pinned behaviour hold (and any regression flips this probe red).
      const outcome = await broken
        .reserveCredits(user.id, new Decimal("0.5"))
        .then(() => "resolved", (e: unknown) => e);
      expect(outcome).toBe("resolved"); // the fault: no refusal

      const balance = await balanceOf(user.id);
      expect(balance.toFixed(6)).toBe("-0.400000"); // the fault: negative balance
      expect(balance.greaterThanOrEqualTo(0)).toBe(false); // the pinned assertion "balance >= 0" fails on this code

      // and the real service still refuses the same call: the guard is present
      const user2 = await userWithBalance("0.1");
      await expect(service.reserveCredits(user2.id, new Decimal("0.5"))).rejects.toThrow(
        new BadRequestException("Insufficient balance"),
      );
    });
  });
});
