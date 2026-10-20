import { Injectable } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import type { DbTransaction } from "./db-transaction";
import { PrismaService } from "./prisma.service";
import { TransactionService } from "./transaction.service";
import { UserRepository } from "../auth/repository/user.repository";
import { createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createUser } from "../../../test/factories";

/** A second repository for this spec only: the codes module has the one real repository so far. */
@Injectable()
class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a user; an email that exists already fails with P2002. */
  createUser(email: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).user.create({ data: { email } });
  }
}

describe("TransactionService.run (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let transactions: TransactionService;
  let codes: UserRepository;
  let users: UsersRepository;
  let userId: string;

  const apiKey = async () => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).apiKey;
  const emails = async () =>
    (await prisma.user.findMany({ orderBy: { email: "asc" } })).map((u) => u.email);
  const isolationLevel = async (tx: DbTransaction) =>
    (await tx.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`)[0]
      .transaction_isolation;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [UsersRepository] }));
    transactions = moduleRef.get(TransactionService);
    codes = moduleRef.get(UserRepository);
    users = moduleRef.get(UsersRepository);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    userId = (await createUser(prisma, { email: "taken@test.local", apiKey: "sk_live_before" })).id;
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  it("two repositories called inside run, the second call throws: the first call's write is rolled back", async () => {
    const run = transactions.run(async (tx) => {
      await codes.updateApiKey(userId, "sk_live_after", tx);
      await users.createUser("taken@test.local", tx); // duplicate email
    });

    await expect(run).rejects.toMatchObject({ code: "P2002" });
    expect(await apiKey()).toBe("sk_live_before");
    expect(await emails()).toEqual(["taken@test.local"]);
  });

  it("commits the writes of both repositories when the work succeeds, and returns its result", async () => {
    const result = await transactions.run(async (tx) => {
      await codes.updateApiKey(userId, "sk_live_after", tx);
      return (await users.createUser("new@test.local", tx)).email;
    });

    expect(result).toBe("new@test.local");
    expect(await apiKey()).toBe("sk_live_after");
    expect(await emails()).toEqual(["new@test.local", "taken@test.local"]);
  });

  it("with a transaction passed in, runs the work on that transaction and opens nothing: a later failure of the outer work rolls the inner write back", async () => {
    const open = jest.spyOn(prisma, "$transaction");
    let isSameTransaction = false; // compared here: a failed matcher cannot print a transaction of this client

    const run = transactions.run(async (tx) => {
      const email = await transactions.run(
        async (inner) => {
          isSameTransaction = inner === tx;
          return (await users.createUser("inner@test.local", inner)).email;
        },
        undefined,
        tx,
      );
      throw new Error(`outer work fails after the inner run returned ${email}`);
    });

    await expect(run).rejects.toThrow("outer work fails after the inner run returned inner@test.local");
    expect(await emails()).toEqual(["taken@test.local"]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(isSameTransaction).toBe(true);
  });

  it("refuses options when it joins an open transaction, and runs no work", async () => {
    const work = jest.fn();

    const run = transactions.run(
      (tx) => transactions.run(work, { isolationLevel: "Serializable" }, tx),
    );

    await expect(run).rejects.toThrow(/options cannot be applied when joining an open transaction/);
    expect(work).not.toHaveBeenCalled();
  });

  it("applies the options when it opens the transaction", async () => {
    const byDefault = await transactions.run(isolationLevel);
    const asked = await transactions.run(isolationLevel, { isolationLevel: "Serializable" });

    expect(byDefault).toBe("read committed");
    expect(asked).toBe("serializable");
  });
});
