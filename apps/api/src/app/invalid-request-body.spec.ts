import { createHmac } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, TestingModule } from "@nestjs/testing";
import { GlobalExceptionFilter } from "../common/filters/global-exception.filter";
import { createFastifyAdapter } from "../common/utils/create-fastify-adapter";
import { ROUTE_BODY_SCHEMAS } from "../common/utils/route-body-schemas";
import { AdminAdminsController } from "./admin-auth/controller/admin-admins.controller";
import { AdminAuthController } from "./admin-auth/controller/admin-auth.controller";
import { AdminInvitationsController } from "./admin-auth/controller/admin-invitations.controller";
import { AdminRolesController } from "./admin-auth/controller/admin-roles.controller";
import { AdminCodesController } from "./admin-catalog/controller/admin-codes.controller";
import { AdminEnterpriseBundlesController } from "./admin-catalog/controller/admin-enterprise-bundles.controller";
import { AdminPackagesController } from "./admin-catalog/controller/admin-packages.controller";
import { AdminSettingsController } from "./admin-catalog/controller/admin-settings.controller";
import { AdminTopUpPacksController } from "./admin-catalog/controller/admin-top-up-packs.controller";
import { AdminCreditsController } from "./admin-credits/controller/admin-credits.controller";
import { AdminReconciliationController } from "./admin-usage/controller/admin-reconciliation.controller";
import { AdminUsageController } from "./admin-usage/controller/admin-usage.controller";
import { AdminProviderModelsController } from "./admin-providers/controller/admin-provider-models.controller";
import { AdminProvidersController } from "./admin-providers/controller/admin-providers.controller";
import { AgentLinkController } from "./agent/controller/agent-link.controller";
import { AgentRunController } from "./agent/controller/agent-run.controller";
import { AgentController } from "./agent/controller/agent.controller";
import { AgentService } from "./agent/service/agent.service";
import { ApiKeyController } from "./auth/controller/api-key.controller";
import { AuthController } from "./auth/controller/auth.controller";
import { BillingController } from "./billing/controller/billing.controller";
import { ChannelController } from "./channel/controller/channel.controller";
import { GowaWebhookController } from "./channel/controller/gowa.webhook.controller";
import { GowaService } from "./channel/service/gowa.service";
import { ChatController } from "./chat/controller/chat.controller";
import { CodesController } from "./codes/controller/codes.controller";
import { DocumentController } from "./document/controller/document.controller";
import { KnowledgeController } from "./knowledge/controller/knowledge.controller";
import { KnowledgeService } from "./knowledge/service/knowledge.service";
import { McpUserController } from "./mcp/controller/mcp-user.controller";
import { WebSearchController } from "./mcp/controller/web-search.controller";
import { WebSearchService } from "./mcp/service/web-search.service";
import { AdminPaymentsController } from "./payments/controller/admin-payments.controller";
import { PaymentsController } from "./payments/controller/payments.controller";
import { PortalController } from "./portal/controller/portal.controller";
import { PrismaService } from "./prisma/prisma.service";
import { ReminderController } from "./reminder/controller/reminder.controller";
import { WorkspaceChannelController } from "./workspace/controller/workspace-channel.controller";
import { WorkspaceInviteController } from "./workspace/controller/workspace-invite.controller";
import { WorkspaceController } from "./workspace/controller/workspace.controller";
import { WorkspaceKnowledgeService } from "./workspace/service/workspace-knowledge.service";

