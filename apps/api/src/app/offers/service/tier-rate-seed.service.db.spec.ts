import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { TierRateSeedDto } from "../dto/tier-rate-seed.dto";
import { TierRateSeedService } from "./tier-rate-seed.service";

// RX-21 (test database — needs TEST_DATABASE_URL): the tier-rate seed (prisma/tier-rates.seed.json,
// `bun run seed:tier-rates`). Idempotent: the same file twice writes nothing the second time; changed
// rates update the row and write a change record.

const SHIPPED_SEED_FILE = resolve(__dirname, "../../../../../../prisma/tier-rates.seed.json");
const readShippedSeed = (): TierRateSeedDto => TierRateSeedDto.parse(JSON.parse(readFileSync(SHIPPED_SEED_FILE, "utf8")));

describe("TierRateSeedService (RX-21, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let seeder: TierRateSeedService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [TierRateSeedService] }));
    seeder = moduleRef.get(TierRateSeedService);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => moduleRef?.close());

  const countRows = async () => ({
    rates: await prisma.tierRate.count(),
    changes: await prisma.catalogChange.count(),
  });

  it("the shipped file holds the four tiers with docs/credits.md section 1.4's values (Frontier 29/29/42, D182)", () => {
    // Column order input/cached/output (section 1.4's tables): Advanced new 5, cached 6, output 4;
    // Premium new 10, cached 20, output 11; Frontier 29/29/42 per the Tech Lead's D182 ruling
    // (R-16: Opus 5.5 ratio 29.52, break-even 29/29/42; PRD 02's 17/17/25 is on record only).
    expect(readShippedSeed().rates).toEqual([
      { tier: "standard", input: 1, cached: 1, output: 1 },
      { tier: "advanced", input: 5, cached: 6, output: 4 },
      { tier: "premium", input: 10, cached: 20, output: 11 },
      { tier: "frontier", input: 29, cached: 29, output: 42 },
    ]);
  });

  it("applying the shipped file creates the four tiers and four change records", async () => {
    await seeder.applySeed(readShippedSeed(), "test");

    expect(await countRows()).toEqual({ rates: 4, changes: 4 });
    // the file's values are stored VERBATIM: credits per 1,000,000 tokens of each kind
    // (docs/credits.md section 1) — the cost helpers divide by 1,000,000 (section 1.3).
    const standard = await prisma.tierRate.findUniqueOrThrow({ where: { tier: "standard" } });
    expect(standard.inputCreditsPerToken.toFixed(6)).toBe("1.000000");
    expect(standard.cachedCreditsPerToken.toFixed(6)).toBe("1.000000");
    expect(standard.outputCreditsPerToken.toFixed(6)).toBe("1.000000");
    const premiumChange = await prisma.catalogChange.findFirstOrThrow({ where: { entityId: "premium" } });
    expect(premiumChange).toMatchObject({ entity: "tier_rate", changedBy: "seed:test", before: null });
    expect(premiumChange.after).toMatchObject({
      inputCreditsPerToken: 10,
      cachedCreditsPerToken: 20,
      outputCreditsPerToken: 11,
    });
  });

  it("running the same file again writes nothing", async () => {
    await seeder.applySeed(readShippedSeed(), "test");
    const firstRun = await countRows();

    await seeder.applySeed(readShippedSeed(), "test");

    expect(await countRows()).toEqual(firstRun);
  });

  it("a changed rate updates the row and writes a change record with before and after", async () => {
    await seeder.applySeed(readShippedSeed(), "test");
    const changed: TierRateSeedDto = {
      ...readShippedSeed(),
      reason: "rate change",
      rates: [{ tier: "standard", input: 2, cached: 1, output: 1 }],
    };

    await seeder.applySeed(changed, "test");

    // the shipped file wrote 4 rates + 4 changes; the changed standard rate is one more change
    expect(await countRows()).toEqual({ rates: 4, changes: 5 });
    const changedRow = await prisma.tierRate.findUniqueOrThrow({ where: { tier: "standard" } });
    expect(changedRow.inputCreditsPerToken.toFixed(6)).toBe("2.000000");
    const change = await prisma.catalogChange.findFirstOrThrow({ where: { reason: "rate change" } });
    expect(change).toMatchObject({ entityId: "standard" });
    expect(change.before).toMatchObject({ inputCreditsPerToken: 1 });
    expect(change.after).toMatchObject({ inputCreditsPerToken: 2 });
  });

  it("is one transaction: an invalid tier rolls back everything the run wrote before it", async () => {
    const bad = { reason: "bad seed", rates: [{ tier: "not-a-tier", input: 1, cached: 1, output: 1 }] } as unknown as TierRateSeedDto;

    await expect(seeder.applySeed(bad, "test")).rejects.toThrow();
    expect(await countRows()).toEqual({ rates: 0, changes: 0 });
  });

  it("refuses a file with a negative rate", () => {
    expect(TierRateSeedDto.safeParse({ reason: "negative", rates: [{ tier: "standard", input: -1, cached: 1, output: 1 }] }).success).toBe(false);
  });
});
