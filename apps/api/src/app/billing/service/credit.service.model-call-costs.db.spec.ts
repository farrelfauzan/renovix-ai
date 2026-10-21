import { TestingModule } from "@nestjs/testing";
import { Prisma } from "@generated/prisma/client.js";
import { CreditService } from "./credit.service";
import { CreditLedgerService } from "./credit-ledger.service";
import { CreditAccountRepository } from "../repository/credit-account.repository";
import { CreditReservationRepository } from "../repository/credit-reservation.repository";
import type { UsageRecord } from "../types/usage-record";
import { PrismaService } from "../../prisma/prisma.service";
import { TransactionService } from "../../prisma/transaction.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";

// RNX-162 AC6: a call's model_call_costs row records the wallet its usage entry was written to. No model call path
// on main draws from the weekly_free wallet yet (CreditService.reserve holds on paid only), so the free reservation is
// placed here with the repositories, as a free-wallet path would. Test database.

const credits = (value: string) => new Prisma.Decimal(value);
const COST = { servedBy: { slug: "test-model", providerName: "provider-under-test" } };

describe("RNX-162: the model call cost row's wallet (CreditService, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: CreditService;
  let userId: string;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [CreditService, CreditLedgerService] }));
    service = moduleRef.get(CreditService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    userId = (await createUser(prisma)).id;
  });

  afterAll(() => moduleRef?.close());

  const usage = (reservationId: string, callId: string, override: Partial<UsageRecord> = {}): UsageRecord => ({
    reservationId,
    memberUserId: userId,
    requestId: "req-1",
    callId,
    modelId: "test-model",
    tier: "standard",
    rates: { rateNew: credits("1"), rateCached: credits("1"), rateOut: credits("1") },
    tokens: { tokensNew: 30, tokensCached: 0, tokensOut: 10 },
    outcome: "completed",
    cost: COST,
    ...override,
  });

  /** A weekly reset of 2 credits on the free wallet and a 1-credit hold on it, as a free-wallet request would place. */
  const reserveOnFreeWallet = async () => {
    await moduleRef.get(CreditLedgerService).appendEntry({
      owner: { userId },
      wallet: "weekly_free",
      type: "weekly_reset",
      amount: credits("2"),
      memberUserId: userId,
      reference: null,
      idempotencyKey: "reset-1",
    });
    return moduleRef.get(TransactionService).run(async (tx) => {
      const accountId = await moduleRef.get(CreditAccountRepository).addHold({ userId }, "weekly_free", credits("1"), tx);
      return moduleRef.get(CreditReservationRepository).createReservation(
        { accountId: accountId!, wallet: "weekly_free", requestId: "req-free", amountHeld: credits("1"), expiresAt: new Date(Date.now() + 600_000) },
        tx,
      );
    });
  };

  it("AC6: a call from the free weekly wallet records wallet weekly_free", async () => {
    const reservation = await reserveOnFreeWallet();

    const entry = await service.recordUsage(usage(reservation.id, "call-free"));

    expect(entry.wallet).toBe("weekly_free");
    expect((await prisma.modelCallCost.findMany()).map((r) => [r.callId, r.wallet])).toEqual([["call-free", "weekly_free"]]);
  });

  it("AC6 control: a paid call records wallet paid", async () => {
    await fundPaidWallet(prisma, userId, "1");
    const reservation = await service.reserve({ userId, requestId: "req-paid", amount: credits("0.5") });

    await service.recordUsage(usage(reservation.id, "call-paid"));

    expect((await prisma.modelCallCost.findMany()).map((r) => [r.callId, r.wallet])).toEqual([["call-paid", "paid"]]);
  });

  it("a replay of the same call keeps its one row; a record without a cost source writes none", async () => {
    await fundPaidWallet(prisma, userId, "1");
    const reservation = await service.reserve({ userId, requestId: "req-paid", amount: credits("0.5") });

    await service.recordUsage(usage(reservation.id, "call-1"));
    await service.recordUsage(usage(reservation.id, "call-1"));
    await service.recordUsage(usage(reservation.id, "call-2", { cost: undefined }));

    expect((await prisma.modelCallCost.findMany()).map((r) => r.callId)).toEqual(["call-1"]);
  });
});
