import { TestingModule } from "@nestjs/testing";
import { PromptTemplateService } from "./prompt-template.service";
import { PromptTuningService } from "./prompt-tuning.service";
import { SystemKnowledgeService } from "../../knowledge/service/system-knowledge.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { UserMemoryService } from "../../memory/service/user-memory.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";

// RX-136: the prompt template and system prompt reads of the chat completion run, written against the
// code before their queries moved into repositories: only active rows, highest priority first. Test
// database; the knowledge and memory searches are stubs (no user, so they are not called).
jest.mock("../../knowledge/service/system-knowledge.service", () => ({ SystemKnowledgeService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../memory/service/user-memory.service", () => ({ UserMemoryService: class {} }));

describe("RX-136: prompt templates and system prompts (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  // A new module per test: both services cache what they read for 60 seconds.
  beforeEach(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      providers: [
        PromptTemplateService,
        PromptTuningService,
        { provide: SystemKnowledgeService, useValue: { searchSystemKB: async () => [] } },
        { provide: KnowledgeService, useValue: {} },
        { provide: UserMemoryService, useValue: {} },
      ],
    }));
    await resetDatabase(prisma);
  });

  afterEach(() => moduleRef?.close());

  const template = (slug: string, keywords: string[], priority: number, active = true) =>
    prisma.promptTemplate.create({
      data: { slug, name: slug, description: slug, content: `${slug} content`, keywords, priority, active },
    });

  it("classify uses only active templates: an inactive one with a higher priority is ignored", async () => {
    await template("inactive", ["invoice"], 100, false);
    await template("active", ["invoice"], 1);

    const actual = await moduleRef.get(PromptTemplateService).classify([{ role: "user", content: "make an invoice" }]);

    expect(actual?.slug).toBe("active");
  });

  it("classify breaks a tie on priority", async () => {
    await template("low", ["invoice"], 1);
    await template("high", ["invoice"], 5);

    const actual = await moduleRef.get(PromptTemplateService).classify([{ role: "user", content: "make an invoice" }]);

    expect(actual?.slug).toBe("high");
  });

  it("applyTuning joins the active system prompts, highest priority first, and leaves out inactive ones", async () => {
    await prisma.systemPrompt.create({ data: { name: "low", content: "LOW", priority: 1 } });
    await prisma.systemPrompt.create({ data: { name: "high", content: "HIGH", priority: 9 } });
    await prisma.systemPrompt.create({ data: { name: "off", content: "OFF", priority: 50, active: false } });

    const actual = await moduleRef.get(PromptTuningService).applyTuning([{ role: "user", content: "hello" }]);

    expect(actual).toEqual({
      tunedMessages: [
        { role: "system", content: "HIGH\n\nLOW" },
        { role: "user", content: "hello" },
      ],
      matchedTemplate: null,
    });
  });
});