// RNX-28 (D237): every route that takes a request body answers an invalid body with the one 400 shape,
// { error: { message: "Invalid request body", type: "invalid_request_error", details } }, built by
// createInvalidBodyException. Every controller with a body is mounted on Fastify with the global exception
// filter, as in AppModule; every service is an automatic mock (no database), and a test guard stands in
// for the sign-in (req.user, req.portalIdentity). Made-up values only.
// The real Better Auth instance and the document converters (marked is ESM only) are not loaded.
jest.mock("../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
jest.mock("./document/service/document.service", () => ({ DocumentService: class {} }));
// Stripe is never called: the checkout session is a stub.
const mockCreateCheckoutSession = jest.fn(async () => ({ url: "https://checkout.example.test/session" }));
jest.mock("stripe", () => ({ __esModule: true, default: class { checkout = { sessions: { create: mockCreateCheckoutSession } }; } }));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const ID = "00000000-0000-4000-8000-000000000002";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000003";
const GOWA_SECRET = "made-up-gowa-webhook-secret";
const NOT_AN_OBJECT = "not an object";

/** An automatic mock for a service no test looks into: every property is another one, and calling one resolves to undefined. */
function createDeepMock(): unknown {
  const children = new Map<PropertyKey, unknown>();
  const target = jest.fn(async () => undefined);
  return new Proxy(target, {
    get(fn, property) {
      if (property === "then") return undefined;
      if (property in fn) return Reflect.get(fn, property);
      if (!children.has(property)) children.set(property, createDeepMock());
      return children.get(property);
    },
  });
}

/** Stands in for the sign-in: a signed-in product user who is also a paid portal user with credits. */
@Injectable()
class SignedInTestGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.user = { userId: USER_ID, email: "user@example.test" };
    req.portalIdentity = { tier: "paid", user: { id: USER_ID, balance: 10 } };
    return true;
  }
}

type Row = {
  readonly route: string;
  readonly body: unknown;
  readonly details?: readonly string[];
};

