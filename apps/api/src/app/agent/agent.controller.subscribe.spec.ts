import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AgentController } from "./agent.controller";
import { AgentService } from "./agent.service";
import { CombinedAuthGuard } from "../guards/combined-auth.guard";

// The real guard imports better-auth (ESM) and the real service imports the
// generated Prisma client at load time; both are replaced below anyway.
jest.mock("../../lib/auth", () => ({ auth: {} }));
jest.mock("./agent.service", () => ({ AgentService: class {} }));

describe("RX-2: POST /agents/subscribe is closed", () => {
  let app: NestFastifyApplication;
  const mock = {
    subscribe: jest.fn(),
    getSubscription: jest.fn().mockResolvedValue({ subscription: null }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AgentController],
      providers: [{ provide: AgentService, useValue: mock }],
    })
      .overrideGuard(CombinedAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = { userId: "user-1" };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(["enterprise", "starter"])(
    "a signed-in user cannot obtain the %s plan without a code (404, service never called)",
    async (tier) => {
      const res = await app.inject({
        method: "POST",
        url: "/agents/subscribe",
        payload: { tier },
      });
      expect(res.statusCode).toBe(404);
      expect(mock.subscribe).not.toHaveBeenCalled();
    },
  );

  it("does not fall into another POST route (exactly 404, not 400/403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/agents/subscribe",
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /agents/subscription still works", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/agents/subscription",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ subscription: null });
    expect(mock.getSubscription).toHaveBeenCalledWith("user-1");
  });
});
