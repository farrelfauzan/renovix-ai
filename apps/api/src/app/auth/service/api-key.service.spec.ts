import { Prisma } from "@generated/prisma/client.js";
import { ApiKeyService } from "./api-key.service";
import type { ApiKeyRepository } from "../repository/api-key.repository";
import type { CreditLedgerEntryRepository } from "../../billing/repository/credit-ledger-entry.repository";

const NOW = new Date("2026-11-15T10:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const buildKey = (id: string) => ({
  id,
  name: id,
  prefix: id,
  createdAt: NOW,
  lastUsedAt: null,
  revokedAt: null,
  expiresAt: null,
  allowedTiers: ["basic"],
  monthlyCreditCap: null,
});

describe("ApiKeyService.list (RNX-82: credits in the last 30 days)", () => {
  const listKeys = jest.fn();
  const sumKeysUsageSince = jest.fn();
  const service = new ApiKeyService(
    { listKeys } as unknown as ApiKeyRepository,
    {} as never,
    { sumKeysUsageSince } as unknown as CreditLedgerEntryRepository,
  );

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    listKeys.mockReset();
    sumKeysUsageSince.mockReset();
  });

  afterEach(() => jest.useRealTimers());

  it("adds each key's spent credits from one grouped query, 0 for a key without usage", async () => {
    const inputUserId = "user-1";
    listKeys.mockResolvedValue([buildKey("key-a"), buildKey("key-b")]);
    sumKeysUsageSince.mockResolvedValue(new Map([["key-a", new Prisma.Decimal("12.5")]]));

    const actualKeys = await service.list(inputUserId);

    expect(actualKeys.map((key) => [key.id, key.creditsLast30Days])).toEqual([["key-a", "12.5"], ["key-b", "0"]]);
    expect(sumKeysUsageSince).toHaveBeenCalledTimes(1);
  });

  it("counts only the ids of the caller's own keys (another user's key is never asked for)", async () => {
    listKeys.mockResolvedValue([buildKey("mine-1"), buildKey("mine-2")]);
    sumKeysUsageSince.mockResolvedValue(new Map());

    await service.list("user-1");

    expect(listKeys).toHaveBeenCalledWith("user-1");
    expect(sumKeysUsageSince.mock.calls[0][0]).toEqual(["mine-1", "mine-2"]);
  });

  it("counts usage since exactly 30 days ago, so older usage is excluded", async () => {
    listKeys.mockResolvedValue([buildKey("key-a")]);
    sumKeysUsageSince.mockResolvedValue(new Map());

    await service.list("user-1");

    expect(sumKeysUsageSince.mock.calls[0][1]).toEqual(new Date(NOW.getTime() - 30 * DAY_MS));
  });
});
