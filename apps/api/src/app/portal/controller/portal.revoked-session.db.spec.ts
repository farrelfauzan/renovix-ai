import { ConfigModule } from "@nestjs/config";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { LightMyRequestResponse } from "fastify";
import { PortalController } from "./portal.controller";
import { AuthModule } from "../../auth/auth.module";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { PortalTierService } from "../service/portal-tier.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProvidersModule } from "../../providers/providers.module";
import { CreditService } from "../../billing/service/credit.service";
import { UsageService } from "../../usage/service/usage.service";
import { PromptTuningService } from "../../chat/service/prompt-tuning.service";
import { ConversationService } from "../../chat/service/conversation.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { DocumentService } from "../../document/service/document.service";
import { BetterAuthTestApp, startBetterAuthApp } from "../../../../test/better-auth-app";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { blockOutbound, OutboundBlocker, sendSse, startStubHttpServer, StubHttpServer } from "../../../../test/llm-stub";
import { createResolvableModel } from "../../../../test/provider-model";

// RNX-342: the portal guard drops a revoked session at once, even while its device still holds a valid Better Auth
// cookie cache (session_data, 5 minutes). The portal guard never refuses: the revoked device is served as anonymous
// (free tier), so nothing more is spent from the user's paid wallet. Real lib/auth and better-auth on the test
// database, behind the real PortalController and AccessGuard; the provider is a local stub upstream. Made-up values.
jest.mock("better-auth", () => require("../../../../test/real-better-auth").requireNative("better-auth"));
jest.mock("better-auth/adapters/prisma", () =>
  require("../../../../test/real-better-auth").requireNative("better-auth/adapters/prisma"),
);
jest.mock("../../../lib/auth", () => require("../../../../test/real-better-auth").loadLibAuth());
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
process.env.IP_HASH_SECRET = "rnx342-test-secret";

const EMAIL = "rnx342-two-devices@renovix.test";
const PASSWORD = "rnx342-made-up-password";
const MODEL_SLUG = "rnx342-model";
/** Better Auth's session token cookie name outside production. */
const SESSION_COOKIE = "better-auth.session_token";
/** A trusted origin in test (CORS_ORIGIN unset: the local origins); Better Auth checks it on a cookie POST. */
const CHAT_ORIGIN = "http://localhost:3000";
const FUNDED_CREDITS = 5;

/** The name=value pairs of every cookie a response set: the session token and the cookie cache. */
const cookiesOf = (res: LightMyRequestResponse): string => {
  const header = res.headers["set-cookie"];
  const lines = header === undefined ? [] : Array.isArray(header) ? header : [header];
  return lines.map((line) => line.split(";")[0]).join("; ");
};

/** The session token (the part before the signature) in a cookie header. */
const sessionTokenOf = (cookie: string): string => {
  const pair = cookie.split("; ").find((part) => part.startsWith(`${SESSION_COOKIE}=`)) ?? "";
  return decodeURIComponent(pair.slice(SESSION_COOKIE.length + 1)).split(".")[0];
};

