import { BadRequestException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import type { CreateCompanyContractDto } from "../dto/create-company-contract.dto";
import { CompanyContractService } from "./company-contract.service";
import { OfferCatalogService } from "./offer-catalog.service";
import { PlatformSettingsService } from "./platform-settings.service";

// RX-86: Enterprise company contracts on the test database. The seat limit may not exceed the seat ceiling
// setting (D7); the fields of the open decisions D1, D2, D18 and D27 have no defaults and may be null.

const AUTHOR = { changedBy: "admin-test", reason: "test change" };
// The test's own ceiling; the decided value (D7) lives only in prisma/offers.seed.json.
const TEST_SEAT_CEILING = 50;

describe("CompanyContractService (RX-86, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let contracts: CompanyContractService;
  let inputContract: CreateCompanyContractDto;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [CompanyContractService, PlatformSettingsService, OfferCatalogService] }));
    contracts = moduleRef.get(CompanyContractService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const catalog = moduleRef.get(OfferCatalogService);
    const bundle = await catalog.saveEnterpriseBundle({ name: "Example bundle", active: true }, AUTHOR);
    const version = await catalog.saveEnterpriseBundleVersion({ ownerId: bundle.id, terms: { poolCreditsPerPeriod: null, monthlyPriceRupiah: null }, author: AUTHOR });
    inputContract = {
      companyId: "company-example",
      bundleVersionId: version.id,
      seatLimit: TEST_SEAT_CEILING,
      defaultMemberShareCredits: null,
      allowedTiers: ["standard", "advanced", "premium", "frontier"],
      graceDays: null,
      whatsappEnabled: false,
      capPolicy: null,
      topUpRoles: null,
    };
  });

  afterAll(() => moduleRef?.close());

  const setCeiling = () => moduleRef.get(PlatformSettingsService).saveSetting({ name: "seatCeiling", value: TEST_SEAT_CEILING, author: AUTHOR });

  it("creates a contract at the seat ceiling with the undecided fields (D2, D18, D27) and the bundle amounts (D1) null, and records the change", async () => {
    await setCeiling();
    const actual = await contracts.createContract({ contract: inputContract, author: AUTHOR });
    expect(await prisma.companyContract.findUniqueOrThrow({ where: { id: actual.id } })).toMatchObject({ seatLimit: TEST_SEAT_CEILING, graceDays: null, capPolicy: null, topUpRoles: null, defaultMemberShareCredits: null });
    expect(await prisma.enterpriseBundleVersion.findFirstOrThrow()).toMatchObject({ poolCreditsPerPeriod: null, monthlyPriceRupiah: null });
    expect(await prisma.catalogChange.count({ where: { entity: "company_contract", entityId: actual.id } })).toBe(1);
  });

  it("refuses a seat limit above the seat ceiling setting and writes nothing", async () => {
    await setCeiling();
    const changesBefore = await prisma.catalogChange.count();
    await expect(contracts.createContract({ contract: { ...inputContract, seatLimit: TEST_SEAT_CEILING + 1 }, author: AUTHOR })).rejects.toThrow(BadRequestException);
    expect(await prisma.companyContract.count()).toBe(0);
    expect(await prisma.catalogChange.count()).toBe(changesBefore);
  });

  it("refuses a contract while the seat ceiling is not set", async () => {
    await expect(contracts.createContract({ contract: inputContract, author: AUTHOR })).rejects.toThrow("seatCeiling setting is not set");
    expect(await prisma.companyContract.count()).toBe(0);
  });

  it("refuses a contract that leaves out an undecided field: it must be given, even as null (no default)", async () => {
    await setCeiling();
    const { graceDays: _left, ...withoutGraceDays } = inputContract;
    await expect(contracts.createContract({ contract: withoutGraceDays as CreateCompanyContractDto, author: AUTHOR })).rejects.toThrow(BadRequestException);
    expect(await prisma.companyContract.count()).toBe(0);
  });

  it("the columns of the open decisions have no default in the database", async () => {
    const actual = await prisma.$queryRaw<{ column: string; fallback: string | null; nullable: string }[]>`
      SELECT table_name || '.' || column_name AS column, column_default AS fallback, is_nullable AS nullable
      FROM information_schema.columns
      WHERE (table_name, column_name) IN (('company_contracts', 'grace_days'), ('company_contracts', 'cap_policy'),
        ('company_contracts', 'top_up_roles'), ('enterprise_bundle_versions', 'pool_credits_per_period'),
        ('enterprise_bundle_versions', 'monthly_price_rupiah'))
      ORDER BY 1`;
    expect(actual).toEqual([
      { column: "company_contracts.cap_policy", fallback: null, nullable: "YES" },
      { column: "company_contracts.grace_days", fallback: null, nullable: "YES" },
      { column: "company_contracts.top_up_roles", fallback: null, nullable: "YES" },
      { column: "enterprise_bundle_versions.monthly_price_rupiah", fallback: null, nullable: "YES" },
      { column: "enterprise_bundle_versions.pool_credits_per_period", fallback: null, nullable: "YES" },
    ]);
  });
});
