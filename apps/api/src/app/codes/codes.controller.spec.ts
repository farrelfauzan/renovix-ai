import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { CodesModule } from "./codes.module";
import { PrismaService } from "../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createPlan, createUser } from "../../../test/factories";

// CombinedAuthGuard runs for real (JWT path); better-auth is ESM-only, so its
// session lookup is replaced by "no session".
jest.mock("../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

process.env.JWT_SECRET = "rx8-test-jwt-secret";

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

  const redeemed = async (userId: string, code: string, planId: string) => {
    const created = await prisma.invitationCode.create({
      data: { code, type: "subscription", planId, durationDays: 30 },
    });
    await prisma.codeRedemption.create({
      data: { codeId: created.id, userId, planGranted: "pro", daysGranted: 30 },
    });
  };

  it("returns only the signed-in user's redemptions", async () => {
    const plan = await createPlan(prisma, { slug: "pro" });
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    await redeemed(alice.id, "PERF-ALIC-0001", plan.id);
    await redeemed(bob.id, "PERF-BOBB-0001", plan.id);
    const token = jwt.sign({ userId: alice.id, email: alice.email }, process.env.JWT_SECRET!);

    const res = await app.inject({
      method: "GET",
      url: "/codes/history",
      headers: { authorization: `Bearer ${token}` },
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
  ])("is 401 with %s", async (_case, headers: Record<string, string>) => {
    const res = await app.inject({ method: "GET", url: "/codes/history", headers });

    expect(res.statusCode).toBe(401);
  });
});
