import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { PortalController } from "./portal.controller";
import { PortalTierService } from "./portal-tier.service";
import { PortalGuard } from "./portal.guard";
import { PrismaService } from "../prisma/prisma.service";
import { ModelRegistryService } from "../config/model-registry.service";
import { ProvidersModule } from "../providers/providers.module";
import { BillingService } from "../billing/billing.service";
import { UsageService } from "../usage/usage.service";
import { PromptTuningService } from "../chat/prompt-tuning.service";
import { ConversationService } from "../chat/conversation.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { GuardrailService } from "../guardrail/guardrail.service";
import { DocumentService } from "../document/document.service";
import { createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import {
  FakeProviderAdapter,
  withFakeProvider,
} from "../../../test/fake-provider";

// PortalGuard imports better-auth (ESM-only); anonymous requests never reach it.
jest.mock("../../lib/auth", () => ({
  auth: { api: { getSession: async () => null } },
}));
// Services the free path does not use (or that are stubbed below) load ESM-only
// packages (marked, ...); replace their modules with empty classes.
jest.mock("../billing/billing.service", () => ({ BillingService: class {} }));
jest.mock("../usage/usage.service", () => ({ UsageService: class {} }));
jest.mock("../chat/prompt-tuning.service", () => ({
  PromptTuningService: class {},
}));
jest.mock("../chat/conversation.service", () => ({
  ConversationService: class {},
}));
jest.mock("../knowledge/knowledge.service", () => ({
  KnowledgeService: class {},
}));
jest.mock("../guardrail/guardrail.service", () => ({
  GuardrailService: class {},
}));
jest.mock("../document/document.service", () => ({
  DocumentService: class {},
}));

process.env.IP_HASH_SECRET = "rx10-test-secret";
process.env.ANON_DAILY_IP_CAP = "2";
delete process.env.CLIENT_IP_HEADER;
delete process.env.ANON_DAILY_GLOBAL_CAP;

describe("RX-10: POST /chat/portal/completions free tier (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  const fake = new FakeProviderAdapter();
  const origin = "https://chat.renovix.test";
  const ip = "203.0.113.9";

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [
          ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
          JwtModule.register({ secret: "rx10-test-jwt" }),
          ProvidersModule,
        ],
        controllers: [PortalController],
        providers: [
          PortalTierService,
          PortalGuard,
          ModelRegistryService,
          {
            provide: PromptTuningService,
            useValue: {
              applyTuning: async (messages: unknown) => ({
                tunedMessages: messages,
                matchedTemplate: null,
              }),
            },
          },
          {
            provide: GuardrailService,
            useValue: { checkInput: async () => ({ blocked: false }) },
          },
          { provide: BillingService, useValue: {} },
          { provide: UsageService, useValue: {} },
          { provide: ConversationService, useValue: {} },
          { provide: KnowledgeService, useValue: {} },
          { provide: DocumentService, useValue: {} },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    // Same CORS setup as main.ts (credentials, reflected allowed origin)
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.enableCors({ origin: true, credentials: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const model = (slug: string, tier: string, price: string) => ({
      slug,
      modelName: slug,
      providerId: `vendor/${slug}`,
      inputPrice: price,
      outputPrice: price,
      maxTokens: 8192,
      tier,
    });
    await prisma.aiModel.createMany({
      data: [
        model("cheap-premium", "premium", "0.0000001"),
        model("standard-cheap", "standard", "0.000001"),
        model("standard-dear", "standard", "0.00001"),
      ],
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(() => app?.close());

  const complete = (session: string, headers: Record<string, string> = {}) =>
    app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      remoteAddress: ip,
      headers: { origin, "x-portal-session": session, ...headers },
      payload: { messages: [{ role: "user", content: "Hi" }] },
    });

  it("uses the cheapest standard-tier model, then answers 429 free_limit_reached at the per-IP cap", async () => {
    fake.enqueue({ content: "Hello one" }, { content: "Hello two" });

    // New session UUIDs and forged forwarding headers do not change the counted IP
    const first = await complete("11111111-1111-4111-8111-111111111111", {
      "x-forwarded-for": "1.1.1.1",
    });
    const second = await complete("22222222-2222-4222-8222-222222222222", {
      "x-client-ip": "2.2.2.2",
    });
    const third = await complete("33333333-3333-4333-8333-333333333333", {
      "x-forwarded-for": "3.3.3.3",
      "x-client-ip": "3.3.3.3",
    });

    expect(first.statusCode).toBe(200);
    expect(first.body).toContain('"content":"one"');
    expect(first.body).toContain("data: [DONE]");
    expect(second.statusCode).toBe(200);
    expect(fake.requests.map((r) => r.model)).toEqual([
      "standard-cheap",
      "standard-cheap",
    ]);

    expect(third.statusCode).toBe(429);
    expect(third.headers["access-control-allow-origin"]).toBe(origin);
    expect(third.json()).toEqual({
      error: {
        code: "free_limit_reached",
        message:
          "You've reached today's free chat limit. It resets at 00:00 WIB. Sign in with a package or an invitation code to keep chatting.",
        type: "rate_limit_error",
      },
    });

    const sessions = await prisma.portalSession.findMany();
    const counters = await prisma.anonymousUsageCounter.findMany();
    expect(new Set(sessions.map((s) => s.ipAddress)).size).toBe(1);
    expect(counters.map((c) => [c.bucket.slice(0, 3), c.count]).sort()).toEqual(
      [
        ["glo", 2],
        ["ip:", 2],
      ],
    );
    expect(JSON.stringify([sessions, counters])).not.toContain(ip);
  });

  it("GET /chat/portal/models offers the free tier only the cheapest standard model", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/chat/portal/models",
      headers: { "x-portal-session": "44444444-4444-4444-8444-444444444444" },
    });

    expect(res.json()).toEqual({
      models: [{ slug: "standard-cheap", name: "standard-cheap" }],
    });
  });
});
