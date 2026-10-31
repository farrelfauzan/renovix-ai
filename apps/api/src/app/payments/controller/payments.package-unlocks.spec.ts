import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { AgentService } from "../../agent/service/agent.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProviderRouter } from "../../providers/provider-router";
import { PrismaService } from "../../prisma/prisma.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { FakePaymentProvider } from "../providers/fake-payment.provider";
import { createUser } from "../../../../test/factories";
import { resetDatabase } from "../../../../test/test-database";
import { createTestModule } from "../../../../test/test-module";
import { cheapestTierRegistry } from "../../../../test/cheapest-tier-registry";
import {
  STARTER_PRICE_RUPIAH,
  TEST_WEBHOOK_SECRET,
  createPaymentsApp,
  fakeWebhookBody,
  paymentsHttp,
  seedPaymentCatalog,
  seedPaymentSettings,
  seedRate,
  sessionFromCookie,
} from "../../../../test/payments";

// RNX-251 (D267): a package bought through the one payment grant path (checkout, FakePaymentProvider, verified webhook)
// unlocks workspaces and agents by its purchase snapshot alone. The payments app and a second module with the agent
// and workspace services share the test database. No network: fetch is stubbed.
const mockGetSession = jest.fn();
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } } }));

const STARTER_MAX_AGENTS = 3;

describe("RNX-251: a paid Starter order unlocks workspaces and agents (fake provider, test database)", () => {
  const fake = new FakePaymentProvider({ webhookSecret: TEST_WEBHOOK_SECRET });
  let paymentsModuleRef: TestingModule;
  let agentsModuleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof paymentsHttp>;
  let catalog: Awaited<ReturnType<typeof seedPaymentCatalog>>;

  beforeAll(async () => {
    ({ moduleRef: paymentsModuleRef, prisma, app } = await createPaymentsApp(fake));
    http = paymentsHttp(app);
    ({ moduleRef: agentsModuleRef } = await createTestModule({
      providers: [AgentService, AgentRunPolicyService, WorkspaceService, WorkspaceQuotaService, { provide: ProviderRouter, useValue: {} }, { provide: ModelRegistryService, useValue: cheapestTierRegistry }],
    }));
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    mockGetSession.mockReset().mockImplementation(sessionFromCookie);
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("RNX-251 test: no network"));
    catalog = await seedPaymentCatalog(prisma);
    await seedRate(prisma);
    await seedPaymentSettings(prisma);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
    await agentsModuleRef?.close();
    await paymentsModuleRef?.close();
  });

  /** A user who bought Starter through the real checkout and a verified paid webhook. */
  const paidStarterBuyer = async () => {
    const user = await createUser(prisma);
    const checkout = await http.checkout(user.id, { offer: "package", packageId: catalog.starterId });
    expect(checkout.statusCode).toBe(201);
    const orderId: string = checkout.json().orderId;
    fake.simulatePaid(orderId);
    const webhook = await http.webhook(fakeWebhookBody(`fake_${orderId}`, "paid", STARTER_PRICE_RUPIAH));
    expect(webhook.statusCode).toBe(200);
    return user;
  };
  const newAgent = (name: string) => ({ name, systemPrompt: "prompt", model: "test-model", temperature: 0.7, isPublic: false });

  it("the Starter buyer creates a workspace and agents up to the package's maxAgents", async () => {
    const buyer = await paidStarterBuyer();
    const agents = agentsModuleRef.get(AgentService);

    const actualWorkspace = await agentsModuleRef.get(WorkspaceService).create(buyer.id, { name: "Starter team" });
    for (let i = 1; i <= STARTER_MAX_AGENTS; i += 1) await agents.create(buyer.id, newAgent(`Agent ${i}`));
    const overLimit = agents.create(buyer.id, newAgent("One too many"));

    expect(await prisma.purchaseSnapshot.count({ where: { buyerUserId: buyer.id, packageVersionId: catalog.starterVersionId } })).toBe(1);
    expect(actualWorkspace).toMatchObject({ ownerId: buyer.id, name: "Starter team" });
    await expect(overLimit).rejects.toMatchObject({ status: 400 });
    expect(await prisma.agent.count({ where: { userId: buyer.id } })).toBe(STARTER_MAX_AGENTS);
  });

  it("control: before the order is paid the same user can create neither (403 workspace, 400 agent)", async () => {
    const user = await createUser(prisma);
    expect((await http.checkout(user.id, { offer: "package", packageId: catalog.starterId })).statusCode).toBe(201);

    const workspace = agentsModuleRef.get(WorkspaceService).create(user.id, { name: "Too early" });
    const agent = agentsModuleRef.get(AgentService).create(user.id, newAgent("Too early"));

    await expect(workspace).rejects.toMatchObject({ status: 403 });
    await expect(agent).rejects.toMatchObject({ status: 400 });
    expect(await prisma.workspace.count({ where: { ownerId: user.id, isDefault: false } })).toBe(0);
    expect(await prisma.agent.count()).toBe(0);
  });
});
