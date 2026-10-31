import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "./prisma.service";
import { createTestModule } from "../../../test/test-module";

// RNX-186 (D190): after the migrations the old balance is gone from the database: users.balance, the transactions
// table and the subscription counters messages_used and tokens_used (RNX-251 dropped their table). The credit ledger
// is the only balance.
describe("RNX-186: the old balance is not in the schema (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({}));
  });
  afterAll(() => moduleRef?.close());

  it("has no users.balance column", async () => {
    const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users' AND column_name = 'balance'`;

    expect(columns).toEqual([]);
  });

  it("has no transactions table", async () => {
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'transactions'`;

    expect(tables).toEqual([]);
  });
});
