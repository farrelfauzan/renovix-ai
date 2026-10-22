import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { LightMyRequestResponse } from "fastify";
import * as jwt from "jsonwebtoken";
import { PortalController } from "./portal.controller";
import { PortalTierService } from "../service/portal-tier.service";
import { PrismaService } from "../../prisma/prisma.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProvidersModule } from "../../providers/providers.module";
import { CreditService } from "../../billing/service/credit.service";
import { UsageService } from "../../usage/service/usage.service";
import { PromptTuningService } from "../../chat/service/prompt-tuning.service";
import { ConversationService } from "../../chat/service/conversation.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { DocumentService } from "../../document/service/document.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { blockOutbound, OutboundBlocker, sendSse, startStubHttpServer, StubHttpServer } from "../../../../test/llm-stub";
import { createResolvableModel } from "../../../../test/provider-model";
import { asSessionUser } from "../../../../test/as-session-user";
import { captureOutput } from "../../../../test/capture-output";
import { createAppLogger } from "../../../common/utils/create-app-logger";

// RNX-225: the portal session is the httpOnly `portal_session` cookie, which PortalGuard sets when a request has none
// (on the JSON replies and on the SSE completions, which write their own headers with res.raw.writeHead); the
// X-Portal-Session header is the fallback. A login JWT is never a portal user: a stale one is an anonymous free-tier
// caller. The real portal route (Fastify, test database) and the real provider adapter against a local stub upstream;
// blockOutbound keeps every other host off the network. Made-up values only.
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
process.env.IP_HASH_SECRET = "rnx225-test-secret";

const CHEAP_SLUG = "rnx225-cheap";
const OTHER_SLUG = "rnx225-other";
const API_KEY = "rnx225-not-real";
const HEADER_SESSION = "22522522-2252-4225-8225-225225225225";
const COOKIE_SESSION = "22522522-2252-4225-8225-225225225226";
const NEW_COOKIE = /^portal_session=([0-9a-f-]{36}); Path=\/; HttpOnly; SameSite=Lax; Max-Age=31536000$/;

/** The portal_session Set-Cookie line of a response, if any. */
const portalCookie = (res: LightMyRequestResponse): string | undefined => {
  const header = res.headers["set-cookie"];
  const lines = header === undefined ? [] : Array.isArray(header) ? header : [String(header)];
  return lines.find((line) => line.startsWith("portal_session="));
};

