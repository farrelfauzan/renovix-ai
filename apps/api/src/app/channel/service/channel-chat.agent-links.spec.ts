import { TestingModule } from "@nestjs/testing";
import { ChannelChatService } from "./channel-chat.service";
import { ChannelService } from "./channel.service";
import { AgentLinkService } from "../../agent/service/agent-link.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";

// RNX-118 (PRD 10, D81; replaces RX-112's channel sub-agent suite): in a channel chat, call_agent is offered and the
// callable agents are listed only when the channel agent has links and the caller is the workspace owner or a
// current collaborator of the agent's workspace. Anyone else (a channel owner running someone else's public agent)
// runs it stand-alone (R17), and a call to an agent that is not a linked callee in the agent's workspace never runs.
// These collaborators load ESM-only packages and are stubbed below.
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const CALL_AGENT = {
  type: "function",
  function: { name: "call_agent", description: "Call", parameters: {} },
};

describe("RNX-118: channel chat calls only linked agents (test database)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: ChannelChatService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          ChannelChatService,
          AgentRunPolicyService,
          ChannelService,
          AgentLinkService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          {
            // Same call_agent rule as AgentToolService.buildToolSchemas (agent-tool.service.spec.ts)
            provide: AgentToolService,
            useValue: {
              buildToolSchemasWithMcp: async (
                _tools: unknown,
                _agentId: string,
                _userId?: string,
                _workspaceId?: string,
                options?: { injectCallAgent?: boolean },
              ) => (options?.injectCallAgent ? [CALL_AGENT] : []),
              cleanupMcpConnections: async () => undefined,
            },
          },
          {
            provide: AgentMemoryService,
            useValue: {
              getWorkspaceMemoryContext: async () => "",
              extractAndStore: async () => undefined,
            },
          },
          { provide: UsageService, useValue: { logUsage: async () => undefined } },
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
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    await createResolvableModel(prisma, {
      slug: "test-model",
      modelName: "test-model",
      inputPrice: 0.000001,
      outputPrice: 0.000001,
      maxTokens: 8192,
    });
    // RX-22b: channel chats are charged on the ledger at the tier rate.
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(() => moduleRef?.close());

  /**
   * Bob's public agent A with callee B in Bob's workspace (linked A -> B when asked), in a channel of the caller
   * (Bob, or Carol who is not a member of Bob's workspace and runs Bob's public agent).
   */
  const seed = async ({ callerIs, linked = true }: { callerIs: "bob" | "carol"; linked?: boolean }) => {
    const bob = await createUser(prisma);
    const carol = await createUser(prisma);
    const workspace = await createWorkspace(prisma, { ownerId: bob.id });
    const a = await createAgent(prisma, { userId: bob.id, workspaceId: workspace.id, status: "active", isPublic: true });
    const b = await createAgent(prisma, {
      userId: bob.id,
      workspaceId: workspace.id,
      name: "Bob helper",
      systemPrompt: "CALLEE B PROMPT",
      status: "active",
    });
    if (linked) await prisma.agentLink.create({ data: { callerAgentId: a.id, calleeAgentId: b.id } });
    const caller = callerIs === "bob" ? bob : carol;
    // RNX-119: channel chat applies the D192 subscription gate to the runner.
    await createPackageSnapshot(prisma, { userId: caller.id });
    // The caller runs the agent and pays (RX-22b: the runner's wallet).
    await fundPaidWallet(prisma, caller.id, "1");
    const channel = await prisma.channel.create({ data: { userId: caller.id, name: "Room" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: a.id } });
    return { bob, caller, a, b, channel };
  };

  const sent = () => JSON.stringify(fake.requests);
  const toolNames = (i: number) => (fake.requests[i].tools ?? []).map((t: any) => t.function.name);
  const lastToolResult = () =>
    fake.requests[fake.requests.length - 1].messages.filter((m: any) => m.role === "tool").map((m: any) => m.content);
  const callAgent = (agent: string) => ({ toolCalls: [{ name: "call_agent", arguments: { agent, task: "do it" } }] });

  it("the workspace owner, with A -> B: call_agent is offered, B is listed, and the call runs B (positive control)", async () => {
    const { caller, a, b, channel } = await seed({ callerIs: "bob" });
    fake.enqueue(callAgent(b.name), { content: "B answer" }, { content: "A final" });

    const res = await service.chat(caller.id, channel.id, a.id, "Hi");

    expect(toolNames(0)).toEqual(["call_agent"]);
    expect(fake.requests[0].messages[0].content).toContain(`${b.name} (id: ${b.id})`);
    expect(fake.requests).toHaveLength(3);
    expect(fake.requests[1].messages).toEqual([
      { role: "system", content: "CALLEE B PROMPT" },
      { role: "user", content: `Task from agent "${a.name}": do it` },
    ]);
    expect(lastToolResult()).toEqual(["B answer"]);
    expect(res.content).toBe("A final");
  });

  it("without a link: no call_agent, no list, and a call to B by name is refused (B never runs)", async () => {
    const { caller, a, b, channel } = await seed({ callerIs: "bob", linked: false });
    fake.enqueue(callAgent(b.name), { content: "Done" });

    await service.chat(caller.id, channel.id, a.id, "Hi");

    expect(toolNames(0)).toEqual([]);
    expect(fake.requests[0].messages[0].content).not.toContain("Callable Agents");
    expect(fake.requests).toHaveLength(2);
    expect(lastToolResult()).toEqual(["Error: Agent not found or not linked."]);
    expect(sent()).not.toContain("CALLEE B PROMPT");
  });

  it("R17: someone outside the workspace runs the public A: no call_agent, B not listed, and a call to B never runs", async () => {
    const { caller, bob, a, b, channel } = await seed({ callerIs: "carol" });
    expect(caller.id).not.toBe(bob.id);
    fake.enqueue(callAgent(b.id), { content: "Done" });

    await service.chat(caller.id, channel.id, a.id, "Hi");

    expect(toolNames(0)).toEqual([]);
    expect(fake.requests[0].messages[0].content).not.toContain(b.id);
    expect(fake.requests).toHaveLength(2);
    expect(lastToolResult()).toEqual(["Error: Agent not found or not linked."]);
    expect(sent()).not.toContain("CALLEE B PROMPT");
  });

  it("a link to an agent in another workspace (written straight to the database) is not listed, and calling it is refused", async () => {
    const { caller, bob, a, channel } = await seed({ callerIs: "bob", linked: false });
    const otherWorkspace = await createWorkspace(prisma, { ownerId: bob.id });
    const foreign = await createAgent(prisma, {
      userId: bob.id,
      workspaceId: otherWorkspace.id,
      systemPrompt: "OTHER WORKSPACE PROMPT",
      status: "active",
    });
    await prisma.agentLink.create({ data: { callerAgentId: a.id, calleeAgentId: foreign.id } });
    fake.enqueue(callAgent(foreign.id), { content: "Done" });

    await service.chat(caller.id, channel.id, a.id, "Hi");

    expect(toolNames(0)).toEqual([]);
    expect(sent()).not.toContain("OTHER WORKSPACE PROMPT");
    expect(lastToolResult()).toEqual(["Error: Agent not found or not linked."]);
  });
});
