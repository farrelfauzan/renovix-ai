import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { asSessionUser } from "../../../../test/as-session-user";
import { createAgent, createApiKey, createPackageSnapshot, createUser, testApiKey } from "../../../../test/factories";
import { EntitlementService } from "../service/entitlement.service";
import { MyEntitlementsService } from "../service/my-entitlements.service";
import { EntitlementsController } from "./entitlements.controller";

// RNX-76 B3b (Q4): GET /entitlements/me, the numbers behind the UI limit pills, on the test database. The session is
// the mocked Better Auth one (asSessionUser); an API key is refused by the session-only route.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

const FREE_SHAPE = {
  packageName: null,
  agents: { used: 0, limit: 0 },
  connectedToolsPerAgent: 0,
  apiAccess: false,
  channels: [],
  tiers: ["standard"],
  collaborationEnabled: false,
  nextPackage: null,
};

describe("GET /entitlements/me (RNX-76 B3b, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [EntitlementsController],
      providers: [MyEntitlementsService, EntitlementService],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const getMine = (user: { id: string; email: string }) =>
    app.inject({ method: "GET", url: "/entitlements/me", headers: asSessionUser(user) });

  it("no package: zero limits, no API access, no channels, only the cheapest tier, no next package when none is listed", async () => {
    const inputUser = await createUser(prisma);

    const actual = await getMine(inputUser);

    expect(actual.statusCode).toBe(200);
    expect(actual.json()).toEqual(FREE_SHAPE);
  });

  it("no package with a listed package: it is the next package", async () => {
    const inputUser = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: (await createUser(prisma)).id, name: "Starter", displayOrder: 1, maxAgents: 3 });

    const actual = await getMine(inputUser);

    expect(actual.json()).toEqual({ ...FREE_SHAPE, nextPackage: "Starter" });
  });

  it("one package: its limits, the user's own agents only, and the next listed package with more agents", async () => {
    const inputUser = await createUser(prisma);
    const otherUser = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: inputUser.id, name: "Starter", displayOrder: 1, maxAgents: 3, maxConnectedTools: 2, allowedChannels: ["web"] });
    await createPackageSnapshot(prisma, { userId: otherUser.id, name: "Pro", displayOrder: 2, maxAgents: 10 });
    await createAgent(prisma, { userId: inputUser.id });
    await createAgent(prisma, { userId: inputUser.id });
    await createAgent(prisma, { userId: otherUser.id });

    const actual = await getMine(inputUser);

    expect(actual.statusCode).toBe(200);
    expect(actual.json()).toEqual({
      packageName: "Starter",
      agents: { used: 2, limit: 3 },
      connectedToolsPerAgent: 2,
      apiAccess: false,
      channels: ["web"],
      tiers: ["standard"],
      collaborationEnabled: false,
      nextPackage: "Pro",
    });
  });

  it("two packages: the aggregated values (largest limits, any API access, union of channels and tiers)", async () => {
    const inputUser = await createUser(prisma);
    const otherUser = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: inputUser.id, name: "Starter", displayOrder: 1, maxAgents: 3, maxConnectedTools: 1, allowedChannels: ["web"], allowedTiers: ["standard"] });
    await createPackageSnapshot(prisma, { userId: inputUser.id, name: "Pro", displayOrder: 2, maxAgents: 10, maxConnectedTools: 5, apiAccess: true, allowedChannels: ["whatsapp"], allowedTiers: ["premium"] });
    await createPackageSnapshot(prisma, { userId: otherUser.id, name: "Max", displayOrder: 3, maxAgents: 20 });

    const actual = await getMine(inputUser);

    expect(actual.json()).toEqual({
      packageName: "Pro",
      agents: { used: 0, limit: 10 },
      connectedToolsPerAgent: 5,
      apiAccess: true,
      channels: ["web", "whatsapp"],
      tiers: ["standard", "premium"],
      collaborationEnabled: false,
      nextPackage: "Max",
    });
  });

  it("a top-up alone is not a package: the free shape", async () => {
    const inputUser = await createUser(prisma);
    const pack = await prisma.topUpPack.create({ data: { name: "Top-up", active: true } });
    const version = await prisma.topUpPackVersion.create({ data: { packId: pack.id, versionNumber: 1, creditsGranted: 10, priceUsdCents: 100, createdBy: "test", reason: "RNX-76" } });
    await prisma.purchaseSnapshot.create({
      data: {
        buyerUserId: inputUser.id, topUpPackVersionId: version.id, priceUsdCents: 100, exchangeRate: 16500, exchangeRateDate: new Date("2026-01-01"),
        exchangeRateSource: "test", priceRupiah: 165000, creditsGranted: 10,
      },
    });

    const actual = await getMine(inputUser);

    expect(actual.json()).toEqual(FREE_SHAPE);
  });

  it("without a credential: 401", async () => {
    const actual = await app.inject({ method: "GET", url: "/entitlements/me" });

    expect(actual.statusCode).toBe(401);
  });

  it("with an API key: 403, the route is for the session only", async () => {
    const inputUser = await createUser(prisma);
    await createApiKey(prisma, inputUser.id, { apiKey: testApiKey("rnx76-b3b") });

    const actual = await app.inject({ method: "GET", url: "/entitlements/me", headers: { authorization: `Bearer ${testApiKey("rnx76-b3b")}` } });

    expect(actual.statusCode).toBe(403);
  });
});