// One row per route with a body: (route, invalid body) → 400 in the one shape. A body that is not an
// object fails every schema; the routes that had an `any`, inline-typed or unparsed body (and the public
// API, auth and billing) also get an invalid field, named in `details`.
const ROWS: readonly Row[] = [
  // ─── public API ───
  { route: "POST /chat/completions", body: { model: "m", messages: "hello" }, details: ["messages"] },
  { route: "POST /chat/portal/completions", body: { messages: 1 }, details: ["messages"] },
  { route: "POST /export", body: { markdown: 1, format: "pdf" }, details: ["markdown"] },
  // ─── auth ───
  { route: "POST /auth/register", body: { email: "not-an-email" }, details: ["email", "password"] },
  { route: "POST /auth/login", body: { email: 1 }, details: ["email", "password"] },
  { route: "PATCH /auth/me", body: NOT_AN_OBJECT },
  { route: "POST /auth/keys", body: NOT_AN_OBJECT },
  // ─── billing ───
  { route: "POST /billing/checkout", body: { amount: "10" }, details: ["amount"] },
  // ─── formerly `any`, inline-typed or unparsed ───
  { route: "PUT /integrations/web-search/brave/key", body: { workspaceId: WORKSPACE_ID }, details: ["apiKey"] },
  { route: "PUT /integrations/web-search/providers/:provider/key", body: { apiKey: "k" }, details: ["workspaceId"] },
  { route: "PUT /integrations/web-search/policy", body: { workspaceId: WORKSPACE_ID, maxResults: "5" }, details: ["maxResults"] },
  { route: "POST /channels/:channelId/workspace/knowledge", body: { description: "d" }, details: ["name"] },
  { route: "POST /channels/:channelId/workspace/knowledge/:kbId/chunks", body: { chunks: "text" }, details: ["chunks"] },
  { route: "POST /channels/:channelId/workspace/knowledge/search", body: { topK: 3 }, details: ["query"] },
  { route: "POST /agents/generate-prompt", body: { name: "" }, details: ["name"] },
  { route: "PATCH /agents/:id/status", body: { status: "deleted" }, details: ["status"] },
  { route: "PATCH /agents/:id/channels/:channelId", body: NOT_AN_OBJECT },
  { route: "POST /chat/portal/knowledge", body: { name: "   " }, details: ["name"] },
  { route: "POST /webhooks/gowa", body: { event: "message.received", to: "628111000111" }, details: ["from", "message"] },
  // ─── back office (/admin) ───
  { route: "POST /admin/auth/sign-in", body: NOT_AN_OBJECT },
  { route: "POST /admin/auth/totp/confirm", body: NOT_AN_OBJECT },
  { route: "POST /admin/auth/reauth", body: NOT_AN_OBJECT },
  { route: "POST /admin/auth/password", body: NOT_AN_OBJECT },
  { route: "POST /admin/invitations", body: NOT_AN_OBJECT },
  { route: "POST /admin/invitations/preview", body: NOT_AN_OBJECT },
  { route: "POST /admin/invitations/accept", body: NOT_AN_OBJECT },
  { route: "PUT /admin/admins/:id/role", body: NOT_AN_OBJECT },
  { route: "POST /admin/roles", body: NOT_AN_OBJECT },
  { route: "PATCH /admin/roles/:name", body: NOT_AN_OBJECT },
  { route: "POST /admin/providers", body: NOT_AN_OBJECT },
  { route: "PATCH /admin/providers/:id", body: NOT_AN_OBJECT },
  { route: "POST /admin/providers/:id/test", body: NOT_AN_OBJECT },
  { route: "POST /admin/providers/:providerId/models", body: NOT_AN_OBJECT },
  { route: "PATCH /admin/providers/:providerId/models/:modelId", body: NOT_AN_OBJECT },
  { route: "POST /admin/credits/adjustments", body: NOT_AN_OBJECT },
  { route: "PATCH /admin/packages/:id", body: NOT_AN_OBJECT },
  { route: "POST /admin/packages/:id/versions", body: NOT_AN_OBJECT },
  { route: "PATCH /admin/top-up-packs/:id", body: NOT_AN_OBJECT },
  { route: "POST /admin/top-up-packs/:id/versions", body: NOT_AN_OBJECT },
  { route: "PATCH /admin/enterprise-bundles/:id", body: NOT_AN_OBJECT },
  { route: "POST /admin/enterprise-bundles/:id/versions", body: NOT_AN_OBJECT },
  { route: "POST /admin/codes", body: NOT_AN_OBJECT },
  { route: "PATCH /admin/codes/:id", body: NOT_AN_OBJECT },
  { route: "PUT /admin/settings/:name", body: NOT_AN_OBJECT },
  { route: "POST /admin/usage/users/:userId/email", body: NOT_AN_OBJECT },
  { route: "POST /admin/reconciliation/entries", body: { day: "2026-10-20", portalBalanceUsd: "10" }, details: ["providerId"] },
  { route: "POST /admin/payments/orders/:id/confirm", body: { reason: "" }, details: ["reason"] },
  { route: "POST /admin/payments/unmatched/:id/refunded", body: NOT_AN_OBJECT },
  // ─── the rest of the product API ───
  { route: "POST /agents", body: NOT_AN_OBJECT },
  { route: "POST /agents/clone/:templateId", body: NOT_AN_OBJECT },
  { route: "PATCH /agents/:id", body: NOT_AN_OBJECT },
  { route: "POST /agents/:id/tools", body: NOT_AN_OBJECT },
  { route: "POST /agents/:id/integrations", body: NOT_AN_OBJECT },
  { route: "POST /agents/:id/knowledge-bases", body: NOT_AN_OBJECT },
  { route: "POST /agents/:id/channels", body: NOT_AN_OBJECT },
  { route: "POST /agents/:id/chat", body: NOT_AN_OBJECT },
  { route: "POST /agents/:id/links", body: NOT_AN_OBJECT },
  { route: "POST /channels", body: NOT_AN_OBJECT },
  { route: "PATCH /channels/:id", body: NOT_AN_OBJECT },
  { route: "POST /channels/:id/agents", body: NOT_AN_OBJECT },
  { route: "POST /channels/:id/agents/:agentId/chat", body: NOT_AN_OBJECT },
  { route: "PATCH /channels/:channelId/workspace/members/:memberId", body: { role: "owner" }, details: ["role"] },
  { route: "POST /channels/:channelId/workspace/invites", body: NOT_AN_OBJECT },
  { route: "POST /workspaces", body: NOT_AN_OBJECT },
  { route: "PATCH /workspaces/:id", body: NOT_AN_OBJECT },
  { route: "PATCH /workspaces/:id/members/:memberId", body: NOT_AN_OBJECT },
  { route: "POST /workspaces/:id/invites", body: NOT_AN_OBJECT },
  { route: "POST /workspace-invites/accept", body: NOT_AN_OBJECT },
  { route: "POST /codes/redeem", body: NOT_AN_OBJECT },
  { route: "POST /payments/checkout", body: { offer: "top_up_pack", packageId: "p" }, details: ["packId"] },
  { route: "POST /mcp/user/connect", body: NOT_AN_OBJECT },
  { route: "POST /v1/knowledge/bases", body: NOT_AN_OBJECT },
  { route: "PUT /v1/knowledge/bases/:id", body: NOT_AN_OBJECT },
  { route: "POST /v1/knowledge/bases/:id/chunks", body: NOT_AN_OBJECT },
  { route: "POST /v1/knowledge/search", body: NOT_AN_OBJECT },
  { route: "POST /reminders", body: NOT_AN_OBJECT },
  { route: "PATCH /reminders/:id", body: NOT_AN_OBJECT },
];

