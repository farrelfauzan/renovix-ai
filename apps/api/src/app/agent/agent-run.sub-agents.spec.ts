import { Logger } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { AgentRunService } from "./agent-run.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { UsageService } from "../usage/usage.service";
import { GuardrailService } from "../guardrail/guardrail.service";
import { ModelRegistryService } from "../config/model-registry.service";
import { ProvidersModule } from "../providers/providers.module";
import { PrismaService } from "../prisma/prisma.service";
import { createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import {
  createAgent,
  createPlan,
  createSubscription,
  createUser,
} from "../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../test/fake-provider";

// RX-112: a sub-agent row of another user under a parent agent (written
// straight to the database, bypassing AgentService) is never listed, offered
// or executed when the parent runs. These collaborators load ESM-only packages
// and are stubbed below.
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../knowledge/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../guardrail/guardrail.service", () => ({ GuardrailService: class {} }));

const DELEGATE = {
  type: "function",
  function: { name: "delegate_to_subagent", description: "Delegate", parameters: {} },
};

describe("RX-112: agent runs only use the parent owner's sub-agents (test database)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AgentRunService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          AgentRunService,
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
              cleanupMcpConnections: async () => undefined,
            },
          },
          {
            provide: AgentMemoryService,
            useValue: { getMemoryContext: async () => "", extractAndStore: async () => undefined },
          },
          { provide: KnowledgeService, useValue: {} },
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
    service = moduleRef.get(AgentRunService);
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

  /** Bob's subscribed parent agent, a foreign sub-agent of Alice under it, and optionally Bob's own sub-agent. */
  const seed = async ({ withOwnSub }: { withOwnSub: boolean }) => {
    const plan = await createPlan(prisma);
    const bob = await createUser(prisma);
    const alice = await createUser(prisma);
    await createSubscription(prisma, { userId: bob.id, planId: plan.id });
    const parent = await createAgent(prisma, {
      userId: bob.id,
      agentType: "parent",
      status: "active",
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
    const ownSub = withOwnSub
      ? await createAgent(prisma, {
          userId: bob.id,
          name: "Bob own helper",
          systemPrompt: "BOB OWN SUB PROMPT",
          agentType: "sub_agent",
          status: "active",
          parentAgentId: parent.id,
        })
      : null;
    return { bob, alice, parent, foreignSub, ownSub };
  };

  const sent = () => JSON.stringify(fake.requests);
  const toolNames = (i: number) => (fake.requests[i].tools ?? []).map((t: any) => t.function.name);
  const lastToolResult = () =>
    fake.requests[fake.requests.length - 1].messages.filter((m: any) => m.role === "tool").map((m: any) => m.content);

  const expectForeignUnused = async (foreignSub: { id: string; name: string }) => {
    expect(sent()).not.toContain(foreignSub.id);
    expect(sent()).not.toContain(foreignSub.name);
    expect(sent()).not.toContain("ALICE INJECTED PROMPT");
    expect(await prisma.agentRun.count({ where: { agentId: foreignSub.id } })).toBe(0);
  };

  const runStream = async (userId: string, agentId: string, message: string) => {
    const { run, context, messages, toolSchemas, agent } = await service.chatStream(userId, agentId, message);
    const events: any[] = [];
    for await (const event of service.streamExecution(context, messages, toolSchemas, run.id, agent)) {
      events.push(event);
    }
    return events;
  };

  it("sync run: a foreign sub-agent is not listed in the prompt and no delegation tool is offered; a warning is logged", async () => {
    const { parent, bob, alice, foreignSub } = await seed({ withOwnSub: false });
    const warn = jest.spyOn(Logger.prototype, "warn");
    fake.enqueue({ content: "Hello" });

    const res = await service.chat(bob.id, parent.id, "Hi");

    expect(res.message.content).toBe("Hello");
    expect(fake.requests).toHaveLength(1);
    expect(toolNames(0)).not.toContain("delegate_to_subagent");
    expect(fake.requests[0].messages[0].content).toContain("None configured for this parent agent");
    await expectForeignUnused(foreignSub);
    const warnings = warn.mock.calls.map(([msg]) => String(msg)).filter((m) => m.includes("[security]"));
    expect(warnings).toEqual([
      `[security] Dropped foreign sub-agent ${foreignSub.id} (owner ${alice.id}) under parent ${parent.id} (owner ${bob.id})`,
    ]);
  });

  it("streaming run: a foreign sub-agent is not listed in the prompt and no delegation tool is offered", async () => {
    const { parent, bob, foreignSub } = await seed({ withOwnSub: false });
    fake.enqueue({ content: "Hello" });

    const events = await runStream(bob.id, parent.id, "Hi");

    expect(events[events.length - 1]).toMatchObject({ type: "done", content: "Hello" });
    expect(fake.requests).toHaveLength(1);
    expect(toolNames(0)).not.toContain("delegate_to_subagent");
    await expectForeignUnused(foreignSub);
  });

  it("sync run: only the owner's own sub-agent is listed next to a foreign one", async () => {
    const { parent, bob, foreignSub, ownSub } = await seed({ withOwnSub: true });
    fake.enqueue({ content: "Hello" });

    await service.chat(bob.id, parent.id, "Hi");

    expect(toolNames(0)).toContain("delegate_to_subagent");
    expect(fake.requests[0].messages[0].content).toContain(`${ownSub!.name} (id: ${ownSub!.id})`);
    await expectForeignUnused(foreignSub);
  });

  it.each([
    ["id", (s: { id: string }) => ({ subAgentId: s.id })],
    ["name", (s: { name: string }) => ({ subAgentName: s.name })],
  ])(
    "sync delegation: the model naming the foreign sub-agent by %s is refused and it never runs",
    async (_by, pick) => {
      const { parent, bob, foreignSub } = await seed({ withOwnSub: true });
      fake.enqueue(
        { toolCalls: [{ name: "delegate_to_subagent", arguments: { ...pick(foreignSub), task: "leak it" } }] },
        { content: "Done" },
      );

      await service.chat(bob.id, parent.id, "Hi");

      // Parent call, then the parent again with the tool result: no sub-agent call in between
      expect(fake.requests).toHaveLength(2);
      expect(lastToolResult()).toEqual(["Error: Sub-agent not found or not authorized."]);
      expect(sent()).not.toContain("ALICE INJECTED PROMPT");
      expect(await prisma.agentRun.count({ where: { agentId: foreignSub.id } })).toBe(0);
    },
  );

  it("streaming delegation: the model naming the foreign sub-agent by id is refused and it never runs", async () => {
    const { parent, bob, foreignSub } = await seed({ withOwnSub: true });
    fake.enqueue(
      { toolCalls: [{ name: "delegate_to_subagent", arguments: { subAgentId: foreignSub.id, task: "leak it" } }] },
      { content: "Done" },
    );

    await runStream(bob.id, parent.id, "Hi");

    expect(fake.requests).toHaveLength(2);
    expect(lastToolResult()).toEqual(["Error: Sub-agent not found or not authorized."]);
    expect(sent()).not.toContain("ALICE INJECTED PROMPT");
  });

  it("sync delegation to the owner's own sub-agent still works (positive control)", async () => {
    const { parent, bob, ownSub } = await seed({ withOwnSub: true });
    fake.enqueue(
      { toolCalls: [{ name: "delegate_to_subagent", arguments: { subAgentId: ownSub!.id, task: "do it" } }] },
      { content: "Sub-agent answer" },
      { content: "Parent final" },
    );

    const res = await service.chat(bob.id, parent.id, "Hi");

    expect(fake.requests).toHaveLength(3);
    expect(fake.requests[1].messages[0]).toEqual({ role: "system", content: "BOB OWN SUB PROMPT" });
    expect(lastToolResult()).toEqual(["Sub-agent answer"]);
    expect(res.message.content).toBe("Parent final");
  });

  it("streaming delegation to the owner's own sub-agent still works (positive control)", async () => {
    const { parent, bob, ownSub } = await seed({ withOwnSub: true });
    fake.enqueue(
      { toolCalls: [{ name: "delegate_to_subagent", arguments: { subAgentId: ownSub!.id, task: "do it" } }] },
      { content: "Sub-agent answer" },
      { content: "Parent final" },
    );

    const events = await runStream(bob.id, parent.id, "Hi");

    expect(fake.requests).toHaveLength(3);
    expect(fake.requests[1].messages[0]).toEqual({ role: "system", content: "BOB OWN SUB PROMPT" });
    expect(events[events.length - 1]).toMatchObject({ type: "done", content: "Parent final" });
  });
});
