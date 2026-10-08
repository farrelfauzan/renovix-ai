import { Test } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { CodesModule } from "./codes.module";
import { CodesService } from "./codes.service";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { CombinedAuthGuard } from "../guards/combined-auth.guard";

// The real guard imports better-auth (ESM) and the real PrismaService imports
// the generated Prisma client at load time; both are replaced below anyway.
jest.mock("../../lib/auth", () => ({ auth: {} }));
jest.mock("../prisma/prisma.service", () => ({ PrismaService: class {} }));

const ENTERPRISE_PLAN_ID = "3f1c2a4e-8b7d-4c1a-9e2f-1a2b3c4d5e6f";
const CODE_ID = "7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d";

const fixtureCode = () => ({
  id: CODE_ID,
  code: "PERF-PRO1-2345",
  type: "subscription",
  creditAmount: null,
  planId: "plan-pro",
  durationDays: 30,
  isActive: true,
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  timesRedeemed: 0,
  maxRedemptions: 1,
  plan: { slug: "pro" },
});

// Defaults make every old admin route succeed, so only a missing route gives 404.
const makePrisma = () => {
  const tx = {
    user: { update: jest.fn() },
    transaction: { create: jest.fn() },
    userSubscription: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    invitationCode: { update: jest.fn().mockResolvedValue({}) },
    codeRedemption: { create: jest.fn().mockResolvedValue({}) },
  };
  return {
    tx,
    subscriptionPlan: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: ENTERPRISE_PLAN_ID, slug: "enterprise" }),
    },
    invitationCode: {
      create: jest.fn().mockResolvedValue(fixtureCode()),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue(fixtureCode()),
      update: jest.fn().mockResolvedValue(fixtureCode()),
    },
    codeRedemption: { findUnique: jest.fn().mockResolvedValue(null) },
    userSubscription: { create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
};

const adminCalls = [
  {
    method: "POST" as const,
    url: "/admin/codes",
    payload: { type: "topup", creditAmount: 100 },
  },
  { method: "GET" as const, url: "/admin/codes" },
  {
    method: "PATCH" as const,
    url: `/admin/codes/${CODE_ID}`,
    payload: { isActive: false },
  },
];

describe("RX-66: /admin/codes routes are removed", () => {
  let app: NestFastifyApplication;
  let service: CodesService;
  const prisma: any = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, CodesModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideGuard(CombinedAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const userId = req.headers["x-test-user"];
          if (!userId) throw new UnauthorizedException();
          req.user = { userId };
          return true;
        },
      })
      .compile();

    service = moduleRef.get(CodesService);
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    Object.assign(prisma, makePrisma());
    jest.spyOn(service, "createCode");
    jest.spyOn(service, "listCodes");
    jest.spyOn(service, "updateCode");
  });

  afterAll(async () => {
    await app.close();
  });

  const expectNoAdminWork = () => {
    expect(service.createCode).not.toHaveBeenCalled();
    expect(service.listCodes).not.toHaveBeenCalled();
    expect(service.updateCode).not.toHaveBeenCalled();
    expect(prisma.invitationCode.create).not.toHaveBeenCalled();
    expect(prisma.invitationCode.findMany).not.toHaveBeenCalled();
    expect(prisma.invitationCode.update).not.toHaveBeenCalled();
  };

  it.each(adminCalls)(
    "AC1: $method $url without a session is 401 or 404",
    async (call) => {
      const res = await app.inject(call);
      expect([401, 404]).toContain(res.statusCode);
      expectNoAdminWork();
    },
  );

  it.each(adminCalls)(
    "AC2: $method $url as a signed-in user is 404 and does nothing",
    async (call) => {
      const res = await app.inject({
        ...call,
        headers: { "x-test-user": "user-1" },
      });
      expect(res.statusCode).toBe(404);
      expectNoAdminWork();
    },
  );

  it("AC3: a signed-in user cannot mint an Enterprise code and redeem it", async () => {
    const headers = { "x-test-user": "user-1" };
    const create = await app.inject({
      method: "POST",
      url: "/admin/codes",
      headers,
      payload: {
        type: "subscription",
        planId: ENTERPRISE_PLAN_ID,
        durationDays: 30,
        code: "PERF-FREE-ENT1",
      },
    });
    expect(create.statusCode).toBe(404);
    expectNoAdminWork();

    prisma.invitationCode.findUnique.mockResolvedValue(null);
    const redeem = await app.inject({
      method: "POST",
      url: "/codes/redeem",
      headers,
      payload: { code: "PERF-FREE-ENT1" },
    });
    expect(redeem.statusCode).toBe(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.userSubscription.create).not.toHaveBeenCalled();
    expect(prisma.userSubscription.update).not.toHaveBeenCalled();
    expect(prisma.tx.userSubscription.create).not.toHaveBeenCalled();
    expect(prisma.tx.userSubscription.update).not.toHaveBeenCalled();
  });

  it("AC4: a valid code is still redeemable at POST /codes/redeem", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/codes/redeem",
      headers: { "x-test-user": "user-1" },
      payload: { code: "perf-pro1-2345" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      success: true,
      creditsGranted: null,
      planGranted: "pro",
      daysGranted: 30,
    });
    expect(prisma.invitationCode.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: "PERF-PRO1-2345" } }),
    );
    expect(prisma.tx.userSubscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        planId: "plan-pro",
        status: "active",
      }),
    });
  });
});
