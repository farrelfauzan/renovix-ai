import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "./prisma.service";
import { createTestModule } from "../../../test/test-module";

// RNX-186 (D190): after the migrations the old balance is gone from the database: users.balance, the transactions
// table and the user_subscriptions counters messages_used and tokens_used. The credit ledger is the only balance.
describe("RNX-186: the old balance is not in the schema (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({}));
  });
  afterAll(() => moduleRef?.close());

  it("has no users.balance, user_subscriptions.messages_used or user_subscriptions.tokens_used column", async () => {
    const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'users' AND column_name = 'balance')
          OR (table_name = 'user_subscriptions' AND column_name IN ('messages_used', 'tokens_used')))`;

    expect(columns).toEqual([]);
  });

  it("has no transactions table", async () => {
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'transactions'`;

    expect(tables).toEqual([]);
  });
});
