import { randomUUID } from "node:crypto";
import { TestingModule } from "@nestjs/testing";
import { AgentRunService } from "./agent-run.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { EmbeddingService } from "../knowledge/embedding.service";
import { S3Service } from "../knowledge/s3.service";
import { ModelRegistryService } from "../config/model-registry.service";
import { UsageService } from "../usage/usage.service";
import { GuardrailService } from "../guardrail/guardrail.service";
import { ProvidersModule } from "../providers/providers.module";
import { PrismaService } from "../prisma/prisma.service";
import { createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { FakeProviderAdapter, withFakeProvider } from "../../../test/fake-provider";
import {
  createAgent,
  createPlan,
  createSubscription,
  createUser,
  createWorkspace,
} from "../../../test/factories";

// RX-113 regression: the personal KnowledgeService refuses workspace bases,
// so retrieveKnowledge must skip a base the caller cannot search instead of
// dropping the knowledge context of every attached base. Real AgentRunService
// and KnowledgeService on the test database; the model is the fake provider,
// embeddings a fixed unit vector, the other collaborators are stubs.
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("./agent-memory.service", () => ({ AgentMemoryService: class {} }));
jest.mock("../config/model-registry.service", () => ({ ModelRegistryService: class {} }));
jest.mock("../usage/usage.service", () => ({ UsageService: class {} }));
jest.mock("../guardrail/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../knowledge/embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("../knowledge/s3.service", () => ({ S3Service: class {} }));

const unit = () => {
  const v = new Array(1024).fill(0);
  v[0] = 1;
  return v;
};

describe("Agent run: knowledge context per attached base (RX-113, test database, fake provider)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let runs: AgentRunService;
  const fake = new FakeProviderAdapter();
  const embedSingle = jest.fn(async () => ({ embedding: unit(), tokenCount: 1 }));

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          AgentRunService,
          KnowledgeService,
          { provide: EmbeddingService, useValue: { embedSingle } },
          { provide: S3Service, useValue: {} },
          {
            provide: ModelRegistryService,
            useValue: {
              resolveModel: async () => ({ providerId: "vendor/test-model", provider: "openrouter" }),
              getUserPrice: async () => null,
            },
          },
          {
            provide: AgentToolService,
            useValue: { buildToolSchemasWithMcp: async () => [], cleanupMcpConnections: async () => undefined },
          },
          {
            provide: AgentMemoryService,
            useValue: { getMemoryContext: async () => "", extractAndStore: async () => undefined },
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
    runs = moduleRef.get(AgentRunService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    embedSingle.mockClear();
  });

  afterAll(() => moduleRef?.close());

  const insertChunk = (knowledgeBaseId: string, content: string) =>
    prisma.$executeRaw`
      INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, metadata, embedding, "tokenCount", "createdAt")
      VALUES (${randomUUID()}, ${knowledgeBaseId}, ${content}, '{}'::jsonb, ${`[${unit().join(",")}]`}::vector, 1, now())`;

  it("a sync run with a workspace base attached first still uses the caller's personal base", async () => {
    const user = await createUser(prisma);
    const plan = await createPlan(prisma);
    await createSubscription(prisma, { userId: user.id, planId: plan.id });
    const workspace = await createWorkspace(prisma, { ownerId: user.id });
    const workspaceKb = await prisma.knowledgeBase.create({
      data: { userId: user.id, workspaceId: workspace.id, name: "Team KB" },
    });
    const personalKb = await prisma.knowledgeBase.create({ data: { userId: user.id, name: "My KB" } });
    await insertChunk(workspaceKb.id, "workspace base text");
    await insertChunk(personalKb.id, "personal base text");
    const agent = await createAgent(prisma, { userId: user.id, workspaceId: workspace.id });
    await prisma.agentKnowledgeBase.create({ data: { agentId: agent.id, knowledgeBaseId: workspaceKb.id } });
    await prisma.agentKnowledgeBase.create({ data: { agentId: agent.id, knowledgeBaseId: personalKb.id } });
    fake.enqueue({ content: "ok", usage: { prompt_tokens: 10, completion_tokens: 1 } });

    const res = await runs.chat(user.id, agent.id, "what do I know?");

    expect(res.message.content).toBe("ok");
    const prompt = JSON.stringify(fake.requests.at(-1)?.messages);
    expect(prompt).toContain("personal base text");
    expect(prompt).not.toContain("workspace base text");
    // The refused workspace base costs no embedding call: access is checked first
    expect(embedSingle).toHaveBeenCalledTimes(1);
  });
});
