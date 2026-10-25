import { BadRequestException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { AgentService } from "./agent.service";
import { AgentRunPolicyService } from "./agent-run-policy.service";
import { AgentRepository } from "../repository/agent.repository";
import { AgentIntegrationRepository } from "../repository/agent-integration.repository";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";

// RNX-76 B1: the package limit of AgentService.create / cloneFromTemplate (maxAgents) and attachIntegration
// (maxConnectedTools, counted per agent) holds under parallel callers. The count and the insert run in one
// transaction behind one per-account advisory lock (acquireAccountEntitlementLock). Real service, real
// EntitlementService, real lock, test database.
//
// A plain Promise.all does not show a race (docs/testing.md, "Race tests"), so every caller is held just before its
// write until all N have arrived (or a short timeout passes). With the lock only one caller can reach the write
// at a time, so the timeout releases the first and the others find the limit reached. Without the lock all N
// pass the same count and every one writes: the "no lock" control below shows that the scenario does catch it.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

const CALLERS = 5;
const HOLD_MS = 400;

describe("RNX-76 B1: package limits under parallel callers (AgentService, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AgentService;
  let agentRepository: AgentRepository;
  let integrationRepository: AgentIntegrationRepository;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      providers: [
        AgentService,
        EntitlementService,
        AgentRunPolicyService,
        WorkspaceService,
        WorkspaceQuotaService,
        { provide: ProviderRouter, useValue: {} },
        { provide: ModelRegistryService, useValue: {} },
      ],
    }));
    service = moduleRef.get(AgentService);
    agentRepository = moduleRef.get(AgentRepository);
    integrationRepository = moduleRef.get(AgentIntegrationRepository);
  });
  beforeEach(() => resetDatabase(prisma));
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => moduleRef?.close());

  /** Holds each call of `method` until `callers` have arrived or HOLD_MS passed, then lets it through; later calls pass at once. */
  const holdBeforeWrite = <T extends object, K extends keyof T & string>(target: T, method: K, callers: number) => {
    const original = (target[method] as (...args: unknown[]) => unknown).bind(target);
    let arrived = 0;
    let open = false;
    let release!: () => void;
    const allArrived = new Promise<void>((resolve) => (release = resolve));
    jest.spyOn(target, method as never).mockImplementation((async (...args: unknown[]) => {
      arrived += 1;
      if (arrived === callers) release();
      if (!open) await Promise.race([allArrived, new Promise((resolve) => setTimeout(resolve, HOLD_MS))]);
      open = true;
      return original(...args);
    }) as never);
  };

  const outcome = (results: PromiseSettledResult<unknown>[]) => ({
    ok: results.filter((r) => r.status === "fulfilled").length,
    refused: results.filter(
      (r) =>
        r.status === "rejected" &&
        r.reason instanceof BadRequestException &&
        (r.reason.getResponse() as { error?: { type?: string } }).error?.type === "PACKAGE_LIMIT_REACHED",
    ).length,
  });

  const noLock = () => {
    jest.spyOn(agentRepository, "acquireAccountEntitlementLock").mockResolvedValue(undefined as never);
    jest.spyOn(integrationRepository, "acquireAccountEntitlementLock").mockResolvedValue(undefined as never);
  };

  /** A buyer with a package of `maxAgents` and `existing` agents already created (the default workspace exists). */
  const buyerAtLimitMinusOne = async (existing: number, limits: { maxAgents?: number; maxConnectedTools?: number }) => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id, ...limits });
    for (let i = 0; i < existing; i += 1) await createAgent(prisma, { userId: user.id });
    return user;
  };

  // Distinct names: the slug is unique per (user, slug), so same-named parallel creates would be stopped by that
  // constraint and hide the missing lock.
  const createParallel = (userId: string) =>
    Promise.allSettled(
      Array.from({ length: CALLERS }, (_, i) =>
        service.create(userId, { name: `Parallel agent ${i}`, systemPrompt: "prompt", model: "test-model" } as never),
      ),
    );

  describe("create (maxAgents)", () => {
    it("at limit - 1, exactly one of N parallel creates succeeds; the others get PACKAGE_LIMIT_REACHED", async () => {
      const user = await buyerAtLimitMinusOne(2, { maxAgents: 3 });
      holdBeforeWrite(agentRepository, "createAgent", CALLERS);

      const results = await createParallel(user.id);

      expect(outcome(results)).toEqual({ ok: 1, refused: CALLERS - 1 });
      expect(await prisma.agent.count({ where: { userId: user.id } })).toBe(3);
    });

    it("control, the lock removed: the same scenario admits every caller (the test can see the race)", async () => {
      const user = await buyerAtLimitMinusOne(2, { maxAgents: 3 });
      noLock();
      holdBeforeWrite(agentRepository, "createAgent", CALLERS);

      const results = await createParallel(user.id);

      expect(outcome(results).ok).toBeGreaterThan(1);
      expect(await prisma.agent.count({ where: { userId: user.id } })).toBeGreaterThan(3);
    });

    it("two accounts racing at their own limit - 1 each admit exactly one caller", async () => {
      const first = await buyerAtLimitMinusOne(2, { maxAgents: 3 });
      const second = await buyerAtLimitMinusOne(2, { maxAgents: 3 });
      holdBeforeWrite(agentRepository, "createAgent", CALLERS * 2);

      const [a, b] = await Promise.all([createParallel(first.id), createParallel(second.id)]);

      expect(outcome(a)).toEqual({ ok: 1, refused: CALLERS - 1 });
      expect(outcome(b)).toEqual({ ok: 1, refused: CALLERS - 1 });
    });
  });

  describe("cloneFromTemplate (maxAgents)", () => {
    // One template per caller, with its own name, for the same slug reason as above.
    const seedTemplates = async () => {
      const system = await createUser(prisma);
      return Promise.all(
        Array.from({ length: CALLERS }, (_, i) =>
          createAgent(prisma, { userId: system.id, name: `Template ${i}`, slug: `template-${i}`, isPublic: true, status: "active" }),
        ),
      );
    };
    const cloneParallel = (userId: string, templates: { id: string }[]) =>
      Promise.allSettled(templates.map((t) => service.cloneFromTemplate(userId, t.id)));

    it("at limit - 1, exactly one of N parallel clones succeeds; the others get PACKAGE_LIMIT_REACHED", async () => {
      const templates = await seedTemplates();
      const user = await buyerAtLimitMinusOne(2, { maxAgents: 3 });
      holdBeforeWrite(agentRepository, "createAgent", CALLERS);

      const results = await cloneParallel(user.id, templates);

      expect(outcome(results)).toEqual({ ok: 1, refused: CALLERS - 1 });
      expect(await prisma.agent.count({ where: { userId: user.id } })).toBe(3);
    });

    it("control, the lock removed: the same scenario admits every caller", async () => {
      const templates = await seedTemplates();
      const user = await buyerAtLimitMinusOne(2, { maxAgents: 3 });
      noLock();
      holdBeforeWrite(agentRepository, "createAgent", CALLERS);

      const results = await cloneParallel(user.id, templates);

      expect(outcome(results).ok).toBeGreaterThan(1);
      expect(await prisma.agent.count({ where: { userId: user.id } })).toBeGreaterThan(3);
    });
  });

  describe("attachIntegration (maxConnectedTools, provisionally counted per agent)", () => {
    const attachParallel = (userId: string, agentIds: string[]) =>
      Promise.allSettled(
        agentIds.map((agentId, i) => service.attachIntegration(userId, agentId, `provider-${i}`, {}, ["read"])),
      );

    it("on the same agent at limit - 1, exactly one of N parallel attaches succeeds; the others get PACKAGE_LIMIT_REACHED", async () => {
      const user = await buyerAtLimitMinusOne(0, { maxConnectedTools: 2 });
      const agent = await createAgent(prisma, { userId: user.id });
      await prisma.agentIntegration.create({ data: { agentId: agent.id, provider: "existing", config: {}, scopes: ["read"] } });
      holdBeforeWrite(integrationRepository, "createAgentIntegration", CALLERS);

      const results = await attachParallel(user.id, Array(CALLERS).fill(agent.id));

      expect(outcome(results)).toEqual({ ok: 1, refused: CALLERS - 1 });
      expect(await prisma.agentIntegration.count({ where: { agentId: agent.id } })).toBe(2);
    });

    it("control, the lock removed: the same scenario admits every caller", async () => {
      const user = await buyerAtLimitMinusOne(0, { maxConnectedTools: 2 });
      const agent = await createAgent(prisma, { userId: user.id });
      await prisma.agentIntegration.create({ data: { agentId: agent.id, provider: "existing", config: {}, scopes: ["read"] } });
      noLock();
      holdBeforeWrite(integrationRepository, "createAgentIntegration", CALLERS);

      const results = await attachParallel(user.id, Array(CALLERS).fill(agent.id));

      expect(outcome(results).ok).toBeGreaterThan(1);
      expect(await prisma.agentIntegration.count({ where: { agentId: agent.id } })).toBeGreaterThan(2);
    });

    it("control, different agents of the same account (limit 1 each, none attached yet): every parallel attach succeeds", async () => {
      const user = await buyerAtLimitMinusOne(0, { maxConnectedTools: 1 });
      const agents = await Promise.all(Array.from({ length: CALLERS }, () => createAgent(prisma, { userId: user.id })));
      holdBeforeWrite(integrationRepository, "createAgentIntegration", CALLERS);

      const results = await attachParallel(user.id, agents.map((a) => a.id));

      expect(outcome(results)).toEqual({ ok: CALLERS, refused: 0 });
      for (const agent of agents) {
        expect(await prisma.agentIntegration.count({ where: { agentId: agent.id } })).toBe(1);
      }
    });
  });
});
