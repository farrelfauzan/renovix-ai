import { Decimal } from "@prisma/client/runtime/client";
import type { TestingModule } from "@nestjs/testing";
import { BillingService } from "./billing.service";
import { CreditLedgerService } from "./credit-ledger.service";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import type { PrismaService } from "../../prisma/prisma.service";

// RX-14: characterization tests of BillingService. RNX-186 removed the old reservation SQL on User.balance and the
// Transaction rows it wrote (reserveCredits, adjustBalance, refundReservation, getBalance) with its tests; what is
// left is addBalance, the Stripe top-up's ledger write.

describe("RX-14: BillingService top-up on the credit ledger (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: BillingService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [BillingService, CreditLedgerService] }));
    service = moduleRef.get(BillingService);
  });
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => moduleRef?.close());

  describe("addBalance", () => {
    // RX-22 (D190, D202-1): a top-up is one top_up entry on the credit ledger.
    it("addBalance writes one top_up ledger entry with the reference; a replay writes nothing", async () => {
      const user = await createUser(prisma);

      await service.addBalance(user.id, new Decimal("2.0"), "ref-1");
      await service.addBalance(user.id, new Decimal("2.0"), "ref-1");

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
      const user = await createUser(prisma);

      await service.addBalance(user.id, new Decimal("0"), "ref-zero");

      expect(await prisma.creditLedgerEntry.count({ where: { memberUserId: user.id } })).toBe(0);
      expect(await prisma.creditAccount.count({ where: { userId: user.id } })).toBe(0);
    });
  });
});