/** `METHOD /path/:param` → the method and a URL with every parameter filled in (`:provider` with the one that has a key). */
function toRequest(route: string): { method: "POST" | "PUT" | "PATCH"; url: string } {
  const [method, path] = route.split(" ");
  const url = path.replace(/:(\w+)/g, (_match, name: string) => (name === "provider" ? "brave-search" : ID));
  return { method: method as "POST" | "PUT" | "PATCH", url };
}

/** The GOWA signature header for a raw body (the webhook checks it before it reads the body). */
function signGowa(raw: string): Record<string, string> {
  return { "x-hub-signature-256": `sha256=${createHmac("sha256", GOWA_SECRET).update(raw).digest("hex")}` };
}

describe("RNX-28: one 400 shape for an invalid request body on every route (Fastify, no database)", () => {
  let moduleRef: TestingModule;
  let app: NestFastifyApplication;
  // The services the valid-body cases look into. The caller owns the channel of the workspace routes; the GOWA
  // number has a channel with a webhook secret.
  const webSearch = { updatePolicy: jest.fn(), upsertBraveApiKey: jest.fn() };
  const agents = { updateStatus: jest.fn(), generatePrompt: jest.fn(), updateChannel: jest.fn() };
  const workspaceKnowledge = { searchWorkspaceKnowledge: jest.fn() };
  const knowledge = { createKnowledgeBase: jest.fn() };
  const prisma = { channel: { findUnique: jest.fn(async () => ({ userId: USER_ID, workspace: { id: WORKSPACE_ID, ownerId: USER_ID } })) } };
  const gowa = { findWhatsappChannels: jest.fn(async () => [{ agent: {}, channel: { config: { webhookSecret: GOWA_SECRET } } }]) };

  const send = (route: string, body: unknown) => {
    const raw = JSON.stringify(body);
    const signature = route === "POST /webhooks/gowa" ? signGowa(raw) : {};
    return app.inject({ ...toRequest(route), headers: { "content-type": "application/json", ...signature }, payload: raw });
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [
        AdminAdminsController, AdminAuthController, AdminInvitationsController, AdminRolesController,
        AdminCodesController, AdminEnterpriseBundlesController, AdminPackagesController, AdminSettingsController,
        AdminTopUpPacksController, AdminCreditsController, AdminProviderModelsController, AdminProvidersController,
        AdminUsageController, AdminReconciliationController,
        AgentLinkController, AgentRunController, AgentController, ApiKeyController, AuthController, BillingController,
        ChannelController, GowaWebhookController, ChatController, CodesController, DocumentController,
        KnowledgeController, McpUserController, WebSearchController, PortalController, ReminderController,
        WorkspaceChannelController, WorkspaceInviteController, WorkspaceController,
        AdminPaymentsController, PaymentsController,
      ],
      providers: [
        { provide: APP_GUARD, useClass: SignedInTestGuard },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        // Billing reaches the body only with Stripe on (a made-up key; the SDK is a stub).
        { provide: ConfigService, useValue: { get: (key: string) => ({ STRIPE_SECRET_KEY: "sk_test_made_up", STRIPE_ENABLED: "true" })[key] } },
        { provide: WebSearchService, useValue: webSearch },
        { provide: AgentService, useValue: agents },
        { provide: WorkspaceKnowledgeService, useValue: workspaceKnowledge },
        { provide: KnowledgeService, useValue: knowledge },
        { provide: PrismaService, useValue: prisma },
        { provide: GowaService, useValue: gowa },
      ],
    })
      // A pipe's optional options (ParseUUIDPipe, typed Object) stay undefined; everything else is mocked.
      .useMocker((token) => (token === Object ? undefined : createDeepMock()))
      .compile();
    // rawBody as in main.ts, so the webhook gets the bytes that were signed.
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(), { rawBody: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(() => app?.close());

  it("the table has one row per route with a body (the OpenAPI body registry, and the GOWA webhook left out of it)", () => {
    const expected = [...ROUTE_BODY_SCHEMAS.keys(), "POST /webhooks/gowa"].sort();

    const actual = ROWS.map((row) => row.route).sort();

    expect(actual).toEqual(expected);
  });

  it.each(ROWS.map((row) => [row.route, row] as const))("%s: an invalid body gets 400 { error: { message, type, details } }", async (_route, row) => {
    const res = await send(row.route, row.body);

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toEqual({ error: { message: "Invalid request body", type: "invalid_request_error", details: expect.any(Object) } });
    expect(Object.keys(body.error.details).sort()).toEqual([...(row.details ?? [])].sort());
  });

  describe("a valid body behaves as before (the parsed values reach the service)", () => {
    it("PUT /integrations/web-search/policy", async () => {
      const updatePolicy = webSearch.updatePolicy;

      const res = await send("PUT /integrations/web-search/policy", { workspaceId: WORKSPACE_ID, allowedProviders: ["duckduckgo"], maxResults: 3 });

      expect(res.statusCode).toBe(200);
      expect(updatePolicy).toHaveBeenLastCalledWith(WORKSPACE_ID, { allowedProviders: ["duckduckgo"], maxResults: 3 });
    });

    it("POST /billing/checkout", async () => {
      const res = await send("POST /billing/checkout", { amount: 10 });

      expect(res.statusCode).toBe(201);
      expect(mockCreateCheckoutSession).toHaveBeenLastCalledWith(expect.objectContaining({ line_items: [expect.objectContaining({ price_data: expect.objectContaining({ unit_amount: 1000 }) })] }));
    });

    it("PUT /integrations/web-search/brave/key", async () => {
      const upsertBraveApiKey = webSearch.upsertBraveApiKey;

      const res = await send("PUT /integrations/web-search/brave/key", { workspaceId: WORKSPACE_ID, apiKey: "made-up-brave-key" });

      expect(res.statusCode).toBe(200);
      expect(upsertBraveApiKey).toHaveBeenLastCalledWith(USER_ID, WORKSPACE_ID, "made-up-brave-key");
    });

    it("PATCH /agents/:id/status", async () => {
      const updateStatus = agents.updateStatus;

      const res = await send("PATCH /agents/:id/status", { status: "archived" });

      expect(res.statusCode).toBe(200);
      expect(updateStatus).toHaveBeenLastCalledWith(USER_ID, ID, "archived");
    });

    it("POST /agents/generate-prompt", async () => {
      const generatePrompt = agents.generatePrompt;

      const res = await send("POST /agents/generate-prompt", { name: "Helper", description: "Answers questions" });

      expect(res.statusCode).toBe(200);
      expect(generatePrompt).toHaveBeenLastCalledWith("Helper", "Answers questions");
    });

    it("PATCH /agents/:id/channels/:channelId", async () => {
      const updateChannel = agents.updateChannel;

      const res = await send("PATCH /agents/:id/channels/:channelId", { phoneNumber: "628111000111" });

      expect(res.statusCode).toBe(200);
      expect(updateChannel).toHaveBeenLastCalledWith(USER_ID, ID, ID, { phoneNumber: "628111000111" });
    });

    it("POST /channels/:channelId/workspace/knowledge/search", async () => {
      const search = workspaceKnowledge.searchWorkspaceKnowledge;

      const res = await send("POST /channels/:channelId/workspace/knowledge/search", { query: "refunds", topK: 3 });

      expect(res.statusCode).toBe(200);
      expect(search).toHaveBeenLastCalledWith(WORKSPACE_ID, "refunds", 3);
    });

    it("POST /chat/portal/knowledge (the name is trimmed, as before)", async () => {
      const create = knowledge.createKnowledgeBase;

      const res = await send("POST /chat/portal/knowledge", { name: "  Docs  ", description: " notes " });

      expect(res.statusCode).toBe(201);
      expect(create).toHaveBeenLastCalledWith(USER_ID, { name: "Docs", description: "notes" });
    });
  });
});
