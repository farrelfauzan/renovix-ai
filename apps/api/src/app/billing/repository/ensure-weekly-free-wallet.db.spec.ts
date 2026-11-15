import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { fundWeeklyFreeWallet } from "../../../../test/fund-weekly-free-wallet";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { ensureWeeklyFreeWallet } from "./ensure-weekly-free-wallet";

// RNX-58a (test database): every signed-up user has a weekly_free wallet. `ensureWeeklyFreeWallet` is the function the
// Better Auth sign-up hook calls (apps/api/src/lib/auth.ts); the hook itself is covered by auth.better-auth.db.spec.ts.

describe("RNX-58a: ensureWeeklyFreeWallet (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({}));
  });
  beforeEach(() => resetDatabase(prisma));
  afterEach(() => assertCreditLedgerInvariants(prisma));
  afterAll(() => moduleRef?.close());

  const weeklyFreeOf = (userId: string) => prisma.creditAccount.findMany({ where: { userId, wallet: "weekly_free" } });

  it("creates the user's weekly_free wallet with balance 0, nothing held, no entry, not frozen", async () => {
    const user = await createUser(prisma);

    await ensureWeeklyFreeWallet(prisma, user.id);

    const accounts = await weeklyFreeOf(user.id);
    expect(accounts.map((a) => [a.balance.toFixed(6), a.held.toFixed(6), a.lastSeq, a.frozen])).toEqual([["0.000000", "0.000000", 0, false]]);
    expect(await prisma.creditLedgerEntry.count()).toBe(0);
    expect(await prisma.creditAccount.count({ where: { userId: user.id, wallet: "paid" } })).toBe(0);
  });

  it("is idempotent: a wallet that already exists (and has credits) is left as it is", async () => {
    const user = await createUser(prisma);
    await fundWeeklyFreeWallet(prisma, user.id, "2");

    await ensureWeeklyFreeWallet(prisma, user.id);
    await ensureWeeklyFreeWallet(prisma, user.id);

    expect((await weeklyFreeOf(user.id)).map((a) => a.balance.toFixed(6))).toEqual(["2.000000"]);
  });

  it("concurrent calls (several instances) create exactly one wallet", async () => {
    const user = await createUser(prisma);

    await Promise.all(Array.from({ length: 5 }, () => ensureWeeklyFreeWallet(prisma, user.id)));

    expect(await weeklyFreeOf(user.id)).toHaveLength(1);
  });
});
