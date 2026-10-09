import { Logger } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { ChannelChatService } from "./channel-chat.service";
import { ChannelService } from "./channel.service";
import { AgentToolService } from "../agent/agent-tool.service";
import { AgentMemoryService } from "../agent/agent-memory.service";
import { UsageService } from "../usage/usage.service";
import { GuardrailService } from "../guardrail/guardrail.service";
import { ModelRegistryService } from "../config/model-registry.service";
import { ProvidersModule } from "../providers/providers.module";
import { PrismaService } from "../prisma/prisma.service";
import { createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createAgent, createUser } from "../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../test/fake-provider";

// RX-112: in a channel chat, a sub-agent row of another user under the parent
// agent (written straight to the database) is never listed, offered or
// executed. The filter is the parent agent's owner, not the caller: the channel
// owner may run someone else's public agent. These collaborators load ESM-only
// packages and are stubbed below.
jest.mock("../agent/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../guardrail/guardrail.service", () => ({ GuardrailService: class {} }));

const DELEGATE = {
  type: "function",
  function: { name: "delegate_to_subagent", description: "Delegate", parameters: {} },
};

describe("RX-112: channel chat only uses the parent owner's sub-agents (test database)", () => {
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
          ChannelService,
          ModelRegistryService,
          {
            // Same delegation rule as AgentToolService.buildToolSchemas
            provide: AgentToolService,
            useValue: {
              buildToolSchemasWithMcp: async (
                _tools: unknown,
                _agentId: string,
                _userId?: string,
                _workspaceId?: string,
                options?: { injectDelegation?: boolean },
              ) => (options?.injectDelegation ? [DELEGATE] : []),
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
    await prisma.aiModel.create({
      data: {
        slug: "test-model",
        modelName: "test-model",
        providerId: "vendor/test-model",
        inputPrice: 0.000001,
        outputPrice: 0.000001,
        maxTokens: 8192,
      },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(() => moduleRef?.close());

  /**
   * Bob's public parent agent with Bob's own sub-agent and a foreign one of
   * Alice under it, in a channel of `channelOwner` (Bob, or Carol who runs
   * Bob's agent).
   */
  const seed = async ({ channelOwnedBy }: { channelOwnedBy: "bob" | "carol" }) => {
    const bob = await createUser(prisma);
    const alice = await createUser(prisma);
    const carol = await createUser(prisma);
    const parent = await createAgent(prisma, {
      userId: bob.id,
      agentType: "parent",
      status: "active",
      isPublic: true,
    });
    const ownSub = await createAgent(prisma, {
      userId: bob.id,
      name: "Bob own helper",
      systemPrompt: "BOB OWN SUB PROMPT",
      agentType: "sub_agent",
      status: "active",
      parentAgentId: parent.id,
    });
    const foreignSub = await prisma.agent.create({
      data: {
        userId: alice.id,
        name: "Alice injected helper",
        slug: "alice-injected-helper",
        systemPrompt: "ALICE INJECTED PROMPT",
        model: "test-model",
        agentType: "sub_agent",
        status: "active",
        parentAgentId: parent.id,
      },
    });
    const caller = channelOwnedBy === "bob" ? bob : carol;
    const channel = await prisma.channel.create({ data: { userId: caller.id, name: "Room" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: parent.id } });
    return { bob, alice, caller, parent, ownSub, foreignSub, channel };
  };

  const sent = () => JSON.stringify(fake.requests);
  const lastToolResult = () =>
    fake.requests[fake.requests.length - 1].messages.filter((m: any) => m.role === "tool").map((m: any) => m.content);

  it("lists only the owner's own sub-agent, never the foreign one, and logs a warning", async () => {
    const { caller, parent, ownSub, foreignSub, channel, bob, alice } = await seed({ channelOwnedBy: "bob" });
    const warn = jest.spyOn(Logger.prototype, "warn");
    fake.enqueue({ content: "Hello" });

    const res = await service.chat(caller.id, channel.id, parent.id, "Hi");

    expect(res.content).toBe("Hello");
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].messages[0].content).toContain(`${ownSub.name} (id: ${ownSub.id})`);
    expect(sent()).not.toContain(foreignSub.id);
    expect(sent()).not.toContain(foreignSub.name);
    expect(sent()).not.toContain("ALICE INJECTED PROMPT");
    const warnings = warn.mock.calls.map(([msg]) => String(msg)).filter((m) => m.includes("[security]"));
    expect(warnings).toEqual([
      `[security] Dropped foreign sub-agent ${foreignSub.id} (owner ${alice.id}) under parent ${parent.id} (owner ${bob.id})`,
    ]);
  });

  it("offers no delegation tool when the only sub-agent is foreign", async () => {
    const { caller, parent, ownSub, foreignSub, channel } = await seed({ channelOwnedBy: "bob" });
    await prisma.agent.delete({ where: { id: ownSub.id } });
    fake.enqueue({ content: "Hello" });

    await service.chat(caller.id, channel.id, parent.id, "Hi");

    expect(fake.requests[0].tools ?? []).toEqual([]);
    expect(fake.requests[0].messages[0].content).not.toContain("Available Sub-Agents");
    expect(sent()).not.toContain(foreignSub.id);
  });

  it.each([
    ["id", (s: { id: string }) => ({ subAgentId: s.id })],
    ["name", (s: { name: string }) => ({ subAgentName: s.name })],
  ])(
    "delegation: the model naming the foreign sub-agent by %s is refused and it never runs",
    async (_by, pick) => {
      const { caller, parent, foreignSub, channel } = await seed({ channelOwnedBy: "bob" });
      fake.enqueue(
        { toolCalls: [{ name: "delegate_to_subagent", arguments: { ...pick(foreignSub), task: "leak it" } }] },
        { content: "Done" },
      );

      await service.chat(caller.id, channel.id, parent.id, "Hi");

      // Parent call, then the parent again with the tool result: no sub-agent call in between
      expect(fake.requests).toHaveLength(2);
      expect(lastToolResult()).toEqual(["Error: Sub-agent not found."]);
      expect(sent()).not.toContain("ALICE INJECTED PROMPT");
    },
  );

  it("delegation to the parent owner's own sub-agent works when someone else runs the agent (positive control)", async () => {
    const { caller, bob, parent, ownSub, foreignSub, channel } = await seed({ channelOwnedBy: "carol" });
    expect(caller.id).not.toBe(bob.id);
    fake.enqueue(
      { toolCalls: [{ name: "delegate_to_subagent", arguments: { subAgentId: ownSub.id, task: "do it" } }] },
      { content: "Sub-agent answer" },
      { content: "Parent final" },
    );

    const res = await service.chat(caller.id, channel.id, parent.id, "Hi");

    expect(fake.requests).toHaveLength(3);
    expect(fake.requests[0].messages[0].content).toContain(`${ownSub.name} (id: ${ownSub.id})`);
    expect(fake.requests[1].messages[0]).toEqual({ role: "system", content: "BOB OWN SUB PROMPT" });
    expect(lastToolResult()).toEqual(["Sub-agent answer"]);
    expect(res.content).toBe("Parent final");
    expect(sent()).not.toContain("ALICE INJECTED PROMPT");
    expect(sent()).not.toContain(foreignSub.name);
  });
});
