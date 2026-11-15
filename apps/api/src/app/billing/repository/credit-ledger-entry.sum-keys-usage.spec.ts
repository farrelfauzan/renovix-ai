import { Prisma } from "@generated/prisma/client.js";
import { CreditLedgerEntryRepository } from "./credit-ledger-entry.repository";
import type { PrismaService } from "../../prisma/prisma.service";

describe("CreditLedgerEntryRepository.sumKeysUsageSince (RNX-82)", () => {
  const groupBy = jest.fn();
  const repository = new CreditLedgerEntryRepository({ creditLedgerEntry: { groupBy } } as unknown as PrismaService);

  beforeEach(() => groupBy.mockReset());

  it("groups usage entries of the given keys since the date in one query and answers positive sums", async () => {
    const inputSince = new Date("2026-10-16T10:00:00.000Z");
    groupBy.mockResolvedValue([{ apiKeyId: "key-a", _sum: { amount: new Prisma.Decimal("-3.25") } }]);

    const actualSums = await repository.sumKeysUsageSince(["key-a", "key-b"], inputSince);

    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith({
      by: ["apiKeyId"],
      where: { apiKeyId: { in: ["key-a", "key-b"] }, type: "usage", createdAt: { gte: inputSince } },
      _sum: { amount: true },
    });
    expect(actualSums.get("key-a")?.toString()).toBe("3.25");
    expect(actualSums.has("key-b")).toBe(false);
  });

  it("asks nothing for no keys", async () => {
    const actualSums = await repository.sumKeysUsageSince([], new Date());

    expect(groupBy).not.toHaveBeenCalled();
    expect(actualSums.size).toBe(0);
  });
});
