import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AgentController } from "./agent.controller";
import { AgentService } from "../service/agent.service";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { AgentRunPolicyService } from "../service/agent-run-policy.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { MODEL_UNAVAILABLE_MESSAGE } from "../../config/errors/model-unavailable.exception";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createPlan, createSubscription, createUser } from "../../../../test/factories";
import { createResolvableModel } from "../../../../test/provider-model";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-76 B2b: deploying an agent channel (G3) and choosing an agent's model (G4) are gated on the account's package
// snapshots (every package, top-ups excluded), never on user_subscriptions. Refusals are 400 PACKAGE_LIMIT_REACHED and
// store or change nothing. Real controller, service and model registry on the test database; no model is called.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

const WHATSAPP = { channelType: "whatsapp", config: { phoneNumber: "628111000111", webhookSecret: "made-up-secret" } };
const STANDARD_MODEL = "rnx76/standard-model";
const PREMIUM_MODEL = "rnx76/premium-model";

describe("RNX-76 B2b: agent channel and model tier gates (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [AgentController],
      providers: [AgentService, EntitlementService, AgentRunPolicyService, WorkspaceService, WorkspaceQuotaService, ModelRegistryService, { provide: ProviderRouter, useValue: {} }],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createResolvableModel(prisma, { slug: STANDARD_MODEL, tier: "standard" });
    await createResolvableModel(prisma, { slug: PREMIUM_MODEL, tier: "premium" });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => app?.close());

  const auth = (user: { id: string; email: string }) => asSessionUser(user);

  const refusal = (feature: string, requested: string[], nextPackage: string | null = null) => ({
    type: "PACKAGE_LIMIT_REACHED", feature, requested, nextPackage,
  });

  describe("G3: POST /agents/:id/channels", () => {
    const deploy = (user: { id: string; email: string }, agentId: string, payload: object) =>
      app.inject({ method: "POST", url: `/agents/${agentId}/channels`, headers: auth(user), payload });

    it("a channel no package grants: 400 feature=channel naming the next listed package that grants it, no channel row", async () => {
      const inputUser = await createUser(prisma);
      await createPackageSnapshot(prisma, { userId: inputUser.id, name: "Starter", displayOrder: 1, allowedChannels: ["web"] });
      await createPackageSnapshot(prisma, { userId: (await createUser(prisma)).id, name: "Pro", displayOrder: 2, allowedChannels: ["web", "whatsapp"] });
      const agent = await createAgent(prisma, { userId: inputUser.id });

      const actual = await deploy(inputUser, agent.id, WHATSAPP);

      expect(actual.statusCode).toBe(400);
      expect(actual.json().error).toEqual(refusal("channel", ["whatsapp"], "Pro"));
      expect(await prisma.agentChannel.count()).toBe(0);
    });

    it("no package at all: 400 feature=channel, no channel row", async () => {
      const inputUser = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: inputUser.id });

      const actual = await deploy(inputUser, agent.id, { channelType: "web" });

      expect(actual.statusCode).toBe(400);
      expect(actual.json().error).toEqual(refusal("channel", ["web"]));
      expect(await prisma.agentChannel.count()).toBe(0);
    });

    it("an active user_subscriptions row whose plan allows the channel, but no package: refused (the old gate no longer authorizes)", async () => {
      const inputUser = await createUser(prisma);
      const plan = await createPlan(prisma, { allowedChannels: ["web", "whatsapp", "api"] });
      await createSubscription(prisma, { userId: inputUser.id, planId: plan.id, status: "active" });
      const agent = await createAgent(prisma, { userId: inputUser.id });

      const actual = await deploy(inputUser, agent.id, { channelType: "web" });

      expect(actual.statusCode).toBe(400);
      expect(actual.json().error).toEqual(refusal("channel", ["web"]));
      expect(await prisma.agentChannel.count()).toBe(0);
    });

    it("a paid package snapshot without any user_subscriptions row: allowed (201)", async () => {
      const inputUser = await createUser(prisma);
      await createPackageSnapshot(prisma, { userId: inputUser.id, allowedChannels: ["web", "api"] });
      const agent = await createAgent(prisma, { userId: inputUser.id });

      const actual = await deploy(inputUser, agent.id, { channelType: "api" });

      expect(await prisma.userSubscription.count()).toBe(0);
      expect(actual.statusCode).toBe(201);
      expect(await prisma.agentChannel.count({ where: { agentId: agent.id, channelType: "api" } })).toBe(1);
    });

    it.each([
      ["Starter then Pro", [["web"], ["web", "whatsapp"]]],
      ["Pro then Starter", [["web", "whatsapp"], ["web"]]],
    ])("%s: the union of both packages' channels allows whatsapp (201)", async (_order, channelLists) => {
      const inputUser = await createUser(prisma);
      for (const [i, allowedChannels] of channelLists.entries()) {
        await createPackageSnapshot(prisma, { userId: inputUser.id, displayOrder: allowedChannels.length, name: `pkg-${i}`, allowedChannels });
      }
      const agent = await createAgent(prisma, { userId: inputUser.id });

      const actual = await deploy(inputUser, agent.id, WHATSAPP);

      expect(actual.statusCode).toBe(201);
      expect(await prisma.agentChannel.count({ where: { agentId: agent.id, channelType: "whatsapp" } })).toBe(1);
    });

    it("a top-up snapshot only (even one carrying the channel): refused, no channel row", async () => {
      const inputUser = await createUser(prisma);
      const pack = await prisma.topUpPack.create({ data: { name: "Top-up", active: true } });
      const packVersion = await prisma.topUpPackVersion.create({ data: { packId: pack.id, versionNumber: 1, creditsGranted: 10, priceUsdCents: 1, createdBy: "test", reason: "test" } });
      await prisma.purchaseSnapshot.create({ data: { buyerUserId: inputUser.id, topUpPackVersionId: packVersion.id, priceUsdCents: 1, exchangeRate: 1, exchangeRateDate: new Date("2026-01-01"), exchangeRateSource: "test", priceRupiah: 1, creditsGranted: 10, allowedChannels: ["web"], allowedTiers: [] } });
      const agent = await createAgent(prisma, { userId: inputUser.id });

      const actual = await deploy(inputUser, agent.id, { channelType: "web" });

      expect(actual.statusCode).toBe(400);
      expect(actual.json().error).toEqual(refusal("channel", ["web"]));
      expect(await prisma.agentChannel.count()).toBe(0);
    });

    it("the catalog lowered after the purchase: the buyer keeps the channel bought (201)", async () => {
      const inputUser = await createUser(prisma);
      const bought = await createPackageSnapshot(prisma, { userId: inputUser.id, allowedChannels: ["web", "whatsapp"] });
      const boughtVersion = await prisma.packageVersion.findUniqueOrThrow({ where: { id: bought.packageVersionId! } });
      await prisma.packageVersion.create({ data: { packageId: boughtVersion.packageId, versionNumber: 2, effectiveFrom: new Date("2026-01-01"), priceUsdCents: 100, creditsGranted: 10, billing: "one_time", maxAgents: 3, maxConnectedTools: 1, apiAccess: false, allowedChannels: ["web"], allowedTiers: ["standard"], createdBy: "test", reason: "lowered" } });
      const agent = await createAgent(prisma, { userId: inputUser.id });

      const actual = await deploy(inputUser, agent.id, WHATSAPP);

      expect(actual.statusCode).toBe(201);
    });
  });

  describe("G4: an agent's model tier", () => {
    const newAgent = (model: string) => ({ name: "Gated agent", systemPrompt: "prompt", model });

    const template = async (model: string) => {
      const author = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: author.id, name: "Template", isPublic: true, status: "active", model });
      await prisma.agentTool.create({ data: { agentId: agent.id, toolType: "calculator" } });
      return agent;
    };

    it("POST /agents with a model of a tier no package allows: 400 feature=tier, nothing stored", async () => {
      const inputUser = await createUser(prisma);
      await createPackageSnapshot(prisma, { userId: inputUser.id, allowedTiers: ["standard"] });

      const actual = await app.inject({ method: "POST", url: "/agents", headers: auth(inputUser), payload: newAgent(PREMIUM_MODEL) });

      expect(actual.statusCode).toBe(400);
      expect(actual.json().error).toEqual(refusal("tier", ["premium"]));
      expect(await prisma.agent.count()).toBe(0);
      expect(await prisma.workspace.count({ where: { ownerId: inputUser.id } })).toBe(0);
    });

    it("POST /agents with an unknown model slug: 400, nothing stored", async () => {
      const inputUser = await createUser(prisma);
      await createPackageSnapshot(prisma, { userId: inputUser.id });

      const actual = await app.inject({ method: "POST", url: "/agents", headers: auth(inputUser), payload: newAgent("no/such-model") });

      expect(actual.statusCode).toBe(400);
      expect(actual.json().message).toBe(MODEL_UNAVAILABLE_MESSAGE);
      expect(await prisma.agent.count()).toBe(0);
    });

    it("POST /agents with a model of a tier the package allows: 201", async () => {
      const inputUser = await createUser(prisma);
      await createPackageSnapshot(prisma, { userId: inputUser.id, allowedTiers: ["standard", "premium"] });

      const actual = await app.inject({ method: "POST", url: "/agents", headers: auth(inputUser), payload: newAgent(PREMIUM_MODEL) });

      expect(actual.statusCode).toBe(201);
      expect(actual.json()).toMatchObject({ model: PREMIUM_MODEL });
    });

    it.each([
      ["a model of a tier no package allows", PREMIUM_MODEL],
      ["an unknown model slug", "no/such-model"],
    ])("PATCH /agents/:id to %s: 400, the agent unchanged", async (_name, inputModel) => {
      const inputUser = await createUser(prisma);
      await createPackageSnapshot(prisma, { userId: inputUser.id, allowedTiers: ["standard"] });
      const agent = await createAgent(prisma, { userId: inputUser.id, name: "Before", model: STANDARD_MODEL });

      const actual = await app.inject({ method: "PATCH", url: `/agents/${agent.id}`, headers: auth(inputUser), payload: { name: "After", model: inputModel } });

      expect(actual.statusCode).toBe(400);
      expect(await prisma.agent.findUnique({ where: { id: agent.id }, select: { name: true, model: true } })).toEqual({ name: "Before", model: STANDARD_MODEL });
    });

    it("PATCH /agents/:id to a model of an allowed tier: 200, the model changed", async () => {
      const inputUser = await createUser(prisma);
      await createPackageSnapshot(prisma, { userId: inputUser.id, allowedTiers: ["premium"] });
      const agent = await createAgent(prisma, { userId: inputUser.id, model: STANDARD_MODEL });

      const actual = await app.inject({ method: "PATCH", url: `/agents/${agent.id}`, headers: auth(inputUser), payload: { model: PREMIUM_MODEL } });

      expect(actual.statusCode).toBe(200);
      expect(actual.json()).toMatchObject({ model: PREMIUM_MODEL });
    });

    it.each([
      ["without a model", {}],
      ["with the same model", { model: PREMIUM_MODEL }],
    ])("PATCH /agents/:id %s does not call the gate (200, even when the agent's tier is no longer allowed)", async (_name, extra) => {
      const inputUser = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: inputUser.id, model: PREMIUM_MODEL });
      const mockGate = jest.spyOn(EntitlementService.prototype, "requireModelTier");
      const mockResolve = jest.spyOn(ModelRegistryService.prototype, "resolveModel");

      const actual = await app.inject({ method: "PATCH", url: `/agents/${agent.id}`, headers: auth(inputUser), payload: { name: "Renamed", ...extra } });

      expect(actual.statusCode).toBe(200);
      expect(mockGate).not.toHaveBeenCalled();
      expect(mockResolve).not.toHaveBeenCalled();
    });

    it("POST /agents/clone/:templateId of a template whose model tier no package allows: 400, nothing stored", async () => {
      const inputUser = await createUser(prisma);
      await createPackageSnapshot(prisma, { userId: inputUser.id, allowedTiers: ["standard"] });
      const tpl = await template(PREMIUM_MODEL);

      const actual = await app.inject({ method: "POST", url: `/agents/clone/${tpl.id}`, headers: auth(inputUser) });

      expect(actual.statusCode).toBe(400);
      expect(actual.json().error).toEqual(refusal("tier", ["premium"]));
      expect(await prisma.agent.count({ where: { userId: inputUser.id } })).toBe(0);
      expect(await prisma.agentTool.count()).toBe(1);
      expect(await prisma.workspace.count({ where: { ownerId: inputUser.id } })).toBe(0);
    });

    it("POST /agents/clone/:templateId of a template whose model tier the package allows: 201", async () => {
      const inputUser = await createUser(prisma);
      await createPackageSnapshot(prisma, { userId: inputUser.id, allowedTiers: ["premium"] });
      const tpl = await template(PREMIUM_MODEL);

      const actual = await app.inject({ method: "POST", url: `/agents/clone/${tpl.id}`, headers: auth(inputUser) });

      expect(actual.statusCode).toBe(201);
      expect(actual.json()).toMatchObject({ userId: inputUser.id, model: PREMIUM_MODEL });
    });
  });
});
