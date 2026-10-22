import { TestingModule } from "@nestjs/testing";
import { Prisma } from "@generated/prisma/client.js";
import { CreditService } from "./credit.service";
import { CreditsExhaustedException } from "../errors/credits-exhausted.exception";
import { CreditLedgerEntryRepository } from "../repository/credit-ledger-entry.repository";
import type { UsageRecord } from "../types/usage-record";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createApiKey, createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";

const credits = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

/**
 * RNX-232 review round 1 (the Reviewer's probe): the monthly cap of a key must hold when a usage entry of the same key
 * commits between the cap check's two sums. `recordUsage` writes the entry and raises the reservation's `consumed`
 * in one transaction without the key lock, so read in the wrong order such a call is counted in neither sum.
 */
describe("CreditService.reserve: the key's monthly cap against a concurrent recordUsage (RNX-232, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: CreditService;
  let userId: string;
  let apiKeyId: string;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [CreditService] }));
    service = moduleRef.get(CreditService);
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    userId = (await createUser(prisma)).id;
    await fundPaidWallet(prisma, userId, "10");
    await createApiKey(prisma, userId, { monthlyCreditCap: "0.5" });
    apiKeyId = (await prisma.apiKey.findFirstOrThrow({ where: { userId } })).id;
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => moduleRef?.close());

  /** 300,000 new + 100,000 out tokens at rate 1: the call charges 0.4 credits. */
  const buildUsage = (reservationId: string): UsageRecord => ({
    reservationId,
    memberUserId: userId,
    requestId: "req-a",
    callId: "call-a",
    modelId: "test-model",
    tier: "standard",
    rates: { rateNew: credits("1"), rateCached: credits("1"), rateOut: credits("1") },
    tokens: { tokensNew: 300_000, tokensCached: 0, tokensOut: 100_000 },
    outcome: "completed",
    apiKeyId,
  });

  it("control: with A's 0.6 hold open and no interleaving, B is refused (0.6 >= the 0.5 cap)", async () => {
    await service.reserve({ userId, requestId: "req-a", amount: credits("0.6"), apiKeyId });

    const actual = service.reserve({ userId, requestId: "req-b", amount: credits("0.1"), apiKeyId });

    await expect(actual).rejects.toBeInstanceOf(CreditsExhaustedException);
  });

  it("A's 0.4 usage committed during B's cap check: B is still refused (0.4 used + 0.2 held >= the 0.5 cap)", async () => {
    const reservationA = await service.reserve({ userId, requestId: "req-a", amount: credits("0.6"), apiKeyId });
    const entries = moduleRef.get(CreditLedgerEntryRepository);
    const sumKeyUsageSince = entries.sumKeyUsageSince.bind(entries);
    jest.spyOn(entries, "sumKeyUsageSince").mockImplementationOnce(async (...args: Parameters<typeof sumKeyUsageSince>) => {
      const sum = await sumKeyUsageSince(...args);
      await service.recordUsage(buildUsage(reservationA.id));
      return sum;
    });

    const actualOutcome = await service
      .reserve({ userId, requestId: "req-b", amount: credits("0.1"), apiKeyId })
      .then(
        () => "reserved",
        (err: unknown) => (err instanceof CreditsExhaustedException ? "refused" : String(err)),
      );

    expect(actualOutcome).toBe("refused");
  });
});