describe("RNX-225: the portal_session cookie and no login JWT on the portal (Fastify, test database)", () => {
  let upstream: StubHttpServer;
  let blocker: OutboundBlocker;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    upstream = await startStubHttpServer();
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
      controllers: [PortalController],
      providers: [
        PortalTierService,
        CreditService,
        ModelRegistryService,
        {
          provide: PromptTuningService,
          useValue: { applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }) },
        },
        { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
        { provide: UsageService, useValue: { logUsage: async () => undefined } },
        {
          provide: ConversationService,
          useValue: { getOrCreateConversation: async () => "conversation-id", saveMessages: async () => undefined, generateTitle: async () => undefined },
        },
        { provide: KnowledgeService, useValue: { listKnowledgeBases: async () => [] } },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
    app.useLogger(createAppLogger({ NODE_ENV: "production" }));
  });

  beforeEach(async () => {
    blocker = blockOutbound();
    upstream.requests.length = 0;
    upstream.respond((_r, res) => sendSse(res, ['{"choices":[{"delta":{"content":"ok"}}]}']));
    await resetDatabase(prisma);
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    // the free tier picks the cheapest standard model; a paid caller sees both
    for (const [slug, price] of [[CHEAP_SLUG, 0.000001], [OTHER_SLUG, 0.00001]] as const) {
      await createResolvableModel(prisma, {
        slug, modelName: slug, inputPrice: price, outputPrice: price, maxTokens: 8192,
        provider: { baseUrl: upstream.baseUrl, apiKey: API_KEY },
      });
    }
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => blocker.restore());

  afterAll(async () => {
    await app?.close();
    await upstream?.close();
  });

  const chat = (headers: Record<string, string>) =>
    app.inject({ method: "POST", url: "/chat/portal/completions", headers, payload: { messages: [{ role: "user", content: "Hi" }] } });
  const get = (url: string, headers: Record<string, string>) => app.inject({ method: "GET", url, headers });

  describe("AC4: the portal_session cookie", () => {
    it("a JSON reply (GET /chat/portal/models) without a portal session: 200 and a new httpOnly portal_session cookie", async () => {
      const res = await get("/chat/portal/models", {});

      expect(res.statusCode).toBe(200);
      expect(portalCookie(res)).toMatch(NEW_COOKIE);
    });

    it("an SSE completion without a portal session: the event stream carries the new cookie, and the free-tier session is that id", async () => {
      const res = await chat({});

      expect([res.statusCode, res.headers["content-type"]]).toEqual([200, "text/event-stream"]);
      expect(res.body).toContain("data: [DONE]");
      const sessionId = NEW_COOKIE.exec(portalCookie(res) ?? "")?.[1];
      expect(sessionId).toBeDefined();
      expect((await prisma.portalSession.findMany()).map((row) => row.sessionToken)).toEqual([sessionId]);
    });

    it("the cookie sent back: its session is used, no new cookie", async () => {
      const res = await chat({ cookie: `portal_session=${COOKIE_SESSION}` });

      expect(res.headers["content-type"]).toBe("text/event-stream");
      expect(portalCookie(res)).toBeUndefined();
      expect((await prisma.portalSession.findMany()).map((row) => row.sessionToken)).toEqual([COOKIE_SESSION]);
    });

    it("only the X-Portal-Session header (fallback): accepted, its session is used, no new cookie", async () => {
      const res = await chat({ "x-portal-session": HEADER_SESSION });

      expect([res.statusCode, res.headers["content-type"]]).toEqual([200, "text/event-stream"]);
      expect(portalCookie(res)).toBeUndefined();
      expect((await prisma.portalSession.findMany()).map((row) => row.sessionToken)).toEqual([HEADER_SESSION]);
    });
  });

  describe("AC5: no portal_session value reaches the output (production AppLogger, stdout, stderr, console)", () => {
    /**
     * A new session on a JSON reply and on an SSE completion, the cookie sent back, and the header fallback, all
     * while the output is captured; `plant` runs inside the capture with the session values (the control). Returns
     * the session values and the captured lines that hold one.
     */
    const runCaptured = async (plant: (sessionIds: string[]) => void = () => undefined) => {
      const output = captureOutput();
      try {
        const models = await get("/chat/portal/models", {});
        const completion = await chat({});
        await chat({ cookie: `portal_session=${COOKIE_SESSION}` });
        await chat({ "x-portal-session": HEADER_SESSION });
        await get("/chat/portal/usage", { cookie: `portal_session=${COOKIE_SESSION}` });
        const created = [models, completion].map((res) => NEW_COOKIE.exec(portalCookie(res) ?? "")?.[1] ?? "");
        const sessionIds = [...created, COOKIE_SESSION, HEADER_SESSION];
        plant(sessionIds);
        return { sessionIds, leaked: output.lines.filter((line) => sessionIds.some((id) => line.includes(id))) };
      } finally {
        jest.restoreAllMocks();
      }
    };

    it("no line printed during the portal requests holds a portal_session value", async () => {
      const { sessionIds, leaked } = await runCaptured();

      expect(sessionIds.every((id) => id.length === 36)).toBe(true);
      expect(leaked).toEqual([]);
    });

    it("control: a planted console.log(portal_session) is caught", async () => {
      const { leaked } = await runCaptured((sessionIds) => console.log(`portal ${sessionIds[0]}`));

      expect(leaked).toHaveLength(1);
    });
  });

  describe("AC1: a login JWT of a funded user is an anonymous free-tier caller", () => {
    const fundedUser = async () => {
      const user = await createUser(prisma);
      await fundPaidWallet(prisma, user.id, 5);
      return user;
    };
    /** A login JWT as POST /auth/login issued them before RNX-225 (the app's JWT_SECRET). */
    const staleJwt = (user: { id: string; email: string }) => ({
      "x-portal-session": HEADER_SESSION,
      authorization: `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!)}`,
    });
    const ledgerEntries = (userId: string) => prisma.creditLedgerEntry.count({ where: { memberUserId: userId } });

    it("completions: the free path (cheapest model), no reservation, no ledger entry for the user", async () => {
      const user = await fundedUser();
      const entriesBefore = await ledgerEntries(user.id);

      const res = await chat(staleJwt(user));

      expect(res.body).toContain("data: [DONE]");
      expect(upstream.requests.map((request) => request.body.model)).toEqual([CHEAP_SLUG]);
      expect(await prisma.creditReservation.count()).toBe(0);
      expect(await ledgerEntries(user.id)).toBe(entriesBefore);
      expect((await prisma.portalSession.findMany()).map((row) => row.sessionToken)).toEqual([HEADER_SESSION]);
    });

    it("usage: the free tier, not the user's balance", async () => {
      const user = await fundedUser();

      const res = await get("/chat/portal/usage", staleJwt(user));

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ tier: "free" });
      expect(res.json()).not.toHaveProperty("balance", "5.000000");
    });

    it("models: only the free model, without prices", async () => {
      const user = await fundedUser();

      const res = await get("/chat/portal/models", staleJwt(user));

      expect(res.json()).toEqual({ models: [{ slug: CHEAP_SLUG, name: CHEAP_SLUG }] });
    });

    it("control: the same user's session cookie is the paid user (both models, paid usage, a ledger entry for the chat)", async () => {
      const user = await fundedUser();
      const signedIn = { "x-portal-session": HEADER_SESSION, ...asSessionUser(user) };
      const entriesBefore = await ledgerEntries(user.id);

      const models = await get("/chat/portal/models", signedIn);
      const usage = await get("/chat/portal/usage", signedIn);
      const res = await app.inject({
        method: "POST",
        url: "/chat/portal/completions",
        headers: signedIn,
        payload: { model: CHEAP_SLUG, messages: [{ role: "user", content: "Hi" }] },
      });

      expect(models.json().models.map((model: { slug: string }) => model.slug).sort()).toEqual([CHEAP_SLUG, OTHER_SLUG].sort());
      expect(usage.json()).toMatchObject({ tier: "paid", balance: "5.000000" });
      expect(res.body).toContain("data: [DONE]");
      expect(await ledgerEntries(user.id)).toBeGreaterThan(entriesBefore);
    });
  });
});
