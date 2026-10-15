import { BadRequestException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { CatalogChangeRepository } from "../repository/catalog-change.repository";
import { PlatformSettingsService } from "./platform-settings.service";

// RX-86: typed platform settings on the test database. Every write is validated by the registry's Zod schema
// and writes its change record in the same transaction; a refused write leaves no row and no change record.

const AUTHOR = { changedBy: "admin-test", reason: "test change" };

describe("PlatformSettingsService (RX-86, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let settings: PlatformSettingsService;
  let changes: CatalogChangeRepository;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [PlatformSettingsService] }));
    settings = moduleRef.get(PlatformSettingsService);
    changes = moduleRef.get(CatalogChangeRepository);
  });

  beforeEach(() => resetDatabase(prisma));

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  it("saves a valid value, reads it back typed, and records who, why, when and the value after", async () => {
    await settings.saveSetting({ name: "weeklyFreeAllowanceCredits", value: 2, author: AUTHOR });
    expect(await settings.getSetting("weeklyFreeAllowanceCredits")).toBe(2);
    const actual = await prisma.catalogChange.findMany();
    expect(actual).toHaveLength(1);
    expect(actual[0]).toMatchObject({ entity: "platform_setting", entityId: "weeklyFreeAllowanceCredits", changedBy: "admin-test", reason: "test change", before: null, after: 2 });
    expect(actual[0].effectiveFrom).toEqual(actual[0].createdAt);
  });

  it("a setting without a row reads as null", async () => {
    expect(await settings.getSetting("demoRunsPerIpPerDay")).toBeNull();
  });

  it("a changed value records before and after; writing the same value again records nothing", async () => {
    await settings.saveSetting({ name: "seatCeiling", value: 100, author: AUTHOR });
    await settings.saveSetting({ name: "seatCeiling", value: 120, author: AUTHOR });
    await settings.saveSetting({ name: "seatCeiling", value: 120, author: AUTHOR });
    const actual = await prisma.catalogChange.findMany({ orderBy: { createdAt: "asc" } });
    expect(actual.map((c) => [c.before, c.after])).toEqual([
      [null, 100],
      [100, 120],
    ]);
    expect(await settings.getSetting("seatCeiling")).toBe(120);
  });

  it.each([
    ["a negative weekly allowance", "weeklyFreeAllowanceCredits", -1],
    ["a non-integer where an integer is required", "seatCeiling", 100.5],
    ["a threshold of 0 where at least 1 is required", "runOutAmberDays", 0],
    ["a per-run cap of 0 credits", "perRunCreditCap", 0],
    ["text instead of a number", "weeklyFreeAllowanceCredits", "2"],
    ["an unknown setting name", "freeCreditsForEveryone", 1],
  ])("AC2: refuses %s and writes nothing (no row, no change record)", async (_case, inputName, inputValue) => {
    await expect(settings.saveSetting({ name: inputName, value: inputValue, author: AUTHOR })).rejects.toThrow(BadRequestException);
    expect(await prisma.platformSetting.count()).toBe(0);
    expect(await prisma.catalogChange.count()).toBe(0);
  });

  it("AC2: an invalid value does not replace a set value", async () => {
    await settings.saveSetting({ name: "weeklyFreeAllowanceCredits", value: 2, author: AUTHOR });
    await expect(settings.saveSetting({ name: "weeklyFreeAllowanceCredits", value: -2, author: AUTHOR })).rejects.toThrow(BadRequestException);
    expect(await settings.getSetting("weeklyFreeAllowanceCredits")).toBe(2);
    expect(await prisma.catalogChange.count()).toBe(1);
  });

  it("rolls the setting back when its change record cannot be written", async () => {
    jest.spyOn(changes, "create").mockRejectedValueOnce(new Error("change record insert failed"));
    await expect(settings.saveSetting({ name: "seatCeiling", value: 100, author: AUTHOR })).rejects.toThrow("change record insert failed");
    expect(await prisma.platformSetting.count()).toBe(0);
  });
});