describe("RNX-342: the portal guard drops a revoked session at once (Fastify, test database)", () => {
  let upstream: StubHttpServer;
  let blocker: OutboundBlocker;
  let started: BetterAuthTestApp;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    upstream = await startStubHttpServer();
    upstream.respond((_request, res) => sendSse(res, ['{"choices":[{"delta":{"content":"ok"}}]}']));
    started = await startBetterAuthApp({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule, AuthModule],
      controllers: [PortalController],
      providers: [
        EntitlementService,
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
    });
    app = started.app;
    await started.prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await createResolvableModel(started.prisma, {
      slug: MODEL_SLUG, modelName: MODEL_SLUG, inputPrice: 0.000001, outputPrice: 0.000001, maxTokens: 8192,
      provider: { baseUrl: upstream.baseUrl, apiKey: "rnx342-not-real" },
    });
    await started.moduleRef.get(ModelRegistryService).refresh();
    blocker = blockOutbound();
  });

  afterAll(async () => {
    blocker?.restore();
    await app?.close();
    await upstream?.close();
  });

  const post = (url: string, payload: object, cookie?: string) =>
    app.inject({ method: "POST", url, payload, headers: cookie ? { cookie, origin: CHAT_ORIGIN } : {} });
  const signIn = async (): Promise<string> =>
    cookiesOf(await post("/api/auth/better/sign-in/email", { email: EMAIL, password: PASSWORD }));
  /** GET /chat/portal/usage: the tier and balance the portal guard resolved for this device. */
  const usage = async (cookie: string) =>
    (await app.inject({ method: "GET", url: "/api/chat/portal/usage", headers: { cookie } })).json();
  const chat = (cookie: string) =>
    post("/api/chat/portal/completions", { model: MODEL_SLUG, messages: [{ role: "user", content: "Hi" }] }, cookie);
  /** What the user's paid wallet shows: its balance and how many ledger entries name the user. */
  const paidWallet = async (userId: string) => ({
    balance: (await started.prisma.creditAccount.findFirstOrThrow({ where: { userId, wallet: "paid" } })).balance.toString(),
    entries: await started.prisma.creditLedgerEntry.count({ where: { memberUserId: userId } }),
  });

  it("AC1, AC2: device A revokes device B; B's next portal request is anonymous (free tier) and spends nothing from the paid wallet, A is still the paid user", async () => {
    await post("/api/auth/better/sign-up/email", { email: EMAIL, password: PASSWORD, name: "RNX-342" });
    const user = await started.prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    await fundPaidWallet(started.prisma, user.id, FUNDED_CREDITS);
    const deviceA = await signIn();
    const deviceB = await signIn();
    expect(deviceB).not.toContain("better-auth.session_data="); // RNX-379: the cookie cache is off, so sign-in sets no cache cookie
    // AC2: a session that is not revoked resolves the user and the paid tier, and its chat spends the paid wallet
    expect(await usage(deviceB)).toMatchObject({ tier: "paid", balance: "5.000000" });
    const walletAtStart = await paidWallet(user.id);
    expect((await chat(deviceB)).body).toContain("data: [DONE]");
    const walletBeforeRevoke = await paidWallet(user.id);
    expect(walletBeforeRevoke.entries).toBeGreaterThan(walletAtStart.entries);

    const revoke = await post("/api/auth/better/revoke-session", { token: sessionTokenOf(deviceB) }, deviceA);
    const usageAfterB = await usage(deviceB);
    const chatAfterB = await chat(deviceB);
    const walletAfterRevoke = await paidWallet(user.id);
    const usageAfterA = await usage(deviceA);

    expect(revoke.statusCode).toBe(200);
    expect(await started.prisma.session.count({ where: { token: sessionTokenOf(deviceB) } })).toBe(0);
    expect(usageAfterB).toMatchObject({ tier: "free" });
    expect(usageAfterB).not.toHaveProperty("balance");
    expect(chatAfterB.body).toContain("data: [DONE]");
    expect(walletAfterRevoke).toEqual(walletBeforeRevoke);
    expect(usageAfterA).toMatchObject({ tier: "paid" });
  });

  it("RNX-100 (D427): a suspended user's session that outlived the suspension is anonymous (free tier) and spends nothing from the paid wallet", async () => {
    const email = "rnx100-portal-suspended@renovix.test";
    await post("/api/auth/better/sign-up/email", { email, password: PASSWORD, name: "RNX-100" });
    const user = await started.prisma.user.findUniqueOrThrow({ where: { email } });
    await fundPaidWallet(started.prisma, user.id, FUNDED_CREDITS);
    const device = cookiesOf(await post("/api/auth/better/sign-in/email", { email, password: PASSWORD }));
    expect(await usage(device)).toMatchObject({ tier: "paid" });

    await started.prisma.user.update({ where: { id: user.id }, data: { status: "suspended" } });
    const usageWhileSuspended = await usage(device);
    const walletBefore = await paidWallet(user.id);
    const chatWhileSuspended = await chat(device);
    const walletAfter = await paidWallet(user.id);

    expect(usageWhileSuspended).toMatchObject({ tier: "free" });
    expect(usageWhileSuspended).not.toHaveProperty("balance");
    expect(chatWhileSuspended.body).toContain("data: [DONE]");
    expect(walletAfter).toEqual(walletBefore);
  });
});
