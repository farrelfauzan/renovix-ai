import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { ChannelChatService } from "./channel-chat.service";
import { ChannelService } from "./channel.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { AgentLinkService } from "../../agent/service/agent-link.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPlan, createSubscription, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";

// RNX-119 (D257): channel chat applies the run policy and the D192 subscription gate on every message, not only when
// the agent was added to the channel; the caller runs and pays from their own paid wallet; a run outside the agent's
// workspace reads no workspace memory (R17). Real ChannelChatService, ChannelService, run policy, AgentMemoryService,
// meter, CreditService and UsageService on the test database; fake provider. These collaborators load ESM-only packages.
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const AGENT_PROMPT = "TEAM AGENT PROMPT";

describe("RNX-119: the run policy on every channel chat message (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: ChannelChatService;
  let channels: ChannelService;
  let memory: AgentMemoryService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          ChannelChatService,
          ChannelService,
          AgentRunPolicyService,
          AgentLinkService,
          AgentMemoryService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          {
            provide: AgentToolService,
            useValue: { buildToolSchemasWithMcp: async () => [], cleanupMcpConnections: async () => undefined },
          },
          {
            provide: GuardrailService,
            useValue: {
              checkInput: async () => ({ blocked: false }),
              checkOutput: async (content: string) => ({ blocked: false, content }),
            },
          },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    service = moduleRef.get(ChannelChatService);
    channels = moduleRef.get(ChannelService);
    memory = moduleRef.get(AgentMemoryService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** A user on a plan with this slug; subscribed (active) and funded with 1 credit unless told otherwise. */
  const newUser = async ({ planSlug, subscribed = true }: { planSlug?: string; subscribed?: boolean } = {}) => {
    const user = await createUser(prisma);
    const plan = await createPlan(prisma, planSlug ? { slug: planSlug, maxWorkspaceUsers: 100 } : {});
    await createSubscription(prisma, { userId: user.id, planId: plan.id, status: subscribed ? "active" : "canceled" });
    await fundPaidWallet(prisma, user.id, "1");
    return user;
  };

  /** An Enterprise owner's workspace with an active agent (public when asked) and one workspace memory. */
  const seedWorkspace = async ({ isPublic = false } = {}) => {
    const owner = await newUser({ planSlug: "enterprise" });
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    const agent = await createAgent(prisma, {
      userId: owner.id,
      workspaceId: workspace.id,
      systemPrompt: AGENT_PROMPT,
      status: "active",
      isPublic,
    });
    await prisma.workspaceMemory.create({
      data: { workspaceId: workspace.id, type: "fact", content: "TEAM MEMORY FACT", status: "active" },
    });
    return { owner, workspace, agent };
  };

  /** This user's own channel, with the agent added through ChannelService.addAgent (the add-time policy check). */
  const channelWithAgent = async (userId: string, agentId: string) => {
    const channel = await prisma.channel.create({ data: { userId, name: "My room" } });
    await channels.addAgent(userId, channel.id, agentId);
    return channel;
  };

  /** A collaborator (active member, subscribed unless told otherwise) with the private agent in their own channel. */
  const collaboratorSetup = async (subscribed = true) => {
    const seeded = await seedWorkspace();
    const collaborator = await newUser({ subscribed });
    const member = await prisma.workspaceMember.create({
      data: { workspaceId: seeded.workspace.id, userId: collaborator.id, role: "member", status: "active", joinedAt: new Date() },
    });
    const channel = await channelWithAgent(collaborator.id, seeded.agent.id);
    return { ...seeded, collaborator, member, channel };
  };

  /** An outsider with the owner's public agent in their own channel. */
  const outsiderSetup = async () => {
    const seeded = await seedWorkspace({ isPublic: true });
    const outsider = await newUser();
    const channel = await channelWithAgent(outsider.id, seeded.agent.id);
    return { ...seeded, outsider, channel };
  };

  /** One chat; waits for its (asynchronous) memory extraction to end. */
  const chat = async (userId: string, channelId: string, agentId: string, message: string) => {
    const extraction = jest.spyOn(memory, "extractAndStore");
    const result = await service.chat(userId, channelId, agentId, message);
    await Promise.all(extraction.mock.results.map((r) => r.value));
    return result;
  };

  const nothingCharged = async () => {
    expect(fake.requests).toHaveLength(0);
    expect(await prisma.creditReservation.count()).toBe(0);
    expect(await prisma.creditLedgerEntry.count({ where: { type: "usage" } })).toBe(0);
    expect(await prisma.channelMessage.count()).toBe(0);
  };

  it("a collaborator's channel chat runs the private workspace agent and reserves on the collaborator's own paid wallet (control)", async () => {
    const { owner, collaborator, channel, agent } = await collaboratorSetup();
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 100, completion_tokens: 10 } }, { content: "[]" });

    await service.assertRunCanStart(collaborator.id, channel.id, agent.id, "Hi");
    const result = await chat(collaborator.id, channel.id, agent.id, "Hi");

    expect(result.content).toBe("Hello");
    const reservations = await prisma.creditReservation.findMany({ include: { account: true } });
    expect(reservations.map((r) => [r.account.userId, r.wallet, r.status])).toEqual([[collaborator.id, "paid", "settled"]]);
    const ownerAccount = await prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId: owner.id, wallet: "paid" } } });
    expect(ownerAccount.balance.toFixed(6)).toBe("1.000000");
    expect(String(fake.requests[0].messages[0].content)).toContain("TEAM MEMORY FACT");
  });

  it("AC2: the member is removed after the agent was added: the next message is refused with 404, nothing charged", async () => {
    const { collaborator, member, channel, agent } = await collaboratorSetup();
    await prisma.workspaceMember.update({ where: { id: member.id }, data: { status: "removed" } });

    await expect(service.assertRunCanStart(collaborator.id, channel.id, agent.id, "Hi")).rejects.toThrow(
      new NotFoundException("Agent not found"),
    );
    await expect(service.chat(collaborator.id, channel.id, agent.id, "Hi")).rejects.toThrow(new NotFoundException("Agent not found"));

    await nothingCharged();
  });

  it("AC2: the public agent is unpublished after an outsider added it: the next message is refused with 404, nothing charged", async () => {
    const { outsider, channel, agent } = await outsiderSetup();
    await prisma.agent.update({ where: { id: agent.id }, data: { isPublic: false } });

    await expect(service.assertRunCanStart(outsider.id, channel.id, agent.id, "Hi")).rejects.toThrow(
      new NotFoundException("Agent not found"),
    );
    await expect(service.chat(outsider.id, channel.id, agent.id, "Hi")).rejects.toThrow(new NotFoundException("Agent not found"));

    await nothingCharged();
  });

  it("the add-time check stays: a user who may not run the private agent cannot add it to their channel (404)", async () => {
    const { agent } = await seedWorkspace();
    const stranger = await newUser();
    const channel = await prisma.channel.create({ data: { userId: stranger.id, name: "Room" } });

    await expect(channels.addAgent(stranger.id, channel.id, agent.id)).rejects.toThrow(new NotFoundException("Agent not found"));

    expect(await prisma.channelAgent.count()).toBe(0);
  });

  it("AC3: a collaborator without an active subscription is refused with 403 (D192), nothing charged", async () => {
    const { collaborator, channel, agent } = await collaboratorSetup(false);

    await expect(service.assertRunCanStart(collaborator.id, channel.id, agent.id, "Hi")).rejects.toThrow(
      new ForbiddenException("Active subscription required to use AI Agents."),
    );
    await expect(service.chat(collaborator.id, channel.id, agent.id, "Hi")).rejects.toThrow(
      new ForbiddenException("Active subscription required to use AI Agents."),
    );

    await nothingCharged();
  });

  it("AC5: an outsider's channel chat with the public agent: no workspace memory in the prompt, no extraction, no fact written", async () => {
    const { outsider, channel, agent } = await outsiderSetup();
    const memoriesBefore = await prisma.workspaceMemory.count();
    // Only the run's turn: an extraction call (the gate broken) would find no turn left and be counted in requests.
    fake.enqueue({ content: "Hello" });

    await chat(outsider.id, channel.id, agent.id, "I like Rust");

    expect(fake.requests).toHaveLength(1);
    expect(String(fake.requests[0].messages[0].content)).not.toContain("TEAM MEMORY FACT");
    expect(await prisma.workspaceMemory.count()).toBe(memoriesBefore);
    expect(await prisma.userMemory.count()).toBe(0);
  });
});
