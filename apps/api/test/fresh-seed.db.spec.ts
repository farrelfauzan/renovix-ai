import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ChatController } from "../src/app/chat/controller/chat.controller";
import { ChatService } from "../src/app/chat/service/chat.service";
import { PromptTuningService } from "../src/app/chat/service/prompt-tuning.service";
import { ConversationService } from "../src/app/chat/service/conversation.service";
import { CreditService } from "../src/app/billing/service/credit.service";
import { UsageService } from "../src/app/usage/service/usage.service";
import { DocumentService } from "../src/app/document/service/document.service";
import { ModelRegistryService } from "../src/app/config/model-registry.service";
import { AdminProvidersService } from "../src/app/admin-providers/service/admin-providers.service";
import { AdminProviderModelsService } from "../src/app/admin-providers/service/admin-provider-models.service";
import { ProvidersModule } from "../src/app/providers/providers.module";
import { FAKE_REPLY } from "../src/app/providers/fake.adapter";
import { PrismaService } from "../src/app/prisma/prisma.service";
import { createFastifyApp, createTestModule } from "./test-module";
import { resetDatabase, testDatabaseUrl } from "./test-database";
import { createApiKey, createUser } from "./factories";
import { fundPaidWallet } from "./credit-funding";
import { createResolvableModel } from "./provider-model";
import { startStubHttpServer, StubHttpServer } from "./llm-stub";

// RNX-91: `bun run seed` on the test database. The command runs as a real child process (its argv, exit code and
// output are what an operator sees), then the factories add a provider and a model and a chat runs with
// LLM_PROVIDER=fake. Booting the whole server is not needed: the chat route, the credit ledger and the model
// registry run for real in a Nest module, which is what "the API works after the seed" depends on.
jest.mock("../src/app/usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("../src/app/chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../src/app/chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../src/app/document/service/document.service", () => ({ DocumentService: class {} }));

const ROOT = resolve(__dirname, "../../..");
const SLUG = "fake/seed-smoke-model";
const SEEDED_ONLY_BY_AGENT_STEP = ["agents", "agent_tools"];
const EMPTY_BUCKET = '<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>';

describe("RNX-91: bun run seed on an empty test database", () => {
  let s3Stub: StubHttpServer;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let registry: ModelRegistryService;

  /** Runs `bun prisma/seed-all.ts` against the test database; the S3 stub serves an empty system KB bucket. */
  const runSeed = (extraEnv: Record<string, string> = {}, args: string[] = []) =>
    new Promise<{ code: number | null; out: string }>((done) => {
      const child = spawn("bun", ["prisma/seed-all.ts", ...args], {
        cwd: ROOT,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          DATABASE_URL: testDatabaseUrl(),
          LLM_PROVIDER: "fake",
          S3_BUCKET: "seed-test",
          S3_REGION: "test",
          S3_ACCESS_KEY_ID: "test",
          S3_SECRET_ACCESS_KEY: "test",
          S3_ENDPOINT: s3Stub.baseUrl.replace("/v1", ""),
          ...extraEnv,
        },
      });
      let out = "";
      child.stdout.on("data", (c) => (out += c));
      child.stderr.on("data", (c) => (out += c));
      child.on("close", (code) => done({ code, out }));
    });

  /** Row count of every table except _prisma_migrations. */
  const countRows = async (): Promise<Record<string, number>> => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`;
    const counts: Record<string, number> = {};
    for (const { tablename } of tables) {
      const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "public"."${tablename}"`);
      counts[tablename] = Number(n);
    }
    return counts;
  };

  beforeAll(async () => {
    s3Stub = await startStubHttpServer();
    s3Stub.respond((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(EMPTY_BUCKET);
    });
    process.env.LLM_PROVIDER = "fake";
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
      controllers: [ChatController],
      providers: [
        ChatService,
        CreditService,
        ModelRegistryService,
        AdminProvidersService,
        AdminProviderModelsService,
        {
          provide: PromptTuningService,
          useValue: { applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }) },
        },
        { provide: UsageService, useValue: { logUsage: async () => undefined } },
        { provide: ConversationService, useValue: {} },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
    registry = moduleRef.get(ModelRegistryService);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(async () => {
    await app?.close();
    await s3Stub?.close();
    delete process.env.LLM_PROVIDER;
  });

  it("AC2/AC3/AC4: no model: agent step skipped, others run, no provider or model rows, a second run adds nothing", async () => {
    const first = await runSeed();
    const afterFirst = await countRows();
    const second = await runSeed();
    const afterSecond = await countRows();

    expect(afterSecond.invitation_codes).toBe(0);
    expect(afterSecond.app_configs).toBe(0);
    expect(first.code).toBe(0);
    expect(first.out).toContain("run the command again after the admin has entered models");
    expect(first.out).toContain("d. guardrail config: no seed source");
    expect(first.out).toContain("System knowledge sync: 0 synced, 0 unchanged.");
    expect(second.code).toBe(0);
    expect(afterFirst.providers).toBe(0);
    expect(afterFirst.ai_models).toBe(0);
    SEEDED_ONLY_BY_AGENT_STEP.forEach((table) => expect(afterFirst[table]).toBe(0));
    expect(afterFirst.tier_rates).toBe(4);
    expect(afterFirst.system_prompts).toBe(1);
    expect(afterFirst.prompt_templates).toBeGreaterThan(0);
    expect(afterFirst.catalog_changes).toBeGreaterThan(0);
    expect(afterSecond).toEqual(afterFirst);
  });

  it("AC1/AC3/AC4: with a factory provider and model the templates load once in the system user's default workspace, a rerun adds nothing, and a fake-provider chat succeeds", async () => {
    const first = await runSeed();
    await createResolvableModel(prisma, { slug: SLUG });
    await registry.refresh();
    const second = await runSeed();
    const afterSecond = await countRows();
    const third = await runSeed();
    const afterThird = await countRows();
    const coordinator = await prisma.agent.findFirstOrThrow({ where: { slug: "team-coordinator" }, include: { workspace: true } });
    const user = await createUser(prisma);
    const apiKey = await createApiKey(prisma, user.id);
    await fundPaidWallet(prisma, user.id, 5);
    const chat = await app.inject({
      method: "POST",
      url: "/chat/completions",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { model: SLUG, messages: [{ role: "user", content: "Hi" }] },
    });

    expect([first.code, second.code, third.code]).toEqual([0, 0, 0]);
    expect(afterSecond.agents).toBe(8);
    expect(afterSecond.providers).toBe(1);
    expect(afterSecond.ai_models).toBe(1);
    expect(afterThird).toEqual(afterSecond);
    expect(coordinator.workspace.isDefault).toBe(true);
    expect(coordinator.systemPrompt).not.toMatch(/delegat|sub-agent|sub agent/i);
    expect(coordinator.description).not.toMatch(/delegat|sub-agent|sub agent/i);
    expect(chat.statusCode).toBe(200);
    expect(chat.json().choices[0].message.content).toBe(FAKE_REPLY);
  });

  it("AC6: NODE_ENV=production refuses without --allow-production (nothing written) and runs with it", async () => {
    const refused = await runSeed({ NODE_ENV: "production" });
    const afterRefused = await countRows();
    const allowed = await runSeed({ NODE_ENV: "production" }, ["--allow-production"]);
    const afterAllowed = await countRows();

    expect(refused.code).toBe(1);
    expect(refused.out).toContain("Refusing to seed with NODE_ENV=production");
    expect(Object.values(afterRefused).every((n) => n === 0)).toBe(true);
    expect(allowed.code).toBe(0);
    expect(afterAllowed.tier_rates).toBe(4);
  });
});
