import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { CodesModule } from "../codes.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";

// CombinedAuthGuard runs for real (session path); better-auth is ESM-only, so its
// session lookup is a mock: "no session", except for a cookie of test/as-session-user.ts.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

describe("GET /codes/history (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ imports: [CodesModule] }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const redeemed = async (userId: string, code: string) => {
    const created = await prisma.invitationCode.create({
      data: { code, type: "subscription", durationDays: 30 },
    });
    await prisma.codeRedemption.create({
      data: { codeId: created.id, userId, planGranted: "pro", daysGranted: 30 },
    });
  };

  it("returns only the signed-in user's redemptions", async () => {
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    await redeemed(alice.id, "PERF-ALIC-0001");
    await redeemed(bob.id, "PERF-BOBB-0001");
    const session = asSessionUser(alice);

    const res = await app.inject({
      method: "GET",
      url: "/codes/history",
      headers: session,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().redemptions).toEqual([
      expect.objectContaining({
        userId: alice.id,
        planGranted: "pro",
        code: { code: "PERF-ALIC-0001", type: "subscription" },
      }),
    ]);
  });

  it.each([
    ["no token", {}],
    ["a token signed with another secret", { authorization: `Bearer ${jwt.sign({ userId: "x" }, "wrong")}` }],
    // RNX-225: a login JWT signed with JWT_SECRET is no credential any more.
    ["a login JWT", { authorization: `Bearer ${jwt.sign({ userId: "x", email: "x@test.local" }, process.env.JWT_SECRET!)}` }],
  ])("is 401 with %s", async (_case, headers: Record<string, string>) => {
    const res = await app.inject({ method: "GET", url: "/codes/history", headers });

    expect(res.statusCode).toBe(401);
  });
});
