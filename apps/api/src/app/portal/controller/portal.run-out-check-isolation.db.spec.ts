import { randomUUID } from "node:crypto";
import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Prisma } from "@generated/prisma/client.js";
import { PortalController } from "./portal.controller";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { PortalTierService } from "../service/portal-tier.service";
import { CreditWarningService } from "../service/credit-warning.service";
import { CreditService } from "../../billing/service/credit.service";
import { CreditLedgerService } from "../../billing/service/credit-ledger.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ConversationService } from "../../chat/service/conversation.service";
import { PromptTuningService } from "../../chat/service/prompt-tuning.service";
import { DocumentService } from "../../document/service/document.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { UsageService } from "../../usage/service/usage.service";
import { ProvidersModule } from "../../providers/providers.module";
import { EmailScheduler } from "../../email/scheduler/email.scheduler";
import { EmailJobService } from "../../email/service/email-job.service";
import { EmailService } from "../../email/service/email.service";
import { EmailTemplateService } from "../../email/service/email-template.service";
import { enqueueCreditWarningEmail } from "../../email/repository/enqueue-credit-warning-email";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { PrismaService } from "../../prisma/prisma.service";
import { TransactionService } from "../../prisma/transaction.service";
import { CreditLedgerEntryRepository } from "../../billing/repository/credit-ledger-entry.repository";
import { ReminderRepository } from "../../reminder/repository/reminder.repository";
import { CreditWarningRepository } from "../repository/credit-warning.repository";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createPackageSnapshot, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-329 AC5 (D332): the run-out warning check and the warning mails run outside the user's request. While the check is
// stuck queueing a mail (the email_jobs table is locked) and the mail sender hangs and then fails, the same user's home
// chat (POST /chat/portal/completions) is answered normally, before the check finishes. Fake provider, test database.
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
process.env.IP_HASH_SECRET = "rnx329-test-secret";

const SESSION = "32932932-9329-4329-8329-329329329329";
const MODEL = "rnx329/portal-standard";
/** The run-out check's settings: 4 paid credits is below the floor 5, so the check queues a floor warning. */
const WARNING_SETTINGS: Record<string, number> = {
  runOutAmberDays: 10,
  runOutRedDays: 3,
  runOutFloorCredits: 5,
  perRunCreditCap: 7,
  projectionMinSpendCredits: 2,
  projectionMaxDays: 30,
};
const POLL_MS = 20;
const MAX_POLLS = 250;

describe("RNX-329 AC5 (D332): a home chat while the run-out check and the mail sender are stuck (Fastify, test database)", () => {
  const fake = new FakeProviderAdapter();
  const send = jest.fn<Promise<{ messageId: string }>, [unknown]>();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
        controllers: [PortalController],
        providers: [
          EntitlementService,
          PortalTierService,
          CreditService,
          CreditLedgerService,
          ModelRegistryService,
          EmailScheduler,
          EmailJobService,
          EmailTemplateService,
          { provide: EmailService, useValue: { send } },
          {
            provide: PromptTuningService,
            useValue: { applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }) },
          },
          { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
          {
            provide: ConversationService,
            useValue: { getOrCreateConversation: async () => "conversation-id", saveMessages: async () => undefined, generateTitle: async () => undefined },
          },
          { provide: KnowledgeService, useValue: { listKnowledgeBases: async () => [] } },
          { provide: DocumentService, useValue: {} },
          { provide: UsageService, useValue: { logUsage: async () => undefined } },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
    await createResolvableModel(prisma, { slug: MODEL, tier: "standard", maxTokens: 8192 });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(async () => {
    await app?.close();
  });

  /** The run-out check with its own settings (the module's PlatformSettingsService is the portal's fixture). */
  const createWarningService = (): CreditWarningService =>
    new CreditWarningService(
      { getSetting: async (name: string) => WARNING_SETTINGS[name] ?? null } as unknown as PlatformSettingsService,
      moduleRef.get(CreditWarningRepository),
      moduleRef.get(CreditLedgerEntryRepository),
      moduleRef.get(ReminderRepository),
      moduleRef.get(TransactionService),
    );

  /** Resolves once a statement is waiting for a lock, failing after MAX_POLLS polls. */
  const waitForBlockedStatement = async (): Promise<void> => {
    for (let i = 0; i < MAX_POLLS; i++) {
      const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`SELECT count(*)::int AS "waiting" FROM pg_locks WHERE NOT granted`;
      if (waiting > 0) return;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error("No statement waited for the email_jobs lock");
  };

  /** Resolves once the mail sender has been called. */
  const waitForSend = async (): Promise<void> => {
    for (let i = 0; i < MAX_POLLS && send.mock.calls.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  };

  it("the chat is answered 200 while the check waits to queue its mail and the sender hangs; both finish afterwards", async () => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id, allowedTiers: ["standard"] });
    const key = `test-top-up:${randomUUID()}`;
    await moduleRef.get(CreditLedgerService).appendEntry({
      owner: { userId: user.id }, wallet: "paid", type: "top_up", amount: new Prisma.Decimal(4), memberUserId: user.id, reference: key, idempotencyKey: key,
    });
    await enqueueCreditWarningEmail(prisma, {
      recipientEmail: user.email,
      payload: { level: "floor", paidAvailable: "4", runOutLabel: null, timeZone: "UTC", reminders: [] },
    });
    let failSend!: (err: Error) => void;
    send.mockImplementation(() => new Promise((_resolve, reject) => (failSend = reject)));
    const sending = moduleRef.get(EmailScheduler).processEmailJobs();
    await waitForSend();
    let releaseLock!: () => void;
    const lockReleased = new Promise<void>((resolve) => (releaseLock = resolve));
    const lockHeld = PrismaService.create();
    const holding = lockHeld.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE "email_jobs" IN EXCLUSIVE MODE`;
      await lockReleased;
    }, { timeout: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 5));
    let isCheckDone = false;
    const checking = createWarningService().runCheck().finally(() => (isCheckDone = true));
    await waitForBlockedStatement();
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const actual = await app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      headers: { "x-portal-session": SESSION, ...asSessionUser(user) },
      payload: { model: MODEL, messages: [{ role: "user", content: "Hi" }] },
    });

    const actualCheckDoneBeforeReply = isCheckDone;
    releaseLock();
    await holding;
    await lockHeld.$disconnect();
    failSend(new Error("SMTP connection lost"));
    await sending;
    expect(actual.statusCode).toBe(200);
    expect(actual.body).toContain("data: [DONE]");
    expect(actualCheckDoneBeforeReply).toBe(false);
    expect(await checking).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const jobs = await prisma.emailJob.findMany({ orderBy: { createdAt: "asc" } });
    expect(jobs.map((job) => [job.status, (job.payload as { level: string }).level])).toEqual([["failed", "floor"], ["pending", "floor"]]);
    expect(jobs[0].lastError).toBe("SMTP connection lost");
  });
});
